#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <n300/n300.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <thread>
#include <windows.h>

using json = nlohmann::json;
namespace fs = std::filesystem;
namespace {
std::mutex output_mutex;
std::mutex active_mutex;
std::atomic_bool interrupted = false;
std::atomic<n300_handle *> active = nullptr;
HANDLE input_thread = nullptr;
struct Options {
    json config = json::object();
    json saved_target;
    json active_request_id;
    fs::path cache;
    bool cache_enabled = true, rpc = false, autoconnect = true, debug = false;
    std::vector<std::string> command;
};
struct ThreadApartment {
    ThreadApartment() {
        char *error = nullptr;
        int rc = n300_thread_initialize(&error);
        std::string message = error ? error : "Unable to initialize device worker";
        n300_free(error);
        if (rc)
            throw std::runtime_error(message);
    }
    ~ThreadApartment() {
        n300_thread_uninitialize();
    }
};
void output(const json &value, bool error = false) {
    std::lock_guard lock(output_mutex);
    auto &stream = error ? std::cerr : std::cout;
    stream << value.dump(-1, ' ', false, json::error_handler_t::replace) << '\n';
    stream.flush();
}
json call(n300_handle *handle, const json &request) {
    auto started = std::chrono::steady_clock::now();
    char *buffer = nullptr;
    int rc = n300_execute(handle, request.dump().c_str(), &buffer);
    if (!buffer)
        throw std::runtime_error("Native ABI call failed: " + std::to_string(rc));
    std::unique_ptr<char, decltype(&n300_free)> owner(buffer, n300_free);
    auto response = json::parse(buffer);
    response["elapsed_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 std::chrono::steady_clock::now() - started)
                                 .count();
    return response;
}
json benchmark(n300_handle *handle) {
    auto connection = call(handle, {{"method", "connect"}});
    if (!connection.value("ok", false))
        return connection;
    json samples = json::array(), volume;
    for (int i = 0; i < 3; ++i) {
        auto response = call(handle, {{"method", "get"}, {"params", {{"property", "volume"}}}});
        if (!response.value("ok", false))
            return response;
        samples.push_back(response["elapsed_ms"]);
        volume = response["result"];
    }
    auto input = call(handle, {{"method", "get"}, {"params", {{"property", "input"}}}});
    auto diagnostics = call(handle, {{"method", "diagnostics"}});
    if (!diagnostics.value("ok", false))
        return diagnostics;
    return {{"ok", true},
            {"api_version", 1},
            {"offline", connection["offline"]},
            {"result",
             {{"connect_elapsed_ms", connection["elapsed_ms"]},
              {"warm_volume_ms", samples},
              {"volume", volume},
              {"input", input},
              {"diagnostics", diagnostics["result"]}}}};
}
json failure(const std::string &message, const std::string &code = "invalid_argument") {
    return {{"ok", false},
            {"api_version", 1},
            {"error",
             {{"code", code},
              {"message", message},
              {"retryable", false},
              {"details", json::object()}}}};
}
std::string utf8(const wchar_t *value) {
    int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    std::string out(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
    out.pop_back();
    return out;
}
void save_target(Options &options, const json &state) {
    if (!options.cache_enabled || options.config.value("offline", false) ||
        !state.value("connected", false) || !state.contains("target") || state["target"].is_null())
        return;
    if (state["target"] == options.saved_target)
        return;
    try {
        auto parent = options.cache.parent_path();
        if (!parent.empty())
            fs::create_directories(parent);
        auto temp = options.cache;
        temp += L"." + std::to_wstring(GetCurrentProcessId()) + L".tmp";
        {
            std::ofstream file(temp, std::ios::binary | std::ios::trunc);
            file << json({{"version", 1}, {"target", state["target"]}}).dump();
            if (!file)
                throw std::runtime_error("cache write failed");
        }
        if (!MoveFileExW(temp.c_str(), options.cache.c_str(),
                         MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
            fs::remove(temp);
            throw std::runtime_error("cache replace failed");
        }
        options.saved_target = state["target"];
    } catch (const std::exception &e) {
        if (options.debug)
            output(failure(e.what(), "cache_warning"), true);
    }
}
void N300_CALL event_callback(const char *data, void *context) {
    auto &options = *static_cast<Options *>(context);
    auto event = json::parse(data);
    if (!options.active_request_id.is_null()) event["request_id"] = options.active_request_id;
    if (event.value("type", std::string()) == "state")
        save_target(options, event["state"]);
    if (options.rpc)
        output({{"jsonrpc", "2.0"}, {"method", "event"}, {"params", event}});
    else if (options.debug || event.value("type", std::string()) == "connection_error")
        output(event, true);
}
BOOL WINAPI control(DWORD signal) {
    if (signal != CTRL_C_EVENT && signal != CTRL_BREAK_EVENT && signal != CTRL_CLOSE_EVENT)
        return FALSE;
    interrupted = true;
    {
        std::lock_guard lock(active_mutex);
        if (auto handle = active.load())
            n300_cancel(handle);
    }
    if (input_thread)
        CancelSynchronousIo(input_thread);
    return TRUE;
}
int number(const std::string &text) {
    size_t end = 0;
    int value = std::stoi(text, &end);
    if (end != text.size())
        throw std::runtime_error("Expected an integer: " + text);
    return value;
}
json value_for(const std::string &name, const std::string &value) {
    if (name == "volume" || name == "timer")
        return number(value);
    if (name == "led" || name == "idle_shutdown") {
        if (value == "on" || value == "true" || value == "1")
            return true;
        if (value == "off" || value == "false" || value == "0")
            return false;
        throw std::runtime_error("Use on/off or true/false.");
    }
    if ((name == "input" || name == "preset") && !value.empty() &&
        value.find_first_not_of("0123456789") == std::string::npos)
        return number(value);
    return value;
}
json invocation(const std::vector<std::string> &words) {
    if (words.empty())
        throw std::runtime_error("A command is required.");
    auto method = words[0];
    json params = json::object();
    if (method == "status") {
        if (words.size() > 2 || (words.size() == 2 && words[1] != "--full"))
            throw std::runtime_error("Usage: status [--full]");
        params["full"] = words.size() == 2;
    } else if (method == "connect") {
        if (words.size() > 2)
            throw std::runtime_error("Usage: connect [address]");
        if (words.size() == 2)
            params["address"] = words[1];
    } else if (method == "get" || method == "set") {
        if (words.size() != (method == "get" ? 2u : 3u))
            throw std::runtime_error("Usage: get property | set property value");
        params["property"] = words[1];
        if (method == "set")
            params["value"] = value_for(words[1], words[2]);
    } else if (method == "eq") {
        if (words.size() == 1 || (words.size() == 2 && words[1] == "get")) {
            method = "get";
            params["property"] = "eq";
        } else if (words.size() == 4 && words[1] == "set") {
            method = "eq.set";
            params["band"] = number(words[2]);
            size_t end;
            double gain = std::stod(words[3], &end);
            if (end != words[3].size() || !std::isfinite(gain))
                throw std::runtime_error("Gain must be a finite number.");
            params["gain"] = gain;
        } else
            throw std::runtime_error("Usage: eq [get] | eq set band gain_db");
    } else if (method == "volume" || method == "input" || method == "preset" || method == "name" ||
               method == "firmware" || method == "led" || method == "idle-shutdown" ||
               method == "timer") {
        if (words.size() > 2 || (method == "firmware" && words.size() > 1))
            throw std::runtime_error("Too many command arguments.");
        auto property = method == "idle-shutdown" ? "idle_shutdown" : method;
        method = words.size() == 2 ? "set" : "get";
        params["property"] = property;
        if (words.size() == 2)
            params["value"] = value_for(property, words[1]);
    } else {
        if (words.size() != 1)
            throw std::runtime_error("Unexpected command arguments.");
        if (method == "power-off")
            method = "power.off";
    }
    return {{"method", method}, {"params", params}};
}
json rpc_error(const json &id, int code, const std::string &message, json data = nullptr) {
    json error = {{"code", code}, {"message", message}};
    if (!data.is_null())
        error["data"] = data;
    return {{"jsonrpc", "2.0"}, {"id", id}, {"error", error}};
}
json rpc(n300_handle *handle, const json &request, Options &options) {
    if (request.is_array()) {
        if (request.empty())
            return rpc_error(nullptr, -32600, "Invalid Request");
        json results = json::array();
        for (auto &item : request) {
            auto result =
                item.is_array() ? rpc_error(nullptr, -32600, "Invalid Request") : rpc(handle, item, options);
            if (!result.is_null())
                results.push_back(result);
        }
        return results.empty() ? json(nullptr) : results;
    }
    if (!request.is_object() || request.value("jsonrpc", json()) != "2.0" ||
        !request.contains("method") || !request["method"].is_string() ||
        (request.contains("id") && !request["id"].is_null() && !request["id"].is_string() &&
         !request["id"].is_number()))
        return rpc_error(nullptr, -32600, "Invalid Request");
    bool notification = !request.contains("id");
    auto id = request.value("id", json(nullptr));
    options.active_request_id = id;
    struct ClearRequestId { Options &options; ~ClearRequestId() { options.active_request_id = nullptr; } } scope{options};
    auto response = call(handle, {{"method", request["method"]},
                                  {"params", request.value("params", json::object())}});
    if (notification)
        return nullptr;
    if (response.value("ok", false))
        return {{"jsonrpc", "2.0"}, {"id", id}, {"result", response["result"]}};
    auto code = response["error"]["code"].get<std::string>();
    return rpc_error(id,
                     code == "method_not_found"   ? -32601
                     : code == "invalid_argument" ? -32602
                                                  : -32000,
                     response["error"]["message"], response["error"]);
}
void help() {
    std::cout << "N300 native device core 0.3.1\n"
                 "n300 [options] command\n"
                 "  shell (default)       Persistent interactive commands; exit quits\n"
                 "  serve                 UTF-8 JSON-RPC 2.0 over stdio\n"
                 "  scan | connect [addr] | disconnect | start | stop\n"
                 "  status [--full] | capabilities | describe | diagnostics\n"
                 "  benchmark             Connect once, time three read-only volume requests\n"
                 "  get property | set property value\n"
                 "  volume [0..max] | input [aux|usb|bluetooth] | preset [music|...]\n"
                 "  eq [get] | eq set band gain_db\n"
                 "  led [on|off] | idle-shutdown [on|off] | timer [0..240]\n"
                 "  name [text] | firmware | power-off | forget\n"
                 "Options: --offline --address AA:BB:CC:DD:EE:FF --cache path --no-cache\n"
                 "         --scan-timeout-ms N --connect-timeout-ms N --request-timeout-ms N\n"
                 "         --no-autoconnect (shell/serve) --debug --help --version\n"
                 "stdout contains JSON results/events; diagnostics go to stderr.\n";
}
Options parse(int argc, wchar_t **argv) {
    Options options;
    wchar_t local[MAX_PATH];
    DWORD len = GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH);
    options.cache = (len && len < MAX_PATH ? fs::path(local) : fs::temp_directory_path()) /
                    L"n300" / L"target.json";
    for (int i = 1; i < argc; ++i) {
        auto arg = utf8(argv[i]);
        auto next = [&] {
            if (++i >= argc)
                throw std::runtime_error("Missing value after " + arg);
            return utf8(argv[i]);
        };
        if (arg == "--offline")
            options.config["offline"] = true;
        else if (arg == "--address")
            options.config["address"] = next();
        else if (arg == "--cache") {
            next();
            options.cache = fs::path(argv[i]);
        } else if (arg == "--no-cache")
            options.cache_enabled = false;
        else if (arg == "--no-autoconnect")
            options.autoconnect = false;
        else if (arg == "--debug")
            options.debug = true;
        else if (arg == "--scan-timeout-ms")
            options.config["scan_timeout_ms"] = number(next());
        else if (arg == "--connect-timeout-ms")
            options.config["connect_timeout_ms"] = number(next());
        else if (arg == "--request-timeout-ms")
            options.config["request_timeout_ms"] = number(next());
        else
            options.command.push_back(arg);
    }
    if (options.command.empty())
        options.command = {"shell"};
    options.rpc = options.command[0] == "serve";
    if (options.cache_enabled && !options.config.value("offline", false) &&
        fs::exists(options.cache))
        try {
            std::ifstream file(options.cache, std::ios::binary);
            auto saved = json::parse(file);
            if (saved.value("version", 0) == 1 && saved.contains("target")) {
                options.config["target"] = saved["target"];
                options.saved_target = saved["target"];
            }
        } catch (...) {
            if (options.debug)
                output(failure("Ignoring invalid target cache.", "cache_warning"), true);
        }
    return options;
}
std::vector<std::string> split(const std::string &line) {
    std::istringstream input(line);
    std::vector<std::string> result;
    std::string word;
    while (input >> std::quoted(word))
        result.push_back(word);
    if (!input.eof())
        throw std::runtime_error("Unclosed quote.");
    return result;
}
void persistent(n300_handle *handle, Options &options) {
    struct Queue {
        std::mutex mutex;
        std::condition_variable changed;
        std::deque<std::string> lines;
        bool eof = false;
    } queue;
    if (options.rpc)
        output({{"jsonrpc", "2.0"},
                {"method", "event"},
                {"params",
                 {{"type", "ready"},
                  {"api_version", 1},
                  {"core_version", n300_version()},
                  {"offline", options.config.value("offline", false)}}}});
    else
        std::cerr << "N300 command shell. help = commands; exit = quit. "
                  << (options.config.value("offline", false) ? "[OFFLINE]" : "") << '\n';
    std::thread worker([&] {
        ThreadApartment apartment;
        if (options.autoconnect)
            call(handle, {{"method", "start"}});
        while (!interrupted) {
            std::string line;
            bool has_line = false;
            {
                std::unique_lock lock(queue.mutex);
                queue.changed.wait_for(lock, std::chrono::milliseconds(100), [&] {
                    return !queue.lines.empty() || queue.eof || interrupted;
                });
                if (interrupted)
                    break;
                if (!queue.lines.empty()) {
                    line = std::move(queue.lines.front());
                    queue.lines.pop_front();
                    has_line = true;
                    queue.changed.notify_all();
                } else if (queue.eof)
                    break;
            }
            if (has_line)
                try {
                    if (options.rpc) {
                        auto request = json::parse(line, nullptr, false);
                        auto response = request.is_discarded()
                                            ? rpc_error(nullptr, -32700, "Parse error")
                                            : rpc(handle, request, options);
                        if (!response.is_null())
                            output(response);
                    } else {
                        auto words = split(line);
                        if (words.empty())
                            continue;
                        if (words[0] == "help") {
                            std::lock_guard lock(output_mutex);
                            help();
                            continue;
                        }
                        auto response = words.size() == 1 && words[0] == "benchmark"
                                            ? benchmark(handle)
                                            : call(handle, invocation(words));
                        output(response, !response.value("ok", false));
                    }
                } catch (const std::exception &e) {
                    if (options.rpc)
                        output(rpc_error(nullptr, -32603, e.what()));
                    else
                        output(failure(e.what()), true);
                }
            auto response = call(handle, {{"method", "tick"}});
            if (!response.value("ok", false) && options.debug)
                output(response, true);
        }
        call(handle, {{"method", "stop"}});
    });
    std::string line;
    line.reserve(4096);
    bool too_long = false;
    while (!interrupted) {
        int ch = std::cin.get();
        if (ch == EOF)
            break;
        if (ch != '\n') {
            if (line.size() < 1024 * 1024)
                line += static_cast<char>(ch);
            else
                too_long = true;
            continue;
        }
        if (!line.empty() && line.back() == '\r')
            line.pop_back();
        if (!options.rpc && (line == "exit" || line == "quit"))
            break;
        if (too_long) {
            if (options.rpc)
                output(rpc_error(nullptr, -32700, "Request exceeds 1 MiB"));
            else
                output(failure("Command exceeds 1 MiB"), true);
        } else {
            std::unique_lock lock(queue.mutex);
            while (queue.lines.size() >= 64 && !interrupted)
                queue.changed.wait_for(lock, std::chrono::milliseconds(100));
            if (!interrupted) {
                queue.lines.push_back(std::move(line));
                queue.changed.notify_all();
            }
        }
        line.clear();
        too_long = false;
    }
    {
        std::lock_guard lock(queue.mutex);
        if (!line.empty() && !too_long && !interrupted && line != "exit" && line != "quit")
            queue.lines.push_back(std::move(line));
        queue.eof = true;
        queue.changed.notify_all();
    }
    worker.join();
}
} // namespace
int wmain(int argc, wchar_t **argv) {
    SetConsoleCP(CP_UTF8);
    SetConsoleOutputCP(CP_UTF8);
    DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &input_thread, 0,
                    FALSE, DUPLICATE_SAME_ACCESS);
    SetConsoleCtrlHandler(control, TRUE);
    try {
        auto options = parse(argc, argv);
        if (options.command[0] == "--help" || options.command[0] == "help") {
            help();
            return 0;
        }
        if (options.command[0] == "--version") {
            std::cout << n300_version() << '\n';
            return 0;
        }
        if (options.command[0] == "forget") {
            if (options.cache_enabled)
                fs::remove(options.cache);
            output({{"ok", true}, {"result", {{"forgotten", true}}}});
            return 0;
        }
        ThreadApartment apartment;
        n300_handle *handle = nullptr;
        char *error = nullptr;
        if (n300_create(options.config.dump().c_str(), &handle, &error) != 0) {
            json result =
                error ? json::parse(error) : failure("Unable to allocate device session.");
            n300_free(error);
            output(result, true);
            return 2;
        }
        auto release = [](n300_handle *value) {
            {
                std::lock_guard lock(active_mutex);
                active = nullptr;
            }
            n300_destroy(value);
        };
        std::unique_ptr<n300_handle, decltype(release)> owner(handle, release);
        active = handle;
        n300_set_event_callback(handle, event_callback, &options);
        int exit_code = 0;
        if (options.command[0] == "shell" || options.rpc)
            persistent(handle, options);
        else {
            auto start = std::chrono::steady_clock::now();
            auto result = options.command.size() == 1 && options.command[0] == "benchmark"
                              ? benchmark(handle)
                              : call(handle, invocation(options.command));
            result["elapsed_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                                       std::chrono::steady_clock::now() - start)
                                       .count();
            output(result, !result.value("ok", false));
            if (!result.value("ok", false)) {
                auto code = result["error"].value("code", std::string());
                exit_code =
                    code == "invalid_argument"                          ? 2
                    : code == "not_found" || code == "ambiguous_device" ? 3
                    : code == "timeout" || code == "disconnected" || code == "connection_failed"
                        ? 4
                        : 5;
            }
        }
        active = nullptr;
        n300_set_event_callback(handle, nullptr, nullptr);
        if (input_thread) {
            CloseHandle(input_thread);
            input_thread = nullptr;
        }
        return interrupted ? 130 : exit_code;
    } catch (const std::exception &e) {
        active = nullptr;
        output(failure(e.what()), true);
        return 2;
    }
}

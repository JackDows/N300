#include <og98/og98.h>
#include <nlohmann/json.hpp>
#include <windows.h>
#include <filesystem>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

using Json = nlohmann::json;
std::string utf8(const wchar_t* text) {
    const int n = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string value(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, value.data(), n, nullptr, nullptr);
    value.pop_back(); return value;
}
struct Client {
    og98_context* context = og98_create();
    ~Client() { og98_destroy(context); }
    Json call(const Json& input) {
        std::unique_ptr<char, decltype(&og98_free)> output(og98_request(context, input.dump().c_str()), og98_free);
        if (!output) throw std::runtime_error("OG98 allocation failure");
        return Json::parse(output.get());
    }
};
void help() {
    std::cout << "OG98 0.2.0 - Windows control foundation\n"
                 "og98 [--offline] [--model OG98] [--device PATH] [--log PATH|--no-log] COMMAND\n"
                 "Commands: scan, status, get NAME, brightness 0..4, shell, serve, describe\n"
                 "Real-device status/get/brightness require --model OG98.\n"
                 "shell: connect | scan | status | get NAME | brightness 0..4 | disconnect | quit\n"
                 "serve: one API JSON object per input line; one JSON response per output line.\n";
}
Json makeCommand(const std::vector<std::string>& words, const Json& connection) {
    if (words.empty()) throw std::runtime_error("Empty command");
    const auto& command = words[0];
    if ((command == "scan" || command == "status" || command == "describe" || command == "disconnect") && words.size() == 1)
        return {{"method", command}};
    if (command == "connect" && words.size() == 1) return {{"method", command}, {"params", connection}};
    if (command == "get" && words.size() == 2) return {{"method", "get"}, {"params", {{"name", words[1]}}}};
    if (command == "brightness" && words.size() == 2) {
        if (words[1].size() != 1 || words[1][0] < '0' || words[1][0] > '4') throw std::runtime_error("Brightness must be 0..4");
        return {{"method", "set"}, {"params", {{"name", "brightness"}, {"value", words[1][0] - '0'}}}};
    }
    throw std::runtime_error("Unknown command or arguments; use --help");
}
int wmain(int argc, wchar_t** argv) {
    SetConsoleOutputCP(CP_UTF8);
    try {
        bool offline = false, noLog = false;
        std::string model, path, log;
        std::vector<std::string> words;
        for (int i = 1; i < argc; ++i) {
            const auto arg = utf8(argv[i]);
            if (arg == "--offline") offline = true;
            else if (arg == "--no-log") noLog = true;
            else if (arg == "--model" || arg == "--device" || arg == "--log") {
                if (++i >= argc) throw std::runtime_error("Missing option value");
                (arg == "--model" ? model : arg == "--device" ? path : log) = utf8(argv[i]);
            } else if (arg == "--help" || arg == "-h") { help(); return 0; }
            else words.push_back(arg);
        }
        if (words.empty()) words.push_back("shell");
        if (!noLog && log.empty()) {
            wchar_t local[32768]{};
            const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", local, 32768);
            auto folder = length > 0 && length < 32768 ? std::filesystem::path(local) : std::filesystem::current_path();
            folder /= "FlesportsOG98/logs";
            folder /= "core-" + std::to_string(GetCurrentProcessId()) + ".jsonl";
            log = utf8(folder.c_str());
        }
        Client client;
        const auto init = client.call({{"method", "initialize"}, {"params", {{"offline", offline}, {"logPath", noLog ? "" : log}}}});
        if (!init.value("ok", false)) { std::cout << init.dump() << '\n'; return 1; }
        const Json connection{{"model", model}, {"path", path}};
        const bool serve = words[0] == "serve", shell = words[0] == "shell";
        if (serve || shell) {
            if (words.size() != 1) throw std::runtime_error("Unexpected command arguments");
            if (shell) {
                help();
                std::cout << (offline ? "Offline simulator\n" : "2.4 GHz receiver; model selection: OG98\n") << "Log: " << log << '\n';
                if (offline) std::cout << client.call({{"method", "connect"}}).dump(2) << '\n';
            }
            for (std::string line; (shell ? (std::cout << "og98> ", true) : true) && std::getline(std::cin, line);) {
                if (line.empty()) continue;
                if (serve) {
                    std::unique_ptr<char, decltype(&og98_free)> result(og98_request(client.context, line.c_str()), og98_free);
                    if (!result) throw std::runtime_error("OG98 allocation failure");
                    std::cout << result.get() << std::endl;
                    continue;
                }
                if (line == "quit" || line == "exit") break;
                if (line == "help") { help(); continue; }
                try {
                    std::istringstream stream(line); std::vector<std::string> command;
                    for (std::string word; stream >> word;) command.push_back(word);
                    std::cout << client.call(makeCommand(command, connection)).dump(2) << '\n';
                } catch (const std::exception& e) { std::cerr << e.what() << '\n'; }
            }
            return 0;
        }
        const auto request = makeCommand(words, connection);
        if (words[0] != "scan" && words[0] != "describe" && words[0] != "connect" && words[0] != "disconnect") {
            const auto connected = client.call({{"method", "connect"}, {"params", connection}});
            if (!connected.value("ok", false)) { std::cout << connected.dump(2) << '\n'; return 1; }
        }
        const auto response = client.call(request);
        std::cout << response.dump(2) << '\n';
        return response.value("ok", false) ? 0 : 1;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 2; }
}

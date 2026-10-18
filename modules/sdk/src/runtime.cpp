#include <deskhub/module.hpp>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <future>
#include <iostream>
#include <mutex>
#include <thread>

namespace deskhub {
namespace {
std::mutex outputMutex;
void output(const Json& value, bool diagnostic = false) {
    std::lock_guard lock(outputMutex);
    (diagnostic ? std::cerr : std::cout) << value.dump(-1, ' ', false, Json::error_handler_t::replace) << '\n' << std::flush;
}
Json failure(const Json& id, const Json& data, int code = -32000) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", data.value("userMessage", "操作未完成。")}, {"data", data}}}};
}
}
int runModule(bool forceOffline) {
    struct Queue {
        std::mutex mutex, lifetime;
        std::condition_variable changed;
        std::deque<Json> requests;
        bool eof = false;
        std::atomic_bool stopping = false;
        Device* active = nullptr;
    } queue;
    std::promise<void> ready;
    auto started = ready.get_future();
    const Emit emit = [](const std::string& type, const Json& data) {
        if (type == "diagnostic") output({{"event", type}, {"data", data}}, true);
        else output({{"jsonrpc", "2.0"}, {"method", "module.event"}, {"params", {{"type", type}, {"data", data}}}});
    };
    std::thread worker([&] {
        bool announced = false;
        try {
            auto device = createDevice(emit); // The hardware owner and MTA live on this thread.
            { std::lock_guard lock(queue.lifetime); queue.active = device.get(); }
            ready.set_value(); announced = true;
            while (!queue.stopping) {
                Json request;
                {
                    std::unique_lock lock(queue.mutex);
                    queue.changed.wait_for(lock, std::chrono::milliseconds(200), [&] { return queue.eof || queue.stopping || !queue.requests.empty(); });
                    if (queue.stopping) break;
                    if (!queue.requests.empty()) { request = std::move(queue.requests.front()); queue.requests.pop_front(); }
                    else if (queue.eof) break;
                }
                if (!request.is_null()) {
                    const auto id = request["id"];
                    try {
                        const auto method = request["method"].get<std::string>();
                        auto result = method == "module.describe" ? device->describe() : device->execute(method, request.value("params", Json::object()));
                        output({{"jsonrpc", "2.0"}, {"id", id}, {"result", result}});
                    } catch (const Error& error) { output(failure(id, error.data)); }
                    catch (const std::exception& error) { output(failure(id, Error("internal_error", error.what(), "操作未完成，请导出日志以便排查。").data)); }
                }
                if (!queue.stopping) {
                    try { device->tick(); }
                    catch (const std::exception& error) { emit("diagnostic", {{"message", error.what()}, {"operation", "tick"}}); }
                }
            }
            { std::lock_guard lock(queue.lifetime); queue.active = nullptr; }
        } catch (...) {
            if (!announced) ready.set_exception(std::current_exception());
            queue.stopping = true;
        }
    });
    try { started.get(); }
    catch (const std::exception& error) { output({{"error", error.what()}}, true); worker.join(); return 1; }
    Json shutdownId;
    std::string line;
    bool oversized = false;
    auto accept = [&] {
        if (oversized) {
            output(failure(nullptr, Error("invalid_request", "Request exceeds 64 KiB", "请求内容过长。").data, -32600));
            return;
        }
        if (line.empty()) return;
        try {
            auto request = Json::parse(line);
            if (!request.is_object() || request.value("jsonrpc", Json()) != "2.0" || !request.contains("id") ||
                !(request["id"].is_string() || request["id"].is_number_integer()) ||
                !request.contains("method") || !request["method"].is_string() || !request.value("params", Json::object()).is_object())
                throw Error("invalid_request", "Expected a JSON-RPC request with an ID", "请求格式不正确。");
            if (request["method"] == "module.shutdown") {
                shutdownId = request["id"]; queue.stopping = true;
                { std::lock_guard lock(queue.lifetime); if (queue.active) queue.active->cancel(); }
                queue.changed.notify_all();
                return;
            }
            if (forceOffline && request["method"] == "session.initialize") request["params"]["offline"] = true;
            std::lock_guard lock(queue.mutex);
            if (queue.requests.size() >= 32) output(failure(request["id"], Error("busy", "Device queue is full", "设备正在处理其他操作，请稍后重试。").data));
            else { queue.requests.push_back(std::move(request)); queue.changed.notify_one(); }
        } catch (const Error& error) { output(failure(nullptr, error.data, -32600)); }
        catch (const std::exception& error) { output(failure(nullptr, Error("invalid_request", error.what(), "请求格式不正确。").data, -32700)); }
    };
    for (char character; !queue.stopping && std::cin.get(character);) {
        if (character == '\n') { accept(); line.clear(); oversized = false; }
        else if (character != '\r') { if (line.size() < 65536) line.push_back(character); else oversized = true; }
    }
    if (!queue.stopping && (!line.empty() || oversized)) accept();
    { std::lock_guard lock(queue.mutex); queue.eof = true; }
    queue.changed.notify_all(); worker.join();
    for (const auto& request : queue.requests) output(failure(request["id"], Error("cancelled", "Module stopped before execution", "操作已取消。").data));
    if (!shutdownId.is_null()) output({{"jsonrpc", "2.0"}, {"id", shutdownId}, {"result", {{"stopped", true}}}});
    return 0;
}
}
int main(int argc, char** argv) {
    if (argc > 2 || (argc == 2 && std::string(argv[1]) != "--offline")) { std::cerr << "Usage: module.exe [--offline]\n"; return 2; }
    return deskhub::runModule(argc == 2);
}

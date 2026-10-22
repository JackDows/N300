#include <deskhub/module.hpp>
#include <og98/og98.h>
#include <chrono>
#include <cstring>
#include <iostream>
#include <thread>

using deskhub::Json;
struct og98_context {};
static bool asleep = true, dropWriteReply = false;
static int connects = 0, writes = 0, brightness = 4;

// Controllable ABI fixture: exercise the production adapter's lifecycle and
// retry scheduling without depending on a physical receiver or its sleep timer.
og98_context* og98_create() { return new og98_context; }
void og98_destroy(og98_context* context) { delete context; }
void og98_free(char* value) { delete[] value; }
char* og98_request(og98_context*, const char* text) {
    const auto request = Json::parse(text);
    const auto method = request.at("method").get<std::string>();
    Json result = Json::object();
    bool unavailable = false;
    if (method == "connect") { ++connects; unavailable = asleep; result = {{"path", "receiver"}}; }
    else if (method == "status") {
        unavailable = asleep;
        result = {{"firmware", "1.0"}, {"profile", 0}, {"reportRate", {{"hz", 1000}}},
                  {"lighting", {{"brightness", brightness}}}, {"debounce", 0},
                  {"sleep", Json::object()}, {"autoOS", true}, {"keyboardOptions", Json::object()}};
    } else if (method == "set") {
        ++writes; brightness = request["params"]["value"].get<int>();
        unavailable = dropWriteReply;
    }
    const Json response = unavailable
        ? Json{{"ok", false}, {"error", {{"code", "device_not_responding"}, {"message", "receiver silent"}, {"userMessage", "等待唤醒"}}}}
        : Json{{"ok", true}, {"result", result}};
    const auto output = response.dump(); auto* buffer = new char[output.size() + 1];
    std::memcpy(buffer, output.c_str(), output.size() + 1); return buffer;
}
static void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
int main() {
    try {
        Json last;
        auto device = deskhub::createDevice([&](const auto& type, const auto& data) { if (type == "snapshot") last = data; });
        device->execute("session.initialize", {{"offline", true}});
        require(device->execute("device.connect", Json::object())["phase"] == "waiting", "sleep must keep connection intent");
        asleep = false;
        std::this_thread::sleep_for(std::chrono::milliseconds(1100)); device->tick();
        require(last["phase"] == "connected" && connects == 2, "wake must recover without a second connect request");
        require(last["unavailable"].empty(), "recovery clears the old connection error");
        device->tick(); require(connects == 2, "connected receivers must not be continually reopened");
        dropWriteReply = true;
        bool failed = false;
        try { device->execute("capability.write", {{"capability", "lighting.brightness"}, {"value", 2}}); }
        catch (const deskhub::Error&) { failed = true; }
        require(failed && last["phase"] == "waiting", "failed write remains an explicit failure");
        dropWriteReply = false;
        std::this_thread::sleep_for(std::chrono::milliseconds(1100)); device->tick();
        require(last["phase"] == "connected" && writes == 1 && last["values"]["lighting.brightness"]["value"] == 2,
                "reconnect reads actual state and never replays the setter");
        device->execute("device.disconnect", Json::object()); const int before = connects;
        std::this_thread::sleep_for(std::chrono::milliseconds(1100)); device->tick();
        require(connects == before && last["phase"] == "disconnected", "explicit disconnect stops retries");
        std::cout << "PASS waiting/wake, read-only reconnect, no write replay, explicit disconnect\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}

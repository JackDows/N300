#include "session.hpp"
#include <og98/og98.h>
#include <iostream>
#include <chrono>
#include <fstream>
#include <vector>

using namespace og98;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
template<class F> void expectError(const char* code, F&& fn) {
    try { fn(); } catch (const Error& e) { require(e.code == code, "Wrong error code"); return; }
    throw std::runtime_error("Expected operation to fail");
}
struct ScriptedIo final : FeatureIo {
    std::vector<InReport> responses;
    std::vector<OutReport> writes;
    size_t index = 0;
    void send(const OutReport& report) override { writes.push_back(report); }
    InReport receive() override { return index < responses.size() ? responses[index++] : InReport{}; }
    void delay(unsigned) override {}
};
InReport report(std::initializer_list<uint8_t> payload) {
    InReport r{}; std::copy(payload.begin(), payload.end(), r.begin() + 1); return r;
}
Json call(Session& session, const char* method, const Json& params = Json::object()) {
    return session.request(Json{{"method", method}, {"params", params}}.dump());
}
void packets() {
    const auto query = encode(Payload{0x80});
    require(query.size() == 67 && query[0] == 0 && query[1] == 0x80 && query[8] == 0x7f && query[66] == 0, "Captured firmware query mismatch");
    const auto light = decode(report({0x87, 13, 4, 4, 16, 0, 200, 200}), 0x87);
    const auto changed = brightnessCommand(light, 2);
    require(changed[3] == 2 && changed[1] == 13 && changed[4] == 16 && changed[6] == 200 && changed[7] == 200, "Setting preservation failed");
    const auto write = encode(changed, Checksum::Bit8);
    require(write[8] == 200 && write[9] == 69, "BIT8 must not overwrite blue component");
    expectError("invalid_argument", [&] { brightnessCommand(light, 5); });
    expectError("unexpected_reply", [&] { decode(std::span(query.data(), 4), 0x80); });
    expectError("unexpected_reply", [&] { decode(report({0x91}), 0x80); });
}
void polling() {
    auto io = std::make_unique<ScriptedIo>(); auto* spy = io.get();
    io->responses = {report({0, 100}), report({1, 100}), report({0x91, 0, 1}), report({1, 100}), report({0x80, 2, 1})};
    Receiver receiver(std::move(io));
    require(receiver.query(0x80)[2] == 1, "Must skip sleeping status and stale replies");
    require(spy->writes[1][1] == 0xf7 && spy->writes[2][1] == 0xf7 && spy->writes[3][1] == 0xfc, "Wrong F7/FC polling order");
    unsigned initialQueries = 0;
    for (const auto& write : spy->writes) if (write[1] == 0x80) ++initialQueries;
    require(initialQueries == 1, "A query must not be repeatedly sent while awaiting reply");
    auto asleep = std::make_unique<ScriptedIo>(); auto* asleepSpy = asleep.get();
    asleep->responses.assign(50, report({0, 100}));
    Receiver silent(std::move(asleep));
    expectError("device_not_responding", [&] { silent.query(0x80); });
    require(asleepSpy->writes.size() == 51, "Polling must be bounded and never fetch when only battery is present");
}
void writes() {
    auto io = std::make_unique<ScriptedIo>(); auto* spy = io.get();
    const auto ready = report({1, 100});
    const auto before = report({0x87, 13, 4, 4, 16, 0, 200, 200});
    const auto after = report({0x87, 13, 4, 2, 16, 0, 200, 200});
    io->responses = {ready, before, ready, before, ready, after};
    Receiver receiver(std::move(io));
    expectError("invalid_argument", [&] { receiver.setBrightness(-1); });
    require(spy->writes.empty(), "Invalid values must do zero I/O");
    require(receiver.setBrightness(2)["verified"] == true, "Delayed readback should succeed");
    unsigned settingWrites = 0;
    for (const auto& w : spy->writes) if (w[1] == 7) ++settingWrites;
    require(settingWrites == 1, "Readback retries must not replay setting writes");
    auto lost = std::make_unique<ScriptedIo>(); auto* lostSpy = lost.get();
    lost->responses = {ready, before};
    Receiver uncertain(std::move(lost));
    expectError("write_unconfirmed", [&] { uncertain.setBrightness(2); });
    settingWrites = 0;
    for (const auto& w : lostSpy->writes) if (w[1] == 7) ++settingWrites;
    require(settingWrites == 1, "Lost acknowledgement must not repeat write");
}
void api() {
    Session session;
    require(call(session, "connect")["error"]["code"] == "model_required", "Model confirmation must precede hardware access");
    require(call(session, "initialize", {{"offline", true}})["ok"] == true, "Initialize failed");
    require(call(session, "connect")["ok"] == true, "Offline connect failed");
    const auto initial = call(session, "status")["result"];
    require(initial["firmware"]["raw"] == 258 && initial["lighting"]["brightness"] == 4 && initial["sleep"]["wirelessSeconds"] == 120, "Baseline decoder mismatch");
    require(call(session, "set", {{"name", "brightness"}, {"value", 2.5}})["error"]["code"] == "invalid_argument", "Fractional brightness accepted");
    require(call(session, "set", {{"name", "brightness"}, {"value", 4294967296ULL}})["error"]["code"] == "invalid_argument", "Integer overflow accepted");
    require(call(session, "set", {{"name", "brightness"}, {"value", 2}})["result"]["verified"] == true, "Offline write failed");
    const auto updated = call(session, "status")["result"];
    auto expected = initial; expected["lighting"]["brightness"] = 2;
    require(updated == expected, "Brightness changed other state");
    require(call(session, "set", {{"name", "reset"}, {"value", true}})["error"]["code"] == "unsupported_setting", "Unimplemented setters must be blocked");
    require(session.request("{")["error"]["code"] == "invalid_request", "Invalid JSON must return error");
    require(session.request("[]")["error"]["code"] == "invalid_request", "Invalid request shape");
    require(session.request(R"({"id":42,"method":"describe"})")["id"] == 42, "Correlation ID lost");
    call(session, "disconnect");
    require(call(session, "status")["error"]["code"] == "not_connected", "Disconnected reads accepted");
    auto* context = og98_create(); require(context != nullptr, "C ABI create failed");
    char* output = og98_request(context, "{\"method\":\"describe\"}");
    require(output && Json::parse(output)["ok"] == true, "C ABI request failed");
    og98_free(output); og98_destroy(context);
    output = og98_request(nullptr, nullptr);
    require(output && Json::parse(output)["error"]["code"] == "invalid_argument", "Null arguments escaped ABI boundary");
    og98_free(output);
}
void diagnostics() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    auto path = std::filesystem::current_path() / std::filesystem::path(u8"og98-日志");
    path += "-" + std::to_string(stamp) + ".jsonl";
    auto backup = path; backup += ".1";
    const auto encoded = path.u8string();
    const std::string logPath(encoded.begin(), encoded.end());
    {
        std::ofstream seed(path, std::ios::binary);
        seed << std::string(2 * 1024 * 1024, 'x');
    }
    Session session;
    const auto init = call(session, "initialize", {{"offline", true}, {"logPath", logPath}});
    require(init["ok"] == true && !init.contains("logWarning"), "Unicode log initialization failed");
    call(session, "connect");
    call(session, "get", {{"name", "lighting"}});
    require(std::filesystem::file_size(backup) == 2 * 1024 * 1024, "Log rotation lost original file");
    std::ifstream stream(path, std::ios::binary);
    bool tx = false, rx = false, response = false;
    for (std::string line; std::getline(stream, line);) {
        const auto row = Json::parse(line);
        require(row.contains("sequence") && row.contains("timeUnixMs"), "Log correlation metadata missing");
        tx |= row["event"] == "hid.tx"; rx |= row["event"] == "hid.rx"; response |= row["event"] == "api.response";
    }
    stream.close();
    std::filesystem::remove(path); std::filesystem::remove(backup);
    require(tx && rx && response, "API and feature evidence missing from logs");
}
void keyBindings() {
    Receiver receiver(makeSimulator());
    const auto baseline = receiver.keymap(false), fn = receiver.keymap(true);
    require(baseline["keys"].size() == 99, "OG98 layout identity");
    for (const auto* layer : {"normal", "fn"}) {
        const auto before = receiver.keymap(std::string(layer) == "fn");
        const auto result = receiver.setKey({{"layer", layer}, {"slot", 72}, {"action", {{"type", "key"}, {"modifier", 224}, {"key", 6}, {"second", 0}}}});
        require(result["verified"] == true, "Key write confirmation");
        auto expected = before["matrix"]; expected[288] = 0; expected[289] = 224; expected[290] = 6; expected[291] = 0;
        require(receiver.keymap(std::string(layer) == "fn")["matrix"] == expected, "Key write changed unrelated slots");
        receiver.setKey({{"layer", layer}, {"slot", 72}, {"action", {{"type", "restore"}, {"raw", result["before"]["raw"]}}}});
        require(receiver.keymap(std::string(layer) == "fn")["matrix"] == before["matrix"], "Binding restore");
    }
    expectError("invalid_argument", [&] { receiver.setKey({{"slot", 127}, {"action", {{"type", "disabled"}}}}); });
    expectError("invalid_argument", [&] { receiver.setKey({{"slot", 72}, {"action", {{"type", "key"}, {"modifier", 5}, {"key", 6}}}}); });
    receiver.setKey({{"slot", 72}, {"action", {{"type", "media"}, {"code", 0xcd}}}});
    receiver.setKey({{"slot", 72}, {"action", {{"type", "default"}}}});
    require(receiver.keymap(false)["matrix"] == baseline["matrix"], "Default restoration");
    receiver.setOptions({{"winLocked", true}, {"wasdSwapped", true}});
    require(receiver.query(0x86)[2] == 9, "Keyboard option bits");
    receiver.setOptions({{"winLocked", false}});
    require(receiver.query(0x86)[2] == 8, "Option update preserves other bits");
}
int main() {
    try {
        packets(); polling(); writes(); api(); diagnostics(); keyBindings();
        std::cout << "PASS packet fixtures, receiver polling, verified writes, API, C ABI and diagnostic logs\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}

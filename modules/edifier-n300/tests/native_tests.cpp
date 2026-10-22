#include "protocol.hpp"
#include "session.hpp"
#include <chrono>
#include <functional>
#include <future>
#include <iostream>
#include <memory>
#include <n300/n300.h>
#include <thread>

using namespace n300;
struct ThreadApartment {
    ThreadApartment() {
        char *error = nullptr;
        int rc = n300_thread_initialize(&error);
        std::string message = error ? error : "MTA initialization failed";
        n300_free(error);
        if (rc)
            throw std::runtime_error(message);
    }
    ~ThreadApartment() {
        n300_thread_uninitialize();
    }
};
void require(bool value, const char *message) {
    if (!value)
        throw std::runtime_error(message);
}
struct Device {
    n300_handle *handle = nullptr;
    explicit Device(json config = {{"offline", true}}) {
        char *error = nullptr;
        int rc = n300_create(config.dump().c_str(), &handle, &error);
        std::string message = error ? error : "create failed";
        n300_free(error);
        if (rc)
            throw std::runtime_error(message);
    }
    ~Device() {
        n300_destroy(handle);
    }
    json call(const std::string &method, json params = json::object()) {
        ThreadApartment apartment;
        char *value = nullptr;
        int rc = n300_execute(handle, json({{"method", method}, {"params", params}}).dump().c_str(),
                              &value);
        require(rc != 2 && value, "ABI response missing");
        std::unique_ptr<char, decltype(&n300_free)> owner(value, n300_free);
        return json::parse(value);
    }
    json ok(const std::string &method, json params = json::object()) {
        auto response = call(method, params);
        if (!response.value("ok", false))
            throw std::runtime_error(response.dump());
        return response["result"];
    }
};
Bytes caps() {
    Bytes d(20);
    for (auto i : {2, 3, 5, 8, 9, 10})
        d[i] = 1;
    d[13] = 19;
    d[19] = 3;
    return d;
}
int main() {
    int passed = 0, failed = 0;
    auto test = [&](const char *name, const std::function<void()> &run) {
        try {
            run();
            ++passed;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception &e) {
            ++failed;
            std::cerr << "FAIL " << name << ": " << e.what() << '\n';
        }
    };
    test("address formats and actionable validation", [] {
        auto expected = parse_address("B4:E7:B0:67:6B:FC");
        require(parse_address(" b4-e7-b0-67-6b-fc ") == expected, "hyphen and whitespace");
        require(parse_address("B4E7B0676BFC") == expected, "compact address");
        require(format_address(expected) == "B4:E7:B0:67:6B:FC", "canonical address");
        bool rejected = false;
        try {
            parse_address("bad");
        } catch (const Error &e) {
            rejected = e.details["received"] == "bad";
        }
        require(rejected, "diagnostic input");
    });
    test("saved address rediscovers after Windows cache eviction without replaying writes", [] {
        class ColdCache final : public Transport {
            std::unique_ptr<Transport> simulation = make_transport(true, json::object());
            bool discovered = false;
          public:
            int scans = 0, opens = 0;
            ColdCache() { inbox = simulation->inbox; }
            std::vector<Target> scan(int ms, const std::string &address, const std::atomic_bool &cancel, bool fast) override {
                require(address == "00:11:22:33:44:55", "rediscovery must stay on the saved target");
                ++scans; discovered = true; return simulation->scan(ms, address, cancel, fast);
            }
            void connect(const Target &t, int ms, const std::atomic_bool &cancel) override {
                ++opens; if (!discovered) throw Error("not_found", "Windows cache is empty", true);
                simulation->connect(t, ms, cancel);
            }
            void write(const Bytes &data, int ms, const std::atomic_bool &cancel) override { simulation->write(data, ms, cancel); }
            void disconnect() noexcept override { simulation->disconnect(); }
            bool connected() const override { return simulation->connected(); }
        };
        auto transport = std::make_unique<ColdCache>(); auto *probe = transport.get();
        Session session({{"offline", true}, {"target", {{"address", "00:11:22:33:44:55"}, {"protocol", 2}}}}, std::move(transport));
        session.execute({{"method", "connect"}});
        session.execute({{"method", "get"}, {"params", {{"property", "volume"}}}});
        session.execute({{"method", "get"}, {"params", {{"property", "input"}}}});
        require(session.snapshot()["connected"].get<bool>(), "connection recovered");
        require(probe->scans == 1 && probe->opens == 2, "one rediscovery; warm reads reuse the session");
        const auto diagnostics = session.diagnostics();
        for (const auto &request : diagnostics["requests"])
            require(request["command"] == "d8" || request["command"] == "66" || request["command"] == "61", "recovery sends only read requests");
    });
    test("vendor packet vectors", [] {
        require(hex(Codec().encode(0xD8)) == "aa01d8219c", "V1 D8");
        require(hex(Codec().encode(0x67, {8})) == "aa0267082134", "volume");
        require(hex(Codec().encode(0x62, {5, 2})) == "aa03620502212f", "input");
        require(hex(Codec().encode(0xD2)) == "aa01d22196", "timer cancel");
        require(hex(Codec(2).encode(0xD8)) == "aaecd800006e", "V2 D8");
        require(hex(Codec(2).encode(0x62, {5, 2})) == "aaec620002050201", "V2 input");
        require(hex(Codec(2, 16).encode(0x62, {5, 2})) == "aaec620002a0a741", "XOR input");
    });
    test("every fragment boundary and concatenated frames", [] {
        for (auto [v, e] : {std::pair{1, 0}, {2, 0}, {2, 16}}) {
            Codec writer(v, e);
            auto first = writer.encode(0xD8, caps(), 0xBB),
                 second = writer.encode(0x66, {16, 8}, 0xCC);
            for (size_t split = 0; split <= first.size(); ++split) {
                Codec reader(v, e);
                auto frames = reader.feed(Bytes(first.begin(), first.begin() + split));
                Bytes rest(first.begin() + split, first.end());
                rest.insert(rest.end(), second.begin(), second.end());
                auto tail = reader.feed(rest);
                frames.insert(frames.end(), tail.begin(), tail.end());
                require(frames.size() == 2 && frames[0].payload == caps() &&
                            frames[1].payload == Bytes{16, 8},
                        "fragment decode");
            }
        }
    });
    test("checksum rejects corruption and resynchronizes", [] {
        for (int v : {1, 2}) {
            Codec c(v);
            auto damaged = c.encode(0x66, {16, 8}, 0xBB);
            damaged.back() ^= 1;
            auto good = c.encode(0xD7, {0}, 0xBB);
            damaged.insert(damaged.end(), good.begin(), good.end());
            auto frames = c.feed(damaged);
            require(frames.size() == 1 && frames[0].command == 0xD7 && c.bad_checksums == 1,
                    "checksum recovery");
        }
    });
    test("unknown codec rejected", [] {
        bool rejected = false;
        try {
            Codec c(3);
        } catch (const Error &) {
            rejected = true;
        }
        require(rejected, "unknown protocol");
        rejected = false;
        try {
            Codec c(2, 17);
        } catch (const Error &) {
            rejected = true;
        }
        require(rejected, "unknown crypto");
    });
    test("ABI version and validation", [] {
        require(n300_abi_version() == 1, "ABI version");
        require(n300_create(nullptr, nullptr, nullptr) == 2, "null arguments");
        Device d;
        require(d.ok("describe")["device"] == "edifier.n300", "describe");
    });
    test("connect performs only capability handshake", [] {
        Device d;
        d.ok("connect");
        auto requests = d.ok("diagnostics")["requests"];
        require(requests.size() == 1 && requests[0]["command"] == "d8",
                "connect must not refresh everything");
    });
    test("target cache skips subsequent discovery", [] {
        Device d;
        auto target = d.ok("connect")["target"];
        Device next({{"offline", true}, {"target", target}});
        auto state = next.ok("connect");
        require(state["timings"]["scan_ms"] == 0, "cached target");
        require(state["target"] == target, "target metadata roundtrip");
        require(next.ok("diagnostics")["scan_count"] == 0, "no discovery for cached target");
    });
    test("warm operations reuse a single handshake", [] {
        Device d;
        d.ok("get", {{"property", "volume"}});
        d.ok("get", {{"property", "input"}});
        auto requests = d.ok("diagnostics")["requests"];
        require(requests.size() == 3 && requests[0]["command"] == "d8", "connection reuse");
    });
    test("repeated volume writes reuse connection and known limits", [] {
        Device d;
        for (int volume : {9, 10, 8})
            require(d.ok("set", {{"property", "volume"}, {"value", volume}})["value"] == volume,
                    "verified volume");
        auto diagnostics = d.ok("diagnostics");
        require(diagnostics["connection_count"] == 1 && diagnostics["scan_count"] == 1,
                "one discovery and one connection");
        std::vector<std::string> commands;
        for (const auto &request : diagnostics["requests"])
            commands.push_back(request["command"].get<std::string>());
        require(commands ==
                    std::vector<std::string>{"d8", "66", "67", "66", "67", "66", "67", "66"},
                "one limit query followed by write/readback pairs");
    });
    test("full settings available offline", [] {
        Device d;
        auto s = d.ok("status", {{"full", true}});
        require(s["values"].size() == 9 && s["unavailable"].empty(), "all settings");
        require(s["values"]["preset"]["choices"].size() == 5, "catalog");
    });
    test("volume setter readback", [] {
        Device d;
        auto v = d.ok("set", {{"property", "volume"}, {"value", 9}});
        require(v["value"] == 9, "set result");
        require(d.ok("get", {{"property", "volume"}})["value"] == 9, "stored value");
    });
    test("two sessions are independent", [] {
        Device a, b;
        a.ok("set", {{"property", "volume"}, {"value", 12}});
        require(b.ok("get", {{"property", "volume"}})["value"] == 8, "instance isolation");
    });
    test("invalid arguments do not connect", [] {
        Device d;
        require(!d.call("set", {{"property", "volume"}, {"value", true}})["ok"].get<bool>(),
                "boolean integer rejected");
        require(!d.call("get", {{"property", "invalid"}})["ok"].get<bool>(),
                "unknown property rejected");
        require(d.ok("diagnostics")["requests"].empty(), "no device I/O");
    });
    test("out of range never writes", [] {
        Device d;
        auto r = d.call("set", {{"property", "volume"}, {"value", 99}});
        require(r["error"]["code"] == "invalid_argument", "volume limit");
        auto requests = d.ok("diagnostics")["requests"];
        for (auto &item : requests)
            require(item["command"] != "67", "no volume write");
    });
    test("setter rejection is reported", [] {
        Device d({{"offline", true}, {"offline_reject_writes", true}});
        require(d.call("set", {{"property", "volume"}, {"value", 12}})["error"]["code"] ==
                    "verification_failed",
                "reject readback");
    });
    test("missing setter ACK falls back to readback quickly", [] {
        Device d({{"offline", true}, {"offline_drop_ack", true}, {"ack_timeout_ms", 10}});
        auto begin = Clock::now();
        require(d.ok("set", {{"property", "volume"}, {"value", 9}})["value"] == 9, "readback");
        require(Clock::now() - begin < Ms(500), "no 3 second ACK delay");
    });
    test("named inputs and presets", [] {
        Device d;
        require(d.ok("set", {{"property", "input"}, {"value", "usb"}})["value"] == "usb", "USB");
        require(d.ok("set", {{"property", "preset"}, {"value", "movie"}})["value"] == "movie",
                "movie");
    });
    test("input groups preserve USB audio and TF options", [] {
        Device audio({{"offline", true}, {"offline_input_group", 19}});
        auto state = audio.ok("get", {{"property", "input"}});
        require(state["group"] == 19 && state["value"] == "usb_audio" &&
                    state["choices"].size() == 3,
                "USB audio group");
        require(audio.ok("set", {{"property", "input"}, {"value", "aux"}})["raw"] == 3,
                "input value is group specific");
        Device tf({{"offline", true}, {"offline_input_group", 32}});
        require(tf.ok("set", {{"property", "input"}, {"value", "tf"}})["raw"] == 4,
                "TF option retained");
    });
    test("delayed input switch is confirmed without replaying the write", [] {
        std::vector<json> events;
        Device d({{"offline", true}, {"offline_input_delay_reads", 3}});
        n300_set_event_callback(d.handle, [](const char *event, void *context) {
            static_cast<std::vector<json> *>(context)->push_back(json::parse(event));
        }, &events);
        auto result = d.ok("set", {{"property", "input"}, {"value", "bluetooth"}});
        require(result["value"] == "bluetooth", "wait for settled input");
        int writes = 0;
        auto requests = d.ok("diagnostics")["requests"];
        for (const auto &item : requests)
            if (item["command"] == "62") ++writes;
        require(writes == 1, "input command sent exactly once");
        bool recorded = false;
        for (const auto &event : events)
            if (event.value("type", "") == "operation")
                recorded = event["outcome"] == "confirmed" && event["readbacks"].size() == 4;
        require(recorded, "transitional readbacks retained for diagnosis");
        n300_set_event_callback(d.handle, nullptr, nullptr);
    });
    test("input that never changes reports a bounded, traceable failure", [] {
        Device d({{"offline", true}, {"offline_reject_writes", true}, {"input_settle_timeout_ms", 350}});
        auto started = Clock::now();
        auto result = d.call("set", {{"property", "input"}, {"value", "bluetooth"}});
        require(result["error"]["code"] == "verification_failed", "failure preserved");
        require(result["error"]["details"]["readbacks"].size() >= 2, "failure observations");
        require(Clock::now() - started < Ms(1000), "bounded verification");
        require(d.ok("get", {{"property", "input"}})["value"] == "aux", "actual input preserved");
    });
    test("cancel interrupts input settling", [] {
        Device d({{"offline", true}, {"offline_input_delay_reads", 100}});
        d.ok("connect");
        auto task = std::async(std::launch::async, [&] { return d.call("set", {{"property", "input"}, {"value", "bluetooth"}}); });
        std::this_thread::sleep_for(Ms(50));
        const auto started = Clock::now();
        n300_cancel(d.handle);
        require(task.get()["error"]["code"] == "cancelled", "input cancellation");
        require(Clock::now() - started < Ms(500), "input cancellation is prompt");
    });
    test("boolean false is valid", [] {
        Device d;
        require(d.ok("set", {{"property", "led"}, {"value", false}})["value"] == false, "LED off");
        require(d.ok("set", {{"property", "idle_shutdown"}, {"value", true}})["value"] == true,
                "idle shutdown");
    });
    test("zero timer sends cancel command", [] {
        Device d;
        d.ok("set", {{"property", "timer"}, {"value", 30}});
        d.ok("set", {{"property", "timer"}, {"value", 0}});
        bool found = false;
        auto requests = d.ok("diagnostics")["requests"];
        for (auto &item : requests)
            if (item["command"] == "d2")
                found = true;
        require(found, "cancel opcode");
    });
    test("UTF-8 name limit", [] {
        Device d;
        std::string name = "桌面 N300";
        require(d.ok("set", {{"property", "name"}, {"value", name}})["value"] == name,
                "UTF8 roundtrip");
        require(d.call("set",
                       {{"property", "name"}, {"value", std::string(25, 'x')}})["error"]["code"] ==
                    "invalid_argument",
                "byte length");
    });
    test("EQ preserves frequency and Q", [] {
        Device d;
        auto result = d.ok("eq.set", {{"band", 1}, {"gain", -2}});
        require(result["value"][1]["gain_db"] == -2 && result["value"][1]["frequency_hz"] == 500 &&
                    result["value"][1]["q"] == 7,
                "band readback");
    });
    test("EQ rejects wrong mode and invalid steps", [] {
        Device d;
        require(d.call("eq.set", {{"band", 0}, {"gain", 0.5}})["error"]["code"] ==
                    "invalid_argument",
                "step");
        d.ok("set", {{"property", "preset"}, {"value", "music"}});
        require(d.call("eq.set", {{"band", 0}, {"gain", 1}})["error"]["code"] == "invalid_argument",
                "custom mode");
    });
    test("V2 fragmented GATT integration", [] {
        Device d({{"offline", true}, {"offline_protocol", 2}});
        require(d.ok("eq.set", {{"band", 3}, {"gain", 1}})["value"][3]["gain_db"] == 1, "V2 gain");
    });
    test("start tick stop lifecycle", [] {
        Device d;
        require(!d.ok("start")["connected"].get<bool>(), "start is nonblocking");
        require(d.ok("tick")["connected"].get<bool>(), "tick connects");
        d.ok("stop");
        require(!d.ok("tick")["connected"].get<bool>(), "stop suppresses reconnect");
        d.ok("start");
        require(d.ok("tick")["connected"].get<bool>(), "restart");
    });
    test("cancel interrupts blocked worker", [] {
        Device d(
            {{"offline", true}, {"request_timeout_ms", 5000}, {"offline_silent_commands", {102}}});
        d.ok("connect");
        auto start = Clock::now();
        auto task =
            std::async(std::launch::async, [&] { return d.call("get", {{"property", "volume"}}); });
        std::this_thread::sleep_for(Ms(50));
        n300_cancel(d.handle);
        require(task.get()["error"]["code"] == "cancelled", "cancel result");
        require(Clock::now() - start < Ms(1000), "bounded cancellation");
        require(!d.ok("tick")["connected"].get<bool>(), "cancel closes on tick");
    });
    test("power-off disables reconnect", [] {
        Device d;
        d.ok("start");
        d.ok("tick");
        auto result = d.ok("power.off");
        require(result["power_state"] == "unverified", "honest power state");
        require(!d.ok("tick")["connected"].get<bool>(), "no reconnect after power off");
    });
    test("unexpected disconnect reconnects without replaying write", [] {
        Device d({{"offline", true}, {"offline_disconnect_on_command", 103}});
        d.ok("start");
        d.ok("tick");
        auto failed_write = d.call("set", {{"property", "volume"}, {"value", 9}});
        require(failed_write["error"]["code"] == "disconnected" &&
                    !failed_write["error"]["retryable"].get<bool>(),
                "ambiguous write must not advertise safe replay");
        require(d.ok("tick")["connected"].get<bool>(), "automatic reconnect");
        require(d.ok("get", {{"property", "volume"}})["value"] == 9,
                "read actual state after link loss");
        auto requests = d.ok("diagnostics")["requests"];
        int writes = 0;
        for (auto &request : requests)
            if (request["command"] == "67")
                ++writes;
        require(writes == 1, "write was not replayed");
    });
    test("events return on the App worker with increasing sequence", [] {
        Device d;
        std::vector<json> events;
        n300_set_event_callback(
            d.handle,
            [](const char *event, void *context) {
                static_cast<std::vector<json> *>(context)->push_back(json::parse(event));
            },
            &events);
        d.ok("start");
        d.ok("tick");
        d.ok("get", {{"property", "volume"}});
        d.ok("stop");
        require(events.size() >= 3, "events present");
        uint64_t previous = 0;
        for (auto &event : events) {
            auto seq = event["sequence"].get<uint64_t>();
            require(seq > previous, "event ordering");
            previous = seq;
        }
        n300_set_event_callback(d.handle, nullptr, nullptr);
    });
    test("uninitialized thread is rejected before Bluetooth access", [] {
        Device d;
        auto future = std::async(std::launch::async, [&] {
            char *out = nullptr;
            n300_execute(d.handle, "{\"method\":\"connect\"}", &out);
            auto result = json::parse(out);
            n300_free(out);
            return result;
        });
        require(future.get()["error"]["code"] == "wrong_thread", "thread contract");
    });
    std::cout << passed << " passed, " << failed << " failed\n";
    return failed ? 1 : 0;
}

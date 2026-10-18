#include "session.hpp"
#include "catalog.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <winrt/base.h>

namespace n300 {
static const std::map<std::string, uint8_t> queries = {
    {"name", uint8_t{0xC9}},  {"firmware", uint8_t{0xC6}},      {"volume", uint8_t{0x66}},
    {"input", uint8_t{0x61}}, {"preset", uint8_t{0xD5}},        {"eq", uint8_t{0x43}},
    {"led", uint8_t{0xF7}},   {"idle_shutdown", uint8_t{0xD7}}, {"timer", uint8_t{0xD3}}};
static const std::map<std::string, std::set<std::string>> methods = {{"describe", {}},
                                                                     {"scan", {"timeout_ms"}},
                                                                     {"connect", {"address"}},
                                                                     {"disconnect", {}},
                                                                     {"start", {}},
                                                                     {"stop", {}},
                                                                     {"tick", {}},
                                                                     {"get", {"property"}},
                                                                     {"set", {"property", "value"}},
                                                                     {"eq.set", {"band", "gain"}},
                                                                     {"status", {"full"}},
                                                                     {"capabilities", {}},
                                                                     {"power.off", {}},
                                                                     {"diagnostics", {}}};
static std::string lowercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}
static std::string cmd_hex(uint8_t cmd) {
    return hex(Bytes{cmd});
}

Session::Session(const json &config) : catalog(json::parse(n300_catalog)) {
    if (!config.is_object())
        throw Error("invalid_argument", "Session configuration must be an object.");
    const std::set<std::string> allowed = {"offline",
                                           "address",
                                           "target",
                                           "scan_timeout_ms",
                                           "connect_timeout_ms",
                                           "request_timeout_ms",
                                           "ack_timeout_ms",
                                           "offline_protocol",
                                           "offline_drop_ack",
                                           "offline_reject_writes",
                                           "offline_silent_commands",
                                           "offline_input_group",
                                           "offline_disconnect_on_command"};
    for (const auto &[key, value] : config.items())
        if (!allowed.contains(key))
            throw Error("invalid_argument", "Unknown configuration field: " + key);
    offline = boolean(config.value("offline", json(false)), "offline");
    scan_ms = integer(config.value("scan_timeout_ms", json(5000)), 1, 120000, "scan_timeout_ms");
    connect_ms =
        integer(config.value("connect_timeout_ms", json(15000)), 1, 120000, "connect_timeout_ms");
    request_ms =
        integer(config.value("request_timeout_ms", json(2000)), 1, 60000, "request_timeout_ms");
    ack_ms = integer(config.value("ack_timeout_ms", json(250)), 1, 60000, "ack_timeout_ms");
    if (config.contains("address"))
        address_filter = format_address(parse_address(text(config["address"], "address")));
    if (config.contains("target")) {
        target = Target::from_json(config["target"]);
        if (!address_filter.empty() && address_filter != target->address)
            target.reset();
    }
    transport = make_transport(offline, config);
}
Session::~Session() {
    transport->disconnect();
}
void Session::reset_state() {
    verified = false;
    caps = json::object();
    values = json::object();
    raw = json::object();
    input_group = 0;
    eq_calibration.clear();
    eq_layout = nullptr;
}
json Session::snapshot() const {
    bool connected = verified && transport->connected();
    return {{"api_version", 1},
            {"offline", offline},
            {"connected", connected},
            {"auto_reconnect", wanted.load()},
            {"target", target ? target->data() : json(nullptr)},
            {"values", connected ? values : json::object()},
            {"capabilities", connected ? caps : json::object()},
            {"timings", timings}};
}
void Session::emit_state() {
    auto state = snapshot();
    if (state != last_state) {
        last_state = state;
        events.push_back({{"type", "state"}, {"sequence", ++event_sequence}, {"state", state}});
    }
}
json Session::diagnostics() const {
    return {{"state", snapshot()},
            {"raw_responses", raw},
            {"requests", wire},
            {"scan_count", scan_count},
            {"connection_count", connection_count},
            {"bad_checksums", codec ? codec->bad_checksums : 0}};
}
void Session::ensure_connected() {
    check_cancel(cancelled);
    if (verified && transport->connected())
        return;
    reset_state();
    transport->disconnect();
    auto started = Clock::now();
    if (!target) {
        ++scan_count;
        auto found = transport->scan(scan_ms, address_filter, cancelled, true);
        timings["scan_ms"] = std::chrono::duration_cast<Ms>(Clock::now() - started).count();
        if (found.empty())
            throw Error(
                "not_found",
                "N300 not found. Release the phone connection and make the speaker discoverable.",
                true);
        if (found.size() != 1) {
            json devices = json::array();
            for (auto &t : found)
                devices.push_back(t.data());
            throw Error("ambiguous_device",
                        "Specify an address when multiple N300 speakers are present.", false,
                        {{"devices", devices}});
        }
        target = found.front();
    } else
        timings["scan_ms"] = 0;
    codec = std::make_unique<Codec>(target->protocol, target->encryption);
    started = Clock::now();
    try {
        transport->connect(*target, connect_ms, cancelled);
        auto gatt_finished = Clock::now();
        request(0xD8);
        if (!verified)
            throw Error("unsupported_response",
                        "N300 capability handshake returned an unsupported response.");
        timings["connect_ms"] = std::chrono::duration_cast<Ms>(Clock::now() - started).count();
        timings["gatt_ms"] = std::chrono::duration_cast<Ms>(gatt_finished - started).count();
        timings["handshake_ms"] =
            std::chrono::duration_cast<Ms>(Clock::now() - gatt_finished).count();
        ++connection_count;
        retry_attempt = 0;
        emit_state();
    } catch (...) {
        transport->disconnect();
        reset_state();
        emit_state();
        throw;
    }
}
Frame Session::request(uint8_t command, const Bytes &payload, int reply_timeout) {
    check_cancel(cancelled);
    if (!transport->connected())
        throw Error("disconnected", "N300 is disconnected.", true);
    drain();
    auto packet = codec->encode(command, payload);
    wire.push_back({{"command", cmd_hex(command)}, {"payload", hex(payload)}});
    if (wire.size() > 128)
        wire.erase(wire.begin());
    for (size_t offset = 0; offset < packet.size(); offset += transport->packet_size())
        transport->write(
            Bytes(packet.begin() + offset,
                  packet.begin() + std::min(packet.size(), offset + transport->packet_size())),
            request_ms, cancelled);
    auto until = Clock::now() + Ms(reply_timeout < 0 ? request_ms : reply_timeout);
    for (;;) {
        auto frames = codec->feed(transport->receive(until, cancelled));
        std::optional<Frame> answer;
        for (auto &frame : frames)
            if (frame.header == 0xBB || frame.header == 0xCC) {
                apply(frame);
                if (frame.command == command)
                    answer = frame;
            }
        if (answer)
            return *answer;
    }
}
void Session::drain() {
    if (!codec)
        return;
    std::deque<Bytes> chunks;
    {
        std::lock_guard lock(transport->inbox->mutex);
        chunks.swap(transport->inbox->chunks);
    }
    for (auto &data : chunks)
        for (auto &frame : codec->feed(data))
            if (frame.header == 0xBB || frame.header == 0xCC)
                apply(frame);
}
json Session::choices(const std::string &property) const {
    json result = json::array();
    auto group = property == "input" ? input_group : caps.value("eq_index", 0);
    const auto &table = catalog[property == "input" ? "inputs" : "eq_presets"];
    auto key = std::to_string(group);
    if (!table.contains(key))
        return result;
    const std::map<int, std::string> names = {
        {1, "bluetooth"}, {2, "aux"},        {3, "usb"},      {4, "xlr"},
        {5, "optical"},   {6, "coaxial"},    {7, "line_in"},  {8, "usb_audio"},
        {9, "line_in_1"}, {10, "line_in_2"}, {11, "airplay"}, {12, "wireless_2_4g"},
        {14, "tf"}};
    for (auto &entry : table[key]) {
        auto name = property == "input" ? names.at(entry["type"].get<int>())
                                        : lowercase(entry["type"].get<std::string>());
        result.push_back({{"value", name}, {"raw", entry["value"]}, {"label", entry["label"]}});
    }
    return result;
}
void Session::apply(const Frame &frame) {
    auto cmd = frame.command;
    auto &d = frame.payload;
    raw[cmd_hex(cmd)] = hex(d);
    if (cmd == 0xD8 && d.size() >= 14) {
        caps = n300::capabilities(d);
        verified = true;
    } else if (cmd == 0xC9 && !d.empty()) {
        std::string name(d.begin(), d.end());
        while (!name.empty() && name.back() == 0)
            name.pop_back();
        name = json::parse(json(name).dump(-1, ' ', false, json::error_handler_t::replace))
                   .get<std::string>();
        values["name"] = {{"value", name}};
    } else if (cmd == 0xC6 && !d.empty()) {
        std::string version;
        for (auto b : d) {
            if (!version.empty())
                version += '.';
            version += std::to_string(b);
        }
        values["firmware"] = {{"value", version}};
    } else if (cmd == 0x66 && d.size() == 2 && d[0] > 0 && d[1] <= d[0])
        values["volume"] = {{"value", d[1]}, {"min", 0}, {"max", d[0]}, {"step", 1}};
    else if ((cmd == 0x61 && d.size() >= 2) || (cmd == 0xD5 && !d.empty())) {
        std::string property = cmd == 0x61 ? "input" : "preset";
        int number;
        if (cmd == 0x61) {
            input_group = d[0];
            number = d[1];
        } else {
            number = d[0];
            eq_calibration = Bytes(d.begin() + 1, d.end());
        }
        auto options = choices(property);
        json value = number;
        for (auto &option : options)
            if (option["raw"] == number)
                value = option["value"];
        values[property] = {{"value", value}, {"raw", number}, {"choices", options}};
        if (property == "input")
            values[property]["group"] = input_group;
    } else if ((cmd == 0xF7 || cmd == 0xD7) && d.size() == 1 && d[0] <= 1)
        values[cmd == 0xF7 ? "led" : "idle_shutdown"] = {{"value", d[0] != 0}};
    else if (cmd == 0xD3 && d.size() == 2)
        values["timer"] = {{"value", (static_cast<int>(d[0]) << 8) + d[1]}, {"unit", "minutes"}};
    else if (cmd == 0x43) {
        values.erase("eq");
        eq_layout = nullptr;
        if (d.empty())
            return;
        auto kind = std::to_string(codec->version == 2 ? d[0] : 1);
        size_t offset = codec->version == 2 ? 2 : 0;
        if (!catalog["custom_eq"].contains(kind))
            return;
        auto layout = catalog["custom_eq"][kind];
        int count = layout["bands"], stride = layout["stride"];
        if (d.size() < offset + static_cast<size_t>(count) * stride)
            return;
        json bands = json::array();
        for (int i = 0; i < count; ++i) {
            auto pos = offset + i * stride;
            auto freq = pos + layout["freq_offset"].get<int>();
            int hz = (static_cast<int>(d[freq]) << 8) + d[freq + 1];
            double gain = (d[pos + layout["gain_offset"].get<int>()] -
                           layout["gain_offset_value"].get<double>()) /
                          layout["gain_scale"].get<double>();
            if (d[pos] != i || hz < 20 || hz > 20000 || gain < layout["gain_min"].get<double>() ||
                gain > layout["gain_max"].get<double>())
                return;
            bands.push_back({{"index", i},
                             {"frequency_hz", hz},
                             {"gain_db", gain},
                             {"q", layout["q_offset"].is_null()
                                       ? json(nullptr)
                                       : json(d[pos + layout["q_offset"].get<int>()])}});
        }
        eq_layout = layout;
        values["eq"] = {{"value", bands},
                        {"gain_min", layout["gain_min"]},
                        {"gain_max", layout["gain_max"]},
                        {"gain_step", 1.0 / layout["gain_scale"].get<double>()}};
    }
}
void Session::supported(const std::string &property) const {
    if (!queries.contains(property))
        throw Error("invalid_argument", "Unknown property: " + property);
    if (property == "led")
        return;
    std::string cap = property == "preset" || property == "eq" ? "eq_index" : property;
    bool yes = cap == "eq_index" ? caps.value(cap, 0) != 0 : caps.value(cap, false);
    if (!yes)
        throw Error("unsupported", "This firmware does not advertise " + property + ".");
}
json Session::read(const std::string &property) {
    supported(property);
    values.erase(property);
    raw.erase(cmd_hex(queries.at(property)));
    request(queries.at(property));
    if (!values.contains(property))
        throw Error("unsupported_response", "Unknown or malformed " + property + " response.");
    return values[property];
}
void Session::set_and_verify(uint8_t cmd, const Bytes &payload, const std::string &property,
                             const json &expected) {
    try {
        try {
            request(cmd, payload, ack_ms);
        } catch (const Error &e) {
            if (e.code != "timeout")
                throw;
        }
        auto actual = read(property);
        auto received =
            (property == "input" || property == "preset") ? actual["raw"] : actual["value"];
        bool matches = received == expected;
        if (property == "timer")
            matches = received >= std::max(0, expected.get<int>() - 1) && received <= expected;
        if (!matches)
            throw Error("verification_failed", "Device readback differs from the requested value.",
                        false, {{"expected", expected}, {"actual", actual}, {"write_sent", true}});
    } catch (Error &e) {
        e.retryable = false;
        e.details["write_may_have_been_sent"] = true;
        throw;
    }
}
json Session::set(const std::string &property, const json &value) {
    supported(property);
    uint8_t cmd = 0;
    Bytes payload;
    json expected = value;
    if (property == "volume") {
        auto current = values.contains(property) ? values[property] : read(property);
        int level = integer(value, 0, current["max"].get<int>(), "volume");
        cmd = 0x67;
        payload = {static_cast<uint8_t>(level)};
    } else if (property == "input" || property == "preset") {
        read(property);
        if (property == "preset" && !eq_calibration.empty())
            throw Error("unsupported", "Preset contains unverified calibration data.");
        auto options = choices(property);
        std::optional<int> number;
        for (auto &option : options)
            if ((value.is_string() &&
                 lowercase(value.get<std::string>()) == option["value"].get<std::string>()) ||
                (value.is_number_integer() && value == option["raw"]))
                number = option["raw"].get<int>();
        if (!number)
            throw Error("invalid_argument", "Unknown device option.", false,
                        {{"choices", options}});
        expected = *number;
        if (property == "input") {
            cmd = 0x62;
            payload = {static_cast<uint8_t>(input_group), static_cast<uint8_t>(*number)};
        } else {
            cmd = 0xC4;
            payload = {static_cast<uint8_t>(*number)};
        }
    } else if (property == "led" || property == "idle_shutdown") {
        bool on = boolean(value, property.c_str());
        read(property);
        cmd = property == "led" ? 0xF8 : 0xD6;
        payload = {static_cast<uint8_t>(on)};
    } else if (property == "timer") {
        int minutes = integer(value, 0, 240, "timer");
        cmd = minutes ? 0xD1 : 0xD2;
        if (minutes)
            payload = {static_cast<uint8_t>(minutes >> 8), static_cast<uint8_t>(minutes)};
    } else if (property == "name") {
        auto name = text(value, "name");
        auto begin = name.find_first_not_of(" \t\r\n");
        auto end = name.find_last_not_of(" \t\r\n");
        name = begin == std::string::npos ? "" : name.substr(begin, end - begin + 1);
        if (name.empty() || name.size() > static_cast<size_t>(caps.value("rename_bytes", 0)) ||
            name.find('\0') != std::string::npos)
            throw Error("invalid_argument",
                        "Name exceeds the firmware's UTF-8 byte limit or contains NUL.");
        cmd = 0xCA;
        payload = Bytes(name.begin(), name.end());
        expected = name;
    } else
        throw Error("invalid_argument", "Property is not writable: " + property);
    set_and_verify(cmd, payload, property, expected);
    return values[property];
}
json Session::set_gain(const json &params) {
    auto preset = read("preset");
    read("eq");
    if (preset["value"] != "customized" && preset["value"] != "audiophile")
        throw Error("invalid_argument", "Select a custom EQ preset before editing gains.");
    int index =
        integer(params.at("band"), 0, static_cast<int>(values["eq"]["value"].size()) - 1, "band");
    auto gain = params.at("gain");
    if (!gain.is_number() || !std::isfinite(gain.get<double>()))
        throw Error("invalid_argument", "gain must be a finite number.");
    double number = gain.get<double>(), encoded = number * eq_layout["gain_scale"].get<double>() +
                                                  eq_layout["gain_offset_value"].get<double>();
    if (number < eq_layout["gain_min"].get<double>() ||
        number > eq_layout["gain_max"].get<double>() ||
        std::abs(encoded - std::round(encoded)) > 1e-8)
        throw Error("invalid_argument", "Gain is outside the supported range or step.");
    auto band = values["eq"]["value"][index];
    int hz = band["frequency_hz"];
    Bytes payload = {static_cast<uint8_t>(index)};
    if (eq_layout["stride"] == 6)
        payload.push_back(0);
    payload.insert(payload.end(), {static_cast<uint8_t>(hz >> 8), static_cast<uint8_t>(hz),
                                   static_cast<uint8_t>(std::lround(encoded))});
    if (eq_layout["stride"] == 6)
        payload.push_back(band["q"].get<uint8_t>());
    try {
        try {
            request(0x44, payload, ack_ms);
        } catch (const Error &e) {
            if (e.code != "timeout")
                throw;
        }
        auto result = read("eq");
        if (result["value"][index]["gain_db"] != number)
            throw Error("verification_failed", "EQ readback differs from the requested gain.",
                        false, {{"write_sent", true}});
        return result;
    } catch (Error &e) {
        e.retryable = false;
        e.details["write_may_have_been_sent"] = true;
        throw;
    }
}
json Session::describe() {
    json inventory = json::object();
    for (auto &[name, params] : methods)
        inventory[name] = params;
    return {
        {"api_version", 1},
        {"software_version", "0.3.0"},
        {"device", "edifier.n300"},
        {"methods", inventory},
        {"readable_properties",
         {"name", "firmware", "volume", "input", "preset", "eq", "led", "idle_shutdown", "timer"}},
        {"writable_properties",
         {"name", "volume", "input", "preset", "led", "idle_shutdown", "timer"}},
        {"events", {"state", "connection_error"}},
        {"unsupported", {"firmware_update", "factory_reset", "eq_frequency", "eq_q", "cloud_eq"}}};
}
json Session::tick() {
    if (cancelled) {
        wanted = false;
        transport->disconnect();
        reset_state();
        emit_state();
        return snapshot();
    }
    if (verified && !transport->connected()) {
        transport->disconnect();
        reset_state();
        retry_at = Clock::now();
        emit_state();
    }
    if (wanted && !verified && Clock::now() >= retry_at) {
        try {
            try {
                ensure_connected();
            } catch (const winrt::hresult_error &e) {
                transport->disconnect();
                reset_state();
                throw Error("connection_failed", winrt::to_string(e.message()), true,
                            {{"hresult", static_cast<int32_t>(e.code())}});
            }
        } catch (const Error &e) {
            int delay = std::min(15000, 1000 << std::min(retry_attempt++, 4));
            retry_at = Clock::now() + Ms(delay);
            if (!e.retryable)
                wanted = false;
            events.push_back({{"type", "connection_error"},
                              {"sequence", ++event_sequence},
                              {"error", e.data()},
                              {"retry_in_ms", e.retryable ? json(delay) : json(nullptr)}});
        }
    }
    if (verified)
        drain();
    emit_state();
    return snapshot();
}
json Session::execute(const json &req) {
    if (!req.is_object() || !req.contains("method") || !req["method"].is_string())
        throw Error("invalid_argument", "Expected {method, params}.");
    auto method = req["method"].get<std::string>();
    if (!methods.contains(method))
        throw Error("method_not_found", "Unknown method: " + method);
    auto params = req.value("params", json::object());
    if (!params.is_object())
        throw Error("invalid_argument", "params must be an object.");
    for (auto &[key, value] : params.items())
        if (!methods.at(method).contains(key))
            throw Error("invalid_argument", "Unknown parameter: " + key);
    if (method == "get" || method == "set") {
        auto property = text(params.at("property"), "property");
        if (!queries.contains(property))
            throw Error("invalid_argument", "Unknown property: " + property);
        if (method == "set") {
            const auto &value = params.at("value");
            if (property == "firmware" || property == "eq")
                throw Error("invalid_argument", "Property is not writable: " + property);
            if (property == "volume")
                integer(value, 0, 255, "volume");
            if (property == "timer")
                integer(value, 0, 240, "timer");
            if (property == "led" || property == "idle_shutdown")
                boolean(value, property.c_str());
            if (property == "name")
                text(value, "name");
            if ((property == "input" || property == "preset") && !value.is_string() &&
                !value.is_number_integer())
                throw Error("invalid_argument", "Use a named device option or its integer value.");
        }
    }
    if (method == "status")
        boolean(params.value("full", json(false)), "full");
    if (method == "eq.set") {
        integer(params.at("band"), 0, 255, "band");
        auto gain = params.at("gain");
        if (!gain.is_number() || !std::isfinite(gain.get<double>()))
            throw Error("invalid_argument", "gain must be finite.");
    }
    if (method == "describe")
        return describe();
    if (method == "diagnostics")
        return diagnostics();
    if (method == "tick")
        return tick();
    if (method == "start") {
        wanted = true;
        retry_at = Clock::now();
        emit_state();
        return snapshot();
    }
    if (method == "stop" || method == "disconnect") {
        wanted = false;
        transport->disconnect();
        reset_state();
        emit_state();
        return snapshot();
    }
    if (method == "scan") {
        if (verified && transport->connected())
            throw Error("busy", "Disconnect before scanning.");
        int timeout = integer(params.value("timeout_ms", json(scan_ms)), 1, 120000, "timeout_ms");
        ++scan_count;
        auto found = transport->scan(timeout, address_filter, cancelled);
        json result = json::array();
        for (auto &t : found)
            result.push_back(t.data());
        return result;
    }
    if (method == "connect" && params.contains("address")) {
        auto address = format_address(parse_address(text(params["address"], "address")));
        if (!target || target->address != address) {
            transport->disconnect();
            reset_state();
            target.reset();
            address_filter = address;
        }
    }
    ensure_connected();
    json result;
    if (method == "connect") {
        wanted = true;
        result = snapshot();
    } else if (method == "capabilities")
        result = caps;
    else if (method == "get")
        result = read(text(params.at("property"), "property"));
    else if (method == "set")
        result = set(text(params.at("property"), "property"), params.at("value"));
    else if (method == "eq.set")
        result = set_gain(params);
    else if (method == "status") {
        bool full = boolean(params.value("full", json(false)), "full");
        std::vector<std::string> names = {"name", "firmware", "volume", "input", "preset"};
        if (full)
            names.insert(names.end(), {"eq", "led", "idle_shutdown", "timer"});
        json unavailable = json::object();
        for (auto &name : names)
            try {
                read(name);
            } catch (const Error &e) {
                if (e.code != "timeout" && e.code != "unsupported" &&
                    e.code != "unsupported_response")
                    throw;
                unavailable[name] = e.data();
            }
        result = snapshot();
        result["unavailable"] = unavailable;
    } else if (method == "power.off") {
        wanted = false;
        if (!caps.value("power_off", false))
            throw Error("unsupported", "Firmware does not advertise power-off.");
        try {
            request(0xCE);
        } catch (const Error &e) {
            if ((e.code != "timeout" && e.code != "disconnected") || transport->connected())
                throw;
        }
        transport->disconnect();
        reset_state();
        result = {{"command_sent", true}, {"power_state", "unverified"}};
    }
    emit_state();
    return result;
}
} // namespace n300

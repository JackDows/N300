#pragma once
#include <atomic>
#include <chrono>
#include <cstdint>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <vector>

namespace n300 {
using json = nlohmann::json;
using Bytes = std::vector<uint8_t>;
using Clock = std::chrono::steady_clock;
using Ms = std::chrono::milliseconds;

struct Error : std::runtime_error {
    std::string code;
    bool retryable;
    json details;
    Error(std::string c, std::string message, bool retry = false, json extra = json::object())
        : std::runtime_error(std::move(message)), code(std::move(c)), retryable(retry),
          details(std::move(extra)) {}
    json data() const {
        return {
            {"code", code}, {"message", what()}, {"retryable", retryable}, {"details", details}};
    }
};

inline void check_cancel(const std::atomic_bool &cancel) {
    if (cancel.load())
        throw Error("cancelled", "Operation cancelled; an already-sent command cannot be undone.");
}
inline int integer(const json &value, int lo, int hi, const char *name) {
    if (!value.is_number_integer() || value < lo || value > hi)
        throw Error("invalid_argument",
                    std::string(name) + " is outside the supported integer range.");
    return value.get<int>();
}
inline std::string text(const json &value, const char *name) {
    if (!value.is_string())
        throw Error("invalid_argument", std::string(name) + " must be a string.");
    return value.get<std::string>();
}
inline bool boolean(const json &value, const char *name) {
    if (!value.is_boolean())
        throw Error("invalid_argument", std::string(name) + " must be boolean.");
    return value.get<bool>();
}
inline std::string hex(const Bytes &bytes) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    result.reserve(bytes.size() * 2);
    for (auto b : bytes) {
        result += digits[b >> 4];
        result += digits[b & 15];
    }
    return result;
}
inline constexpr const char *service_v1 = "48097e01-1a48-11e9-ab14-d663bd873d93";
inline constexpr const char *service_2026 = "48099503-1a48-11e9-ab14-d663bd873d93";
inline constexpr const char *read_uuid = "48090001-1a48-11e9-ab14-d663bd873d93";
inline constexpr const char *write_uuid = "48090002-1a48-11e9-ab14-d663bd873d93";

struct Target {
    std::string address, name = "N300", service = service_v1;
    int protocol = 1, encryption = 0, rssi = 0;
    json data() const {
        return {{"address", address},       {"name", name},
                {"service", service},       {"protocol", protocol},
                {"encryption", encryption}, {"rssi", rssi}};
    }
    static Target from_json(const json &j);
};
uint64_t parse_address(const std::string &address);
std::string format_address(uint64_t address);
} // namespace n300

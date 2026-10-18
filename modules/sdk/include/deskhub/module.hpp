#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <algorithm>
#include <cctype>

namespace deskhub {
using Json = nlohmann::json;
using Emit = std::function<void(const std::string&, const Json&)>;
struct Error : std::runtime_error {
    Json data;
    Error(std::string code, std::string message, std::string userMessage, Json details = Json::object())
        : std::runtime_error(message), data{{"code", code}, {"message", message}, {"userMessage", userMessage}, {"details", details}} {}
};
inline Json reading(const Json& value) {
    if (value.is_object() && value.contains("value")) return value;
    return {{"value", value}};
}
inline std::string stringParam(const Json& params, const char* key) {
    if (!params.contains(key) || !params[key].is_string())
        throw Error("invalid_argument", std::string(key) + " must be a string", "参数格式不正确。");
    return params[key].get<std::string>();
}
inline std::string resourceId(const std::string& prefix, std::string address) {
    std::transform(address.begin(), address.end(), address.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (prefix == "ble:") address.erase(std::remove_if(address.begin(), address.end(), [](char c) { return c == ':' || c == '-'; }), address.end());
    return prefix + address;
}
class Device {
protected:
    Emit emit_;
    bool initialized_ = false, offline_ = false;
public:
    explicit Device(Emit emit) : emit_(std::move(emit)) {}
    virtual ~Device() = default;
    virtual Json describe() const = 0;
    virtual Json execute(const std::string&, const Json&) = 0;
    virtual void tick() {}
    virtual void cancel() noexcept {}
};
std::unique_ptr<Device> createDevice(Emit emit);
int runModule(bool forceOffline = false);
}

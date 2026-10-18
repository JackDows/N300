#include <deskhub/module.hpp>
#include <og98/og98.h>
#include <map>

namespace deskhub {
namespace {
const std::map<std::string, std::string> properties{
    {"device.firmware", "firmware"}, {"keyboard.profile", "profile"}, {"keyboard.reportRate", "reportRate"},
    {"lighting.state", "lighting"}, {"lighting.brightness", "lighting"}, {"keyboard.debounce", "debounce"},
    {"keyboard.sleep", "sleep"}, {"keyboard.autoOS", "autoOS"}, {"keyboard.options", "keyboardOptions"}};
class OG98 final : public Device {
    og98_context* context_ = og98_create();
    bool connected_ = false;
    Json target_ = Json::object(), values_ = Json::object();
    Json call(const std::string& method, Json params = Json::object()) {
        char* text = og98_request(context_, Json{{"method", method}, {"params", params}}.dump().c_str());
        std::unique_ptr<char, decltype(&og98_free)> owner(text, og98_free);
        if (!text) throw Error("native_failure", "OG98 returned no response", "键盘控制暂时不可用。");
        const auto response = Json::parse(text);
        if (!response.value("ok", false)) {
            const auto& e = response["error"];
            if (e.value("code", "") == "hid_io_error") { connected_ = false; values_.clear(); publish(); }
            throw Error(e.value("code", "device_error"), e.value("message", "OG98 error"), e.value("userMessage", "键盘暂时没有响应。"), e.value("details", Json::object()));
        }
        if (response.contains("logWarning")) emit_("diagnostic", {{"logWarning", response["logWarning"]}});
        return response["result"];
    }
    Json snapshot() const { return {{"phase", connected_ ? "connected" : "disconnected"}, {"values", values_}, {"target", target_}, {"offline", offline_}}; }
    void publish() { emit_("snapshot", snapshot()); }
    Json valueFor(const std::string& capability, const Json& value) const {
        if (capability == "lighting.brightness") return {{"value", value["brightness"]}, {"min", 0}, {"max", 4}, {"step", 1}};
        return reading(value);
    }
    Json refresh() {
        const auto current = call("status");
        for (const auto& [capability, property] : properties) values_[capability] = valueFor(capability, current[property]);
        publish(); return snapshot();
    }
public:
    explicit OG98(Emit emit) : Device(std::move(emit)) { if (!context_) throw std::bad_alloc(); }
    ~OG98() override { og98_destroy(context_); }
    Json describe() const override {
        Json capabilities = Json::array();
        for (const auto& [capability, property] : properties) {
            Json c{{"id", capability}, {"read", true}, {"write", capability == "lighting.brightness"}, {"valueType", "device-defined"}};
            if (capability == "lighting.brightness") { c["valueType"] = "integer"; c["min"] = 0; c["max"] = 4; c["step"] = 1; }
            capabilities.push_back(c);
        }
        return {{"id", DESKHUB_MODULE_ID}, {"version", DESKHUB_MODULE_VERSION}, {"protocolVersion", 1}, {"capabilities", capabilities}, {"simulation", true}};
    }
    Json execute(const std::string& method, const Json& params) override {
        if (method == "session.initialize") {
            if (initialized_) throw Error("already_initialized", "Start a new process to change session configuration", "请重新启动设备模块。");
            if (!params.contains("offline") || !params["offline"].is_boolean()) throw Error("invalid_argument", "offline is required", "参数格式不正确。");
            offline_ = params["offline"].get<bool>(); target_ = params.value("target", Json::object());
            if (!target_.is_object()) throw Error("invalid_target", "target must be an object", "请选择要连接的键盘。");
            if (target_.contains("resourceId") && target_["resourceId"] != resourceId("hid:", target_.value("path", std::string())))
                throw Error("invalid_target", "resourceId does not match the HID path", "设备标识不匹配，请重新选择键盘。");
            call("initialize", {{"offline", offline_}, {"logPath", params.value("diagnosticPath", std::string())}});
            initialized_ = true; return snapshot();
        }
        if (!initialized_) throw Error("not_initialized", "Initialize the session first", "设备模块尚未启动。");
        if (method == "device.scan") {
            Json candidates = Json::array();
            for (const auto& item : call("scan")) {
                const auto path = item["path"].get<std::string>();
                candidates.push_back({{"label", item.value("product", "OG98")}, {"modelVerified", false},
                    {"target", {{"path", path}, {"resourceId", resourceId("hid:", path)}}}});
            }
            return candidates;
        }
        if (method == "device.connect") {
            if (!connected_) {
                auto connection = Json{{"model", "OG98"}, {"path", target_.value("path", std::string())}};
                const auto result = call("connect", connection); target_["path"] = result["path"]; connected_ = true;
            }
            return refresh();
        }
        if (method == "device.disconnect") { call("disconnect"); connected_ = false; values_.clear(); publish(); return snapshot(); }
        if (method == "device.snapshot") return connected_ ? refresh() : snapshot();
        if (!connected_) throw Error("not_connected", "Device is not connected", "请先连接键盘。");
        const auto capability = stringParam(params, "capability");
        if (method == "capability.read" && properties.contains(capability)) {
            auto value = valueFor(capability, call("get", {{"name", properties.at(capability)}}));
            values_[capability] = value; publish(); return value;
        }
        if (method == "capability.write" && capability == "lighting.brightness") {
            if (!params.contains("value")) throw Error("invalid_argument", "value is required", "缺少设置值。");
            const auto result = call("set", {{"name", "brightness"}, {"value", params["value"]}});
            values_["lighting.brightness"] = valueFor(capability, result["after"]);
            values_["lighting.state"] = reading(result["after"]); publish();
            auto value = values_[capability]; value["verified"] = result["verified"]; return value;
        }
        throw Error("unsupported_capability", "Unsupported capability or operation", "此设备暂不支持这项操作。");
    }
};
}
std::unique_ptr<Device> createDevice(Emit emit) { return std::make_unique<OG98>(std::move(emit)); }
}

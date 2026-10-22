#include <deskhub/module.hpp>
#include <n300/n300.h>
#include <map>
#include <mutex>

namespace deskhub {
namespace {
const std::map<std::string, std::string> properties{
    {"audio.volume", "volume"}, {"audio.input", "input"}, {"audio.preset", "preset"}, {"audio.eq", "eq"},
    {"lighting.enabled", "led"}, {"device.idleShutdown", "idle_shutdown"}, {"device.timer", "timer"},
    {"device.name", "name"}, {"device.firmware", "firmware"}};
class N300 final : public Device {
    n300_handle* handle_ = nullptr;
    std::mutex lifetime_;
    Json state_ = Json::object();
    Json lastPublished_;
    bool reconnect_ = false;
    static void N300_CALL onEvent(const char* text, void* context) {
        auto& self = *static_cast<N300*>(context);
        const auto event = Json::parse(text);
        if (event.value("type", "") == "state") { self.state_ = event["state"]; self.publish(); }
        else self.emit_("diagnostic", event);
    }
    Json call(const std::string& method, Json params = Json::object()) {
        char* text = nullptr;
        n300_execute(handle_, Json{{"method", method}, {"params", params}}.dump().c_str(), &text);
        std::unique_ptr<char, decltype(&n300_free)> owner(text, n300_free);
        if (!text) throw Error("native_failure", "N300 returned no response", "音响控制暂时不可用。");
        const auto response = Json::parse(text);
        if (!response.value("ok", false)) {
            auto error = response["error"];
            Error failure(error.value("code", "device_error"), error.value("message", "N300 error"), "操作未完成，请检查音响连接后重试。", error.value("details", Json::object()));
            if (failure.data["code"] == "cancelled") failure.data["userMessage"] = "操作已取消。";
            else if (failure.data["code"] == "not_found") failure.data["userMessage"] = "暂未发现音响，正在重新连接。";
            else if (failure.data["code"] == "device_busy") failure.data["userMessage"] = "音响控制通道被占用，正在重试。";
            else if (failure.data["code"] == "bluetooth_access_denied") failure.data["userMessage"] = "Windows 未允许访问音响，请检查蓝牙设备权限。";
            throw failure;
        }
        return response["result"];
    }
    Json valueFor(const std::string& property, const Json& value) const {
        auto result = reading(value);
        if (property == "timer") {
            result["min"] = 0; result["max"] = 240; result["step"] = 1;
        }
        if (property == "name" && state_.contains("capabilities"))
            result["maxBytes"] = state_["capabilities"].value("rename_bytes", 0);
        return result;
    }
    Json snapshot() const {
        Json values = Json::object();
        Json unavailable = Json::object();
        const bool connected = state_.value("connected", false);
        if (connected && state_.contains("values")) {
            for (const auto& [capability, property] : properties)
                if (state_["values"].contains(property)) values[capability] = valueFor(property, state_["values"][property]);
        }
        if (state_.contains("unavailable") && state_["unavailable"].is_object()) {
            for (const auto& [capability, property] : properties)
                if (state_["unavailable"].contains(property)) unavailable[capability] = state_["unavailable"][property];
        }
        return {{"phase", connected ? "connected" : reconnect_ ? "waiting" : "disconnected"}, {"values", values},
                {"target", state_.value("target", Json(nullptr))}, {"offline", offline_},
                {"unavailable", unavailable}};
    }
    void publish() {
        auto current = snapshot();
        if (current != lastPublished_) { lastPublished_ = current; emit_("snapshot", current); }
    }
public:
    explicit N300(Emit emit) : Device(std::move(emit)) {
        char* error = nullptr;
        const int rc = n300_thread_initialize(&error);
        std::string message = error ? error : "MTA initialization failed";
        n300_free(error);
        if (rc) throw std::runtime_error(message);
    }
    ~N300() override {
        { std::lock_guard lock(lifetime_); n300_destroy(handle_); handle_ = nullptr; }
        n300_thread_uninitialize();
    }
    void cancel() noexcept override { std::lock_guard lock(lifetime_); if (handle_) n300_cancel(handle_); }
    Json describe() const override {
        Json capabilities = Json::array();
        for (const auto& [capability, property] : properties)
            capabilities.push_back({{"id", capability}, {"read", true}, {"write", property != "firmware" && property != "eq"},
                                    {"valueType", property == "volume" || property == "timer" ? "integer" : property == "led" || property == "idle_shutdown" ? "boolean" : property == "name" ? "string" : "device-defined"}});
        capabilities.push_back({{"id", "audio.eq.setBand"}, {"invoke", true}});
        capabilities.push_back({{"id", "device.powerOff"}, {"invoke", true}});
        return {{"id", DESKHUB_MODULE_ID}, {"version", DESKHUB_MODULE_VERSION}, {"protocolVersion", 1}, {"capabilities", capabilities}, {"simulation", true}};
    }
    Json execute(const std::string& method, const Json& params) override {
        if (method == "session.initialize") {
            if (initialized_) throw Error("already_initialized", "Start a new process to change session configuration", "请重新启动设备模块。");
            if (!params.contains("offline") || !params["offline"].is_boolean()) throw Error("invalid_argument", "offline is required", "参数格式不正确。");
            offline_ = params["offline"].get<bool>();
            auto config = params.value("config", Json::object());
            if (!config.is_object()) throw Error("invalid_argument", "config must be an object", "参数格式不正确。");
            config["offline"] = offline_;
            auto target = params.value("target", Json::object());
            if (!target.is_object()) throw Error("invalid_argument", "target must be an object", "参数格式不正确。");
            if (!target.empty()) {
                if (target.contains("resourceId") && target["resourceId"] != resourceId("ble:", target.value("address", std::string())))
                    throw Error("invalid_target", "resourceId does not match the BLE address", "设备标识不匹配，请重新选择音响。");
                target.erase("resourceId");
                if (target.contains("service")) config["target"] = target;
                else if (target.contains("address")) config["address"] = target["address"];
                else throw Error("invalid_target", "N300 target needs address", "请选择要连接的音响。");
            }
            char* error = nullptr;
            { std::lock_guard lock(lifetime_); if (n300_create(config.dump().c_str(), &handle_, &error)) {
                std::string reason = error ? error : "N300 initialization failed"; n300_free(error);
                throw Error("initialization_failed", reason, "音响模块初始化失败。");
            }}
            n300_set_event_callback(handle_, onEvent, this); initialized_ = true;
            return snapshot();
        }
        if (!initialized_) throw Error("not_initialized", "Initialize the session first", "设备模块尚未启动。");
        if (method == "device.scan") {
            Json candidates = Json::array();
            for (auto target : call("scan", params)) {
                target["resourceId"] = resourceId("ble:", target.value("address", std::string()));
                candidates.push_back({{"label", target.value("name", "N300")}, {"modelVerified", true}, {"target", target}});
            }
            return candidates;
        }
        if (method == "device.connect") {
            reconnect_ = true;
            call("start"); state_ = call("connect"); state_ = call("status", {{"full", true}}); publish(); return snapshot();
        }
        if (method == "device.disconnect") { reconnect_ = false; state_ = call("stop"); publish(); return snapshot(); }
        if (method == "device.snapshot") {
            if (state_.value("connected", false)) state_ = call("status", {{"full", true}});
            publish(); return snapshot();
        }
        if (!state_.value("connected", false)) throw Error("not_connected", "Device is not connected", "请先连接音响。");
        const auto capability = stringParam(params, "capability");
        if (method == "capability.invoke") {
            if (capability == "audio.eq.setBand") return call("eq.set", params.value("arguments", Json::object()));
            if (capability == "device.powerOff") { reconnect_ = false; return call("power.off"); }
        } else if (properties.contains(capability)) {
            const auto& property = properties.at(capability);
            if (method == "capability.read") return valueFor(property, call("get", {{"property", property}}));
            if (method == "capability.write") {
                if (!params.contains("value")) throw Error("invalid_argument", "value is required", "缺少设置值。");
                return valueFor(property, call("set", {{"property", property}, {"value", params["value"]}}));
            }
        }
        throw Error("unsupported_capability", "Unsupported capability or operation", "此设备暂不支持这项操作。");
    }
    void tick() override { if (initialized_ && reconnect_) { state_ = call("tick"); publish(); } }
};
}
std::unique_ptr<Device> createDevice(Emit emit) { return std::make_unique<N300>(std::move(emit)); }
}

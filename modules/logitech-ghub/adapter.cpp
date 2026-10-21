#include <deskhub/module.hpp>
#include "src/settings.hpp"
#include "src/macros.hpp"
#include <chrono>
#include <thread>
#include <mutex>

namespace deskhub {
namespace {
using Clock = std::chrono::steady_clock;
class GHub final : public Device {
    std::unique_ptr<ghub::Backend> backend_;
    std::mutex backendLifetime_;
    Json target_ = Json::object(), values_ = Json::object(), unavailable_ = Json::object(), info_, lastPublished_;
    std::string phase_ = "disconnected";
    bool wanted_ = false;
    Clock::time_point nextRefresh_ = Clock::now();
    Json snapshot() const { return {{"phase", phase_}, {"values", values_}, {"unavailable", unavailable_}, {"target", target_}, {"offline", offline_}}; }
    void publish() { const auto value = snapshot(); if (value != lastPublished_) { lastPublished_ = value; emit_("snapshot", value); } }
    Json publicInfo(const Json& device) const {
        std::string firmware;
        for (const auto& fw : device.value("fwInfo", Json::array())) if (firmware.empty()) firmware = fw.value("firmwareVersion", std::string());
        return {{"name", device.value("displayName", "Logitech 鼠标")}, {"model", device.value("deviceModel", "")},
            {"connection", device.value("displayConnectionType", "")}, {"firmware", firmware}, {"backend", "G HUB"}};
    }
    void wait(const std::string& code, const std::string& message) {
        phase_ = "waiting"; values_.clear();
        if (!info_.is_null()) values_["device.info"] = reading(publicInfo(info_));
        unavailable_ = {{"connection", {{"code", code}, {"userMessage", message}}}};
    }
    Json refresh() {
        nextRefresh_ = Clock::now() + std::chrono::seconds(3);
        try {
            auto devices = ghub::mice(*backend_);
            auto selected = devices.end();
            const auto resource = target_.value("resourceId", std::string());
            if (!resource.empty()) selected = std::find_if(devices.begin(), devices.end(), [&](const Json& d) { return ghub::identity(d) == resource; });
            else if (devices.size() == 1) selected = devices.begin();
            else if (devices.size() > 1) throw Error("device_selection_required", "Multiple Logitech mice require explicit selection", "请选择要控制的罗技鼠标。");
            if (selected == devices.end()) { wait("not_found", "请连接鼠标或接收器。"); publish(); return snapshot(); }
            info_ = *selected; target_["resourceId"] = ghub::identity(info_); target_["name"] = info_.value("displayName", "Logitech 鼠标");
            values_.clear(); unavailable_.clear(); values_["device.info"] = reading(publicInfo(info_));
            if (info_.value("state", "") != "ACTIVE") { wait("device_unavailable", "请唤醒鼠标，或检查接收器是否连接。"); publish(); return snapshot(); }
            phase_ = "connected";
            try { const auto settings = ghub::readSettings(*backend_, info_); values_.update(settings.values); }
            catch (const Error& error) {
                if (error.data["code"] == "ghub_unavailable" || error.data["code"] == "ghub_timeout") throw;
                unavailable_["mouse.settings"] = error.data; emit_("diagnostic", {{"operation", "settings.read"}, {"error", error.data}});
            }
            try { values_["device.battery"] = reading(backend_->request("GET", "/battery/" + info_["id"].get<std::string>() + "/state")); }
            catch (const Error& error) { unavailable_["device.battery"] = error.data; }
        } catch (const Error& error) {
            emit_("diagnostic", {{"operation", "refresh"}, {"error", error.data}});
            wait(error.data.value("code", "ghub_unavailable"), error.data.value("userMessage", "请先启动 G HUB，再重新连接鼠标。"));
        }
        publish(); return snapshot();
    }
public:
    explicit GHub(Emit emit) : Device(std::move(emit)) {}
    void cancel() noexcept override { std::lock_guard lock(backendLifetime_); if (backend_) backend_->cancel(); }
    void tick() override { if (initialized_ && wanted_ && Clock::now() >= nextRefresh_) refresh(); }
    Json describe() const override {
        Json capabilities = Json::array();
        for (const auto* id : {"device.info", "device.battery", "device.onboardMode", "mouse.dpiStage", "mouse.reportRate", "mouse.profile"})
            capabilities.push_back({{"id", id}, {"read", true}, {"write", std::string(id) != "device.info" && std::string(id) != "device.battery"},
                {"valueType", std::string(id) == "device.onboardMode" ? "boolean" : std::string(id) == "mouse.reportRate" ? "integer" : "device-defined"}});
        capabilities.push_back({{"id","mouse.bindings"},{"read",true},{"valueType","device-defined"}});
        for (const auto* id : {"macros.list","macros.get","macros.save","macros.remove","mouse.bindings.set"}) capabilities.push_back({{"id",id},{"invoke",true}});
        return {{"id", DESKHUB_MODULE_ID}, {"version", DESKHUB_MODULE_VERSION}, {"protocolVersion", 1}, {"capabilities", capabilities}, {"simulation", true}};
    }
    Json execute(const std::string& method, const Json& params) override {
        if (method == "session.initialize") {
            if (initialized_) throw Error("already_initialized", "Session already initialized", "请重新启动鼠标模块。");
            if (!params.contains("offline") || !params["offline"].is_boolean()) throw Error("invalid_argument", "offline required", "参数格式不正确。");
            offline_ = params["offline"].get<bool>(); target_ = params.value("target", Json::object());
            if (!target_.is_object() || (target_.contains("resourceId") && (!target_["resourceId"].is_string() || !target_["resourceId"].get<std::string>().starts_with("ghub:"))))
                throw Error("invalid_target", "Expected G HUB resourceId", "请选择要连接的罗技鼠标。");
            const auto config = params.value("config", Json::object());
            const auto port = config.value("port", Json(9010));
            if (!port.is_number_integer() || port.get<int>() < 1 || port.get<int>() > 65535) throw Error("invalid_argument", "Invalid local port", "连接参数不正确。");
            { std::lock_guard lock(backendLifetime_); backend_ = offline_ ? ghub::simulator() : ghub::online(port.get<unsigned>()); }
            initialized_ = true; return snapshot();
        }
        if (!initialized_) throw Error("not_initialized", "Initialize first", "鼠标模块尚未启动。");
        if (method == "device.scan") {
            Json candidates = Json::array();
            for (const auto& device : ghub::mice(*backend_)) candidates.push_back({{"label", device.value("displayName", "Logitech 鼠标")}, {"modelVerified", true},
                {"available", device.value("state", "") == "ACTIVE"}, {"target", {{"resourceId", ghub::identity(device)}, {"name", device.value("displayName", "Logitech 鼠标")}}}});
            return candidates;
        }
        if (method == "device.connect") { wanted_ = true; return refresh(); }
        if (method == "device.disconnect") { wanted_ = false; phase_ = "disconnected"; values_.clear(); unavailable_.clear(); publish(); return snapshot(); }
        if (method == "device.snapshot") return wanted_ ? refresh() : snapshot();
        if (phase_ != "connected") throw Error("not_connected", "Mouse is not active", "请先连接并唤醒鼠标。");
        const auto capability = stringParam(params, "capability");
        if (method == "capability.read" && capability == "mouse.bindings") return reading(ghub::readBindings(*backend_,info_));
        if (method == "capability.invoke") {
            emit_("diagnostic",{{"operation",capability}});
            return ghub::macroOperation(*backend_,info_,capability,params.value("arguments",Json::object()));
        }
        if (method != "capability.read" && method != "capability.write") throw Error("unsupported_capability", "Unsupported operation", "此设备暂不支持这项操作。");
        refresh();
        if (phase_ != "connected") throw Error("not_connected", "Mouse disconnected before operation", "鼠标连接已断开，请重新连接。");
        if (!values_.contains(capability)) throw Error("unavailable", "Capability value unavailable", "此配置暂不支持这项调整。");
        if (method == "capability.read") return values_[capability];
        if (!params.contains("value")) throw Error("invalid_argument", "Missing value", "缺少设置值。");
        emit_("diagnostic", {{"operation", "write"}, {"capability", capability}});
        ghub::writeSetting(*backend_, info_, capability, params["value"]);
        // Acknowledgements can precede profile-change notifications; confirm without replaying a write.
        for (int attempt = 0; attempt < 16; ++attempt) {
            if (attempt) std::this_thread::sleep_for(std::chrono::milliseconds(125));
            refresh();
            if (phase_ == "connected" && values_.contains(capability) && values_[capability]["value"] == params["value"]) {
                auto value = values_[capability]; value["verified"] = true; return value;
            }
            const auto connection = unavailable_.value("connection", Json::object());
            if (connection.value("code", "") == "ghub_unavailable" || connection.value("code", "") == "ghub_timeout") break;
        }
        throw Error("readback_mismatch", "G HUB readback did not confirm write", "设置还未确认，请刷新查看。", {{"capability", capability}});
    }
};
}
std::unique_ptr<Device> createDevice(Emit emit) { return std::make_unique<GHub>(std::move(emit)); }
}

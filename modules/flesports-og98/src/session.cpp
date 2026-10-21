#include "session.hpp"
#include <chrono>
#include <fstream>

namespace og98 {
namespace {
std::string textParam(const Json& params, const char* name, const std::string& fallback = {}) {
    if (!params.contains(name)) return fallback;
    if (!params[name].is_string()) throw Error("invalid_argument", std::string(name) + " must be a string", "参数格式不正确。" );
    const auto value = params[name].get<std::string>();
    if (value.find('\0') != std::string::npos) throw Error("invalid_argument", "Embedded NUL in parameter", "参数格式不正确。" );
    return value;
}
Json firmwareValue(const Payload& p) {
    return {{"raw", p[1] | (p[2] << 8)}, {"bytes", {p[1], p[2]}}};
}
}
void Session::log(const std::string& event, const Json& data) noexcept {
    if (logPath_.empty()) return;
    try {
        if (std::filesystem::exists(logPath_) && std::filesystem::file_size(logPath_) >= 2 * 1024 * 1024) {
            for (int i = 3; i >= 1; --i) {
                auto to = logPath_; to += "." + std::to_string(i);
                auto from = logPath_; if (i > 1) from += "." + std::to_string(i - 1);
                if (std::filesystem::exists(to)) std::filesystem::remove(to);
                if (std::filesystem::exists(from)) std::filesystem::rename(from, to);
            }
        }
        const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        const Json entry{{"timeUnixMs", now}, {"sequence", sequence_}, {"id", requestId_}, {"event", event}, {"data", data}};
        std::ofstream stream(logPath_, std::ios::app | std::ios::binary);
        stream << entry.dump() << '\n';
        if (!stream) throw std::runtime_error("Cannot append diagnostic log");
    } catch (const std::exception& e) { logError_ = e.what(); }
}
Json Session::get(const std::string& setting) {
    if (!receiver_) throw Error("not_connected", "No receiver session", "请先连接键盘。" );
    if (setting == "firmware") return firmwareValue(receiver_->query(0x80));
    if (setting == "profile") return receiver_->query(0x85)[1];
    if (setting == "lighting") return lightValue(receiver_->query(0x87));
    if (setting == "debounce") return receiver_->query(0x91)[2];
    if (setting == "autoOS") return receiver_->query(0x97)[1] != 0;
    if (setting == "reportRate") {
        const auto profile = receiver_->query(0x85)[1];
        const auto raw = receiver_->query(0x84, profile)[2];
        Json rate = nullptr;
        if (raw == 1 || raw == 2 || raw == 4 || raw == 8) rate = 1000 / raw;
        return {{"hz", rate}, {"raw", raw}};
    }
    if (setting == "sleep") {
        const auto p = receiver_->query(0x92);
        return {{"bluetoothSeconds", p[1] | (p[2] << 8)}, {"wirelessSeconds", p[3] | (p[4] << 8)},
                {"bluetoothDeepSeconds", p[5] | (p[6] << 8)}, {"wirelessDeepSeconds", p[7] | (p[8] << 8)}};
    }
    if (setting == "keymap" || setting == "fnKeymap") return receiver_->keymap(setting == "fnKeymap");
    if (setting == "keyboardOptions") {
        const auto profile = receiver_->query(0x85)[1];
        const auto p = receiver_->query(0x86, profile);
        // Keep raw flags: the vendor getter/setter disagree about the OS bit.
        return {{"raw", {p[2], p[3], p[4]}}, {"winLocked", (p[2] & 1) != 0}, {"wasdSwapped", (p[2] & 8) != 0},
                {"ledOff", (p[2] & 16) != 0}, {"keyboardLocked", (p[2] & 128) != 0}, {"powerSave", p[4] != 0}};
    }
    throw Error("unsupported_setting", "Unknown readable setting: " + setting, "暂不支持此设置。" );
}
Json Session::dispatch(const std::string& method, const Json& params) {
    if (method == "initialize") {
        if (params.contains("offline") && !params["offline"].is_boolean())
            throw Error("invalid_argument", "offline must be boolean", "参数格式不正确。" );
        const auto path = textParam(params, "logPath");
        const auto logFile = std::filesystem::path(std::u8string(path.begin(), path.end()));
        if (!logFile.empty()) {
            if (logFile.has_parent_path()) std::filesystem::create_directories(logFile.parent_path());
            std::ofstream check(logFile, std::ios::app | std::ios::binary);
            if (!check) throw Error("log_unavailable", "Cannot open log file", "无法创建诊断日志，请检查目录权限。" );
        }
        receiver_.reset(); devicePath_.clear();
        offline_ = params.value("offline", false); logPath_ = logFile; logError_.clear();
        log("session.initialize", {{"offline", offline_}, {"version", "0.2.0"}});
        return {{"version", "0.2.0"}, {"offline", offline_}};
    }
    if (method == "describe") return {
        {"version", "0.2.0"}, {"apiVersion", 1}, {"transport", "Windows USB HID / 2.4GHz"},
        {"get", {"firmware", "profile", "reportRate", "lighting", "debounce", "sleep", "autoOS", "keyboardOptions"}},
        {"set", {{"brightness", {{"min", 0}, {"max", 4}, {"readback", true}}}}},
        {"modelDetection", "candidate_only; connect requires model=OG98"}};
    if (method == "scan") {
        if (receiver_) return Json::array({{{"path", devicePath_}, {"sessionOpen", true}, {"offline", offline_}}});
        if (offline_) return Json::array({{{"path", "sim://og98"}, {"candidateModel", "OG98"}, {"offline", true}}});
        return enumerateDevices();
    }
    if (method == "connect") {
        if (!offline_ && textParam(params, "model") != "OG98")
            throw Error("model_required", "Shared VID/PID is not sufficient model identification; specify model=OG98",
                        "请确认键盘型号为 OG98。" );
        std::string path = textParam(params, "path");
        if (receiver_) throw Error("already_connected", "Disconnect before opening another receiver", "键盘已经连接。" );
        std::unique_ptr<FeatureIo> io;
        if (offline_) { path = "sim://og98"; io = makeSimulator(); }
        else {
            const auto candidates = enumerateDevices();
            if (path.empty()) {
                if (candidates.empty()) throw Error("device_not_found", "No matching control collection found", "未找到接收器，请检查 USB 连接。" );
                if (candidates.size() != 1) throw Error("device_ambiguous", "Multiple receivers; specify path from scan", "找到多个接收器，请选择要连接的键盘。", {{"devices", candidates}});
                path = candidates[0]["path"].get<std::string>();
            }
            bool found = false;
            for (const auto& candidate : candidates) if (candidate["path"] == path) found = true;
            if (!found) throw Error("unsupported_device", "Path must name a currently enumerated compatible feature collection", "设备已断开或暂不支持这个连接。" );
            io = openDevice(path);
        }
        auto receiver = std::make_unique<Receiver>(std::move(io), [this](const auto& event, const auto& data) { log(event, data); });
        const auto firmware = firmwareValue(receiver->query(0x80));
        receiver_ = std::move(receiver); devicePath_ = path;
        return {{"receiverOpen", true}, {"keyboardResponded", true}, {"model", "OG98"},
                {"modelSource", offline_ ? "simulator" : "caller"}, {"path", path}, {"firmware", firmware}, {"offline", offline_}};
    }
    if (method == "disconnect") { receiver_.reset(); devicePath_.clear(); return {{"receiverOpen", false}}; }
    if (method == "get") return get(textParam(params, "name"));
    if (method == "status") {
        Json status{{"offline", offline_}, {"path", devicePath_}};
        for (const auto* name : {"firmware", "profile", "reportRate", "lighting", "debounce", "sleep", "autoOS", "keyboardOptions"})
            status[name] = get(name);
        return status;
    }
    if (method == "setKey") {
        if (!receiver_) throw Error("not_connected", "No receiver session", "请先连接键盘。");
        return receiver_->setKey(params);
    }
    if (method == "set" && textParam(params, "name") == "keyboardOptions") {
        if (!receiver_) throw Error("not_connected", "No receiver session", "请先连接键盘。");
        const auto result = receiver_->setOptions(params.value("value", Json::object()));
        return {{"after", get("keyboardOptions")}, {"verified", result["verified"]}};
    }
    if (method == "set") {
        if (textParam(params, "name") != "brightness")
            throw Error("unsupported_setting", "Only brightness is writable in this foundation", "暂不支持修改此设置。" );
        if (!params.contains("value") || !params["value"].is_number_integer() || params["value"] < 0 || params["value"] > 4)
            throw Error("invalid_argument", "brightness must be an integer in [0,4]", "亮度范围是 0 到 4。" );
        if (!receiver_) throw Error("not_connected", "No receiver session", "请先连接键盘。" );
        return receiver_->setBrightness(params["value"].get<int>());
    }
    throw Error("unknown_method", "Unsupported API method: " + method, "暂不支持此操作。" );
}
Json Session::request(const std::string& text) {
    std::lock_guard lock(mutex_);
    ++sequence_; requestId_ = nullptr;
    Json response{{"apiVersion", 1}, {"id", nullptr}, {"ok", false}};
    const auto start = std::chrono::steady_clock::now();
    try {
        if (text.size() > 65536) throw Error("invalid_request", "Request exceeds 64 KiB", "请求内容过长。" );
        const auto request = Json::parse(text);
        if (!request.is_object()) throw Error("invalid_request", "Request must be an object", "请求格式不正确。" );
        requestId_ = request.value("id", Json(nullptr)); response["id"] = requestId_;
        const auto method = textParam(request, "method");
        const auto params = request.value("params", Json::object());
        if (!params.is_object()) throw Error("invalid_request", "params must be an object", "请求格式不正确。" );
        log("api.request", request);
        response["result"] = dispatch(method, params);
        response["ok"] = true;
    } catch (const Error& e) {
        response["error"] = {{"code", e.code}, {"message", e.what()}, {"userMessage", e.userMessage}, {"details", e.details}};
    } catch (const Json::exception& e) {
        response["error"] = {{"code", "invalid_request"}, {"message", e.what()}, {"userMessage", "请求格式不正确。"}};
    } catch (const std::exception& e) {
        response["error"] = {{"code", "internal_error"}, {"message", e.what()}, {"userMessage", "操作未完成，请导出日志以便排查。"}};
    }
    response["elapsedMs"] = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
    log("api.response", response);
    if (!logError_.empty()) response["logWarning"] = logError_;
    return response;
}
}

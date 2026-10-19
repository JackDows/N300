#include "settings.hpp"
#include <algorithm>

namespace ghub {
namespace {
Json get(Backend& backend, const std::string& path, const Json& payload = nullptr) { return backend.request("GET", path, payload); }
Json optional(Backend& backend, const std::string& path) {
    try { return get(backend, path); }
    catch (const Error& e) { if (e.data["code"] == "unsupported_capability") return Json::object(); throw; }
}
Json clean(Json value) { value.erase("@type"); return value; }
void require(bool valid, const std::string& message = "Unknown G HUB settings shape") {
    if (!valid) throw Error("unsupported_settings", message, "此配置暂不能调整，请先在 G HUB 中选择可编辑的鼠标配置。");
}
bool writable(const Json& card) { return card.is_object() && card.contains("id") && card["id"].is_string() && !card["id"].get<std::string>().empty() && !card.value("readOnly", true); }
std::string displayName(const Json& value, const char* fallback) {
    const auto name = value.value("name", std::string());
    return name.empty() || name.starts_with("PROFILE_NAME_") || name.starts_with("DEFAULT_CARD_") ? fallback : name;
}
}
std::string identity(const Json& device) {
    const auto signature = device.value("deviceSignature", std::string());
    if (signature.empty()) throw Error("invalid_device", "G HUB device has no stable signature", "暂时无法识别这台设备，请刷新 G HUB。");
    return deskhub::resourceId("ghub:", signature);
}
Json mice(Backend& backend) {
    const auto result = get(backend, "/devices/list");
    require(result.contains("deviceInfos") && result["deviceInfos"].is_array(), "Missing deviceInfos array");
    Json devices = Json::array();
    for (const auto& device : result["deviceInfos"]) {
        if (device.value("deviceType", "") == "MOUSE" && !device.value("deviceSignature", "").empty()) devices.push_back(device);
    }
    return devices;
}
Settings readSettings(Backend& backend, const Json& device) {
    Settings output;
    const auto id = device.at("id").get<std::string>();
    const auto base = "/onboard_profiles/" + id;
    const auto mode = get(backend, base + "/onboard_mode");
    output.onboard = mode.value("enabled", false);
    output.values["device.onboardMode"] = {{"value", output.onboard}, {"writable", device.value("capabilities", Json::object()).value("onboardProfiles", Json::object()).value("supportsOnboardMode", false)}};
    Json settings, table;
    int selected = 0;
    bool stageWritable = false, rateWritable = false;
    if (output.onboard) {
        const auto directory = get(backend, base + "/profiles");
        const auto active = get(backend, base + "/active_profile");
        output.profileId = active.value("onboardSlotId", std::string());
        Json choices = Json::array();
        for (const auto& entry : directory.value("directoryEntries", Json::array())) {
            if (!entry.value("enabled", false)) continue;
            const auto slot = entry.value("onboardSlotId", std::string());
            const auto fallback = "配置 " + std::to_string(choices.size() + 1);
            choices.push_back({{"value", slot}, {"label", displayName(entry, fallback.c_str())}});
            if (slot == output.profileId) settings = entry.value("mouseSettings", Json::object());
        }
        output.values["mouse.profile"] = {{"value", output.profileId}, {"choices", choices}, {"writable", choices.size() > 1}, {"label", "板载配置"}};
        if (settings.is_null() || settings.empty()) return output;
    } else {
        const auto active = get(backend, "/profile/active");
        output.profileId = active.value("id", std::string());
        require(!output.profileId.empty(), "No active software profile");
        const auto profile = get(backend, "/profile", {{"id", output.profileId}});
        output.values["mouse.profile"] = {{"value", output.profileId}, {"label", displayName(profile, "默认配置")}, {"writable", false}};
        auto prefix = device.value("slotPrefix", std::string());
        const auto caps = device.value("capabilities", Json::object());
        if (caps.value("individuality", false) && device.value("individualMode", false)) prefix = device.at("deviceSignature").get<std::string>() + ":" + prefix;
        require(!prefix.empty(), "Missing slot prefix");
        for (const auto& assignment : profile.value("assignments", Json::array())) {
            const auto slot = assignment.value("slotId", std::string());
            if (slot == prefix + "_mouse_sensitivity") output.sensitivity = get(backend, "/card", {{"id", assignment.at("cardId")}});
            else if (slot == prefix + "_mouse_settings") output.card = get(backend, "/card", {{"id", assignment.at("cardId")}});
        }
        if (!output.sensitivity.is_null()) {
            const auto reference = output.sensitivity.value("mouseSensitivity", Json::object());
            require(reference.contains("presetId") && reference["presetId"].is_string(), "Missing sensitivity preset reference");
            output.card = get(backend, "/card", {{"id", reference["presetId"]}});
            selected = reference.value("activeDpiIndex", 0);
            stageWritable = writable(output.sensitivity);
        } else stageWritable = writable(output.card);
        if (output.card.is_null() || !output.card.contains("mouseSettings")) return output;
        settings = output.card["mouseSettings"];
        rateWritable = writable(output.card);
    }
    Json choices = Json::array();
    std::string stage;
    if (settings.contains("advancedDpiTable")) {
        table = settings["advancedDpiTable"];
        if (!selected) selected = table.value("defaultIndex", 0);
        stage = std::to_string(selected);
        const auto entries = table.value("entries", Json::object());
        require(entries.is_object(), "Invalid advanced DPI entries");
        for (const auto& [key, entry] : entries.items()) {
            if (entry.value("disabled", false)) continue;
            const bool asymmetric = table.value("advancedEnabled", false) && entry.value("asymmetric", false);
            const auto dpi = entry.value("dpi", 0), x = asymmetric ? entry.value("dpiX", 0) : dpi, y = asymmetric ? entry.value("dpiY", 0) : dpi;
            if (x <= 0 || y <= 0) continue;
            choices.push_back({{"value", key}, {"label", x == y ? std::to_string(x) : std::to_string(x) + " × " + std::to_string(y)}, {"dpiX", x}, {"dpiY", y}});
        }
    } else if (settings.contains("dpiTable")) {
        table = settings["dpiTable"];
        const auto levels = table.value("levels", Json::array());
        require(levels.is_array(), "Invalid DPI levels");
        const auto active = table.value(output.onboard ? "defaultDpi" : "activeDpi", 0);
        for (size_t i = 0; i < levels.size(); ++i) {
            require(levels[i].is_number_integer(), "Invalid DPI value");
            const auto key = std::to_string(i + 1), dpi = std::to_string(levels[i].get<int>());
            if (levels[i] == active && stage.empty()) stage = key;
            choices.push_back({{"value", key}, {"label", dpi}, {"dpiX", levels[i]}, {"dpiY", levels[i]}});
        }
    }
    if (!choices.empty()) output.values["mouse.dpiStage"] = {{"value", stage}, {"choices", choices}, {"writable", stageWritable}, {"label", output.onboard ? "默认 DPI" : "灵敏度"}};
    const auto rates = optional(backend, "/report_rate/" + id + "/report_rate_list");
    const auto report = settings.value("reportRate", Json::object());
    const bool wireless = device.value("connectionType", std::string()) == "WIRELESS" && report.contains("wirelessRate");
    auto allowed = wireless && rates.contains("wirelessRates") && !rates["wirelessRates"].empty() ? rates["wirelessRates"] : rates.value("rates", Json::array());
    require(allowed.is_array(), "Invalid report rate list");
    Json rateChoices = Json::array();
    for (const auto& rate : allowed) if (rate.is_number_integer() && rate.get<int>() > 0) rateChoices.push_back({{"value", rate}, {"label", std::to_string(rate.get<int>()) + " Hz"}});
    const auto value = report.value(wireless ? "wirelessRate" : "value", 0);
    if (value > 0) output.values["mouse.reportRate"] = {{"value", value}, {"choices", rateChoices}, {"writable", rateWritable && !rateChoices.empty()}, {"wireless", wireless}};
    return output;
}
void writeSetting(Backend& backend, const Json& device, const std::string& capability, const Json& value) {
    auto settings = readSettings(backend, device);
    if (!settings.values.contains(capability)) throw Error("unavailable", "Setting not available", "暂时没有这项设置的数据。");
    const auto& reading = settings.values[capability];
    if (!reading.value("writable", false)) throw Error("setting_read_only", "Current mode or preset is read only", settings.onboard ? "切换到软件控制后再调整此项。" : "请先在 G HUB 中选择可编辑的鼠标配置。");
    if (reading.contains("choices") && std::none_of(reading["choices"].begin(), reading["choices"].end(), [&](const Json& item) { return item["value"] == value; }))
        throw Error("invalid_argument", "Value is not a current choice", "请选择设备支持的选项。");
    const auto id = device.at("id").get<std::string>();
    if (capability == "device.onboardMode") {
        if (!value.is_boolean()) throw Error("invalid_argument", "Expected boolean", "参数格式不正确。");
        backend.request("SET", "/onboard_profiles/" + id + "/onboard_mode", {{"mode", value.get<bool>() ? "ONBOARD" : "HOST"}}); return;
    }
    if (capability == "mouse.profile") { backend.request("SET", "/onboard_profiles/" + id + "/active_profile", {{"onboardSlotId", value}}); return; }
    // Read immediately before mutation; never write a cached whole profile or another device's assignment.
    if (get(backend, "/profile/active").value("id", std::string()) != settings.profileId)
        throw Error("profile_changed", "G HUB switched active profiles", "当前配置已切换，请重新调整。");
    Json card = settings.card;
    if (capability == "mouse.dpiStage") {
        if (!settings.sensitivity.is_null()) { card = settings.sensitivity; card["mouseSensitivity"]["activeDpiIndex"] = std::stoi(value.get<std::string>()); }
        else {
            const auto& choices = reading["choices"];
            const auto choice = std::find_if(choices.begin(), choices.end(), [&](const Json& c) { return c["value"] == value; });
            card["mouseSettings"]["dpiTable"]["activeDpi"] = (*choice)["dpiX"];
        }
    } else if (capability == "mouse.reportRate") card["mouseSettings"]["reportRate"][reading.value("wireless", false) ? "wirelessRate" : "value"] = value;
    else throw Error("unsupported_capability", "Unsupported G HUB write", "此设备暂不支持这项操作。");
    backend.request("SET", "/card", clean(card));
}
}

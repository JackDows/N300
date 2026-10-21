#include "client.hpp"

namespace ghub {
namespace {
class SimulatedBackend final : public Backend {
    bool onboard_ = false;
    std::string slot_ = "PROFILE_1";
    Json sensitivity_{{"id", "sensitivity"}, {"readOnly", false}, {"attribute", "MOUSE_SENSITIVITY"}, {"mouseSensitivity", {{"presetId", "preset"}, {"activeDpiIndex", 3}}}};
    Json preset_, profile_, cards_ = Json::object();
    unsigned nextCard_ = 0;
public:
    SimulatedBackend() {
        Json entries = Json::object();
        const int levels[] = {800, 1200, 1600, 2400, 3200};
        for (int i = 0; i < 5; ++i) entries[std::to_string(i + 1)] = {{"dpi", levels[i]}, {"dpiX", levels[i]}, {"dpiY", levels[i]}, {"asymmetric", false}, {"disabled", false}, {"lod", 2}};
        preset_ = {{"id", "preset"}, {"readOnly", false}, {"attribute", "MOUSE_SETTINGS_ADVANCED"}, {"mouseSettings", {
            {"advancedDpiTable", {{"entries", entries}, {"defaultIndex", 3}, {"shiftIndex", 3}, {"advancedEnabled", false}}},
            {"reportRate", {{"value", 1000}, {"wirelessRate", 1000}}}, {"correctionId", "preserved-calibration"}}}};
        profile_ = {{"id","default"},{"name","桌面"},{"applicationId","desktop"},{"assignments",Json::array({{{"slotId","demo_mouse_sensitivity"},{"cardId","sensitivity"}}})}};
        const char* names[] = {"PRIMARY_CLICK","SECONDARY_CLICK","MIDDLE_CLICK","BACK","FORWARD"};
        for (int button = 1; button <= 5; ++button) {
            const auto id = "button-" + std::to_string(button);
            cards_[id] = {{"id",id},{"name",names[button-1]},{"readOnly",true},{"attribute","MACRO_PLAYBACK"},{"applicationId","desktop"},{"macro",{{"type","MOUSE"},{"mouse",{{"action","BUTTON"},{"hidUsage",button}}}}}};
            for (const auto* suffix : {"", "_shifted"}) profile_["assignments"].push_back({{"slotId","demo_g"+std::to_string(button)+"_m1"+suffix},{"cardId",id}});
        }
    }
    void cancel() noexcept override {}
    Json request(const std::string& verb, const std::string& path, const Json& payload) override {
        if (verb == "GET") {
            if (path == "/devices/list") return {{"deviceInfos", Json::array({{
                {"id", "demo"}, {"deviceSignature", "MOUSE.deskhub_demo.1"}, {"deviceType", "MOUSE"}, {"deviceBaseModel", "deskhub_demo"},
                {"displayName", "PRO X SUPERLIGHT 2 SE"}, {"deviceModel", "pro_x_2_wireless_mouse_ext5"}, {"state", "ACTIVE"},
                {"slotPrefix", "demo"}, {"connectionType", "WIRELESS"}, {"displayConnectionType", "LIGHTSPEED"}, {"onboardMode", onboard_},
                {"fwInfo", Json::array({{{"firmwareVersion", "32.5.29"}}})},
                {"capabilities", {{"onboardProfiles", {{"supportsOnboardMode", true}}}}}
            }})}};
            if (path == "/onboard_profiles/demo/onboard_mode") return {{"enabled", onboard_}};
            if (path == "/onboard_profiles/demo/profiles") return {{"directoryEntries", Json::array({
                {{"onboardSlotId", "PROFILE_1"}, {"name", "配置 1"}, {"enabled", true}, {"mouseSettings", preset_["mouseSettings"]}},
                {{"onboardSlotId", "PROFILE_2"}, {"name", "配置 2"}, {"enabled", true}, {"mouseSettings", preset_["mouseSettings"]}}
            })}};
            if (path == "/onboard_profiles/demo/active_profile") return {{"onboardSlotId", slot_}};
            if (path == "/report_rate/demo/report_rate_list") return {{"rates", {125, 250, 500, 1000}}, {"wirelessRates", {125, 250, 500, 1000, 2000}}};
            if (path == "/battery/demo/state") return {{"percentage", 82}, {"charging", false}};
            if (path == "/profile/active") return {{"id", "default"}};
            if (path == "/profile") return profile_;
            if (path == "/profiles") return {{"profiles",Json::array({profile_})}};
            if (path == "/cards") { Json values = Json::array(); for (const auto& [_, card] : cards_.items()) values.push_back(card); return {{"cards",values}}; }
            if (path == "/macros/validate") return {{"isValid",true},{"isOnboardable",true}};
            if (path == "/card" && payload.value("id", "") == "sensitivity") return sensitivity_;
            if (path == "/card" && payload.value("id", "") == "preset") return preset_;
            if (path == "/card" && cards_.contains(payload.value("id", ""))) return cards_[payload["id"].get<std::string>()];
        }
        if (verb == "SET") {
            if (path == "/onboard_profiles/demo/onboard_mode") { onboard_ = payload.at("mode") == "ONBOARD"; return {{"enabled", onboard_}}; }
            if (path == "/onboard_profiles/demo/active_profile") { slot_ = payload.at("onboardSlotId"); return payload; }
            if (path == "/card" && payload.value("id", "") == "sensitivity") { sensitivity_ = payload; return sensitivity_; }
            if (path == "/card" && payload.value("id", "") == "preset") { preset_ = payload; return preset_; }
            if (path == "/card") {
                auto card = payload; const auto id = payload.value("id", "macro-" + std::to_string(++nextCard_));
                card["id"] = id; card["readOnly"] = false; cards_[id] = card; return card;
            }
            if (path == "/assignment") {
                for (auto& a : profile_["assignments"]) if (a["slotId"] == payload.at("slotId")) {
                    if (payload.value("restoreDefault",false)) a["cardId"] = "button-"+std::to_string(std::stoi(a["slotId"].get<std::string>().substr(6)));
                    else a["cardId"] = payload.at("card").at("id");
                    return {{"card",cards_.at(a["cardId"].get<std::string>())},{"slotId",a["slotId"]}};
                }
            }
        }
        if (verb == "REMOVE" && path == "/card") { cards_.erase(payload.at("id").get<std::string>()); return Json::object(); }
        throw Error("unsupported_capability", "Unsupported simulated G HUB route: " + path, "此设备暂不支持这项操作。");
    }
};
}
std::unique_ptr<Backend> simulator() { return std::make_unique<SimulatedBackend>(); }
}

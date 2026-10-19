#include "settings.hpp"
#include <iostream>
#include <stdexcept>
using namespace ghub;
void check(bool condition, const char* reason) { if (!condition) throw std::runtime_error(reason); }
template<class F> void rejects(F run, const char* code) {
    try { run(); } catch (const Error& e) { check(e.data["code"] == code, "Wrong error code"); return; }
    throw std::runtime_error("Operation should have been rejected");
}
class Classic final : public Backend {
public:
    std::unique_ptr<Backend> base = simulator();
    Json card{{"id", "classic"}, {"readOnly", false}, {"profileId", "default"}, {"keep", "unrelated"}, {"mouseSettings", {
        {"dpiTable", {{"levels", {400, 800, 1600}}, {"activeDpi", 800}, {"defaultDpi", 1600}, {"shiftDpi", 400}}},
        {"reportRate", {{"value", 1000}}}}}};
    int mutations = 0, activeReads = 0;
    bool switchProfile = false;
    void cancel() noexcept override {}
    Json request(const std::string& verb, const std::string& path, const Json& payload = nullptr) override {
        if (path == "/profile/active" && switchProfile && ++activeReads > 1) return {{"id", "another-profile"}};
        if (verb == "GET" && path == "/profile") return {{"id", "default"}, {"assignments", Json::array({{{"slotId", "demo_mouse_settings"}, {"cardId", "classic"}}})}};
        if (path == "/card") { if (verb == "SET") { ++mutations; card = payload; } return card; }
        return base->request(verb, path, payload);
    }
};
int main() {
    try {
        auto backend = simulator(); auto device = mice(*backend).at(0);
        check(identity(device) == "ghub:mouse.deskhub_demo.1", "Stable identity");
        auto initial = readSettings(*backend, device);
        check(initial.values["mouse.dpiStage"]["value"] == "3", "Advanced active stage");
        check(initial.values["mouse.dpiStage"]["choices"].size() == 5, "Advanced stages");
        const auto preset = backend->request("GET", "/card", {{"id", "preset"}});
        writeSetting(*backend, device, "mouse.dpiStage", "2");
        check(readSettings(*backend, device).values["mouse.dpiStage"]["value"] == "2", "DPI stage write");
        check(backend->request("GET", "/card", {{"id", "preset"}}) == preset, "Selecting stage must preserve calibration, preset and rates");
        writeSetting(*backend, device, "mouse.reportRate", 500);
        const auto changed = backend->request("GET", "/card", {{"id", "preset"}});
        check(changed["mouseSettings"]["reportRate"]["wirelessRate"] == 500, "Wireless rate");
        check(changed["mouseSettings"]["reportRate"]["value"] == 1000, "Wired rate preserved");
        check(changed["mouseSettings"]["advancedDpiTable"] == preset["mouseSettings"]["advancedDpiTable"], "DPI table preserved");
        rejects([&] { writeSetting(*backend, device, "mouse.reportRate", 333); }, "invalid_argument");
        rejects([&] { writeSetting(*backend, device, "mouse.dpiStage", "999"); }, "invalid_argument");
        writeSetting(*backend, device, "device.onboardMode", true);
        check(readSettings(*backend, device).onboard, "Onboard mode write");
        rejects([&] { writeSetting(*backend, device, "mouse.dpiStage", "1"); }, "setting_read_only");
        writeSetting(*backend, device, "mouse.profile", "PROFILE_2");
        check(readSettings(*backend, device).profileId == "PROFILE_2", "Board profile switch");
        writeSetting(*backend, device, "device.onboardMode", false);
        Classic legacy;
        writeSetting(legacy, device, "mouse.dpiStage", "1");
        check(legacy.card["mouseSettings"]["dpiTable"]["activeDpi"] == 400, "Classic DPI write");
        check(legacy.card["mouseSettings"]["dpiTable"]["shiftDpi"] == 400 && legacy.card["keep"] == "unrelated", "Unrelated settings preserved");
        legacy.card["readOnly"] = true;
        rejects([&] { writeSetting(legacy, device, "mouse.reportRate", 500); }, "setting_read_only");
        check(legacy.mutations == 1, "No mutation for readonly preset");
        Classic changedProfile; changedProfile.switchProfile = true;
        rejects([&] { writeSetting(changedProfile, device, "mouse.dpiStage", "1"); }, "profile_changed");
        check(changedProfile.mutations == 0, "Profile change must prevent stale write");
        std::cout << "G HUB settings, modes, validation and preservation passed\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}

#include "macros.hpp"
#include <algorithm>
#include <set>
#include <regex>
#include <thread>

namespace ghub {
namespace {
Json get(Backend& b, const std::string& path, const Json& payload = nullptr) { return b.request("GET",path,payload); }
[[noreturn]] void invalid(const char* message = "宏的动作或参数不完整，请检查后再保存。") { throw Error("invalid_argument", "Invalid macro specification", message); }
int number(const Json& value, int minimum, int maximum) {
    long long result = -1;
    if (value.is_number_integer()) { if (value < minimum || value > maximum) invalid(); result = value.get<long long>(); }
    else if (value.is_string()) {
        try { size_t end = 0; result = std::stoll(value.get<std::string>(), &end); if (end != value.get_ref<const std::string&>().size()) invalid(); }
        catch (const std::exception&) { invalid(); }
    } else invalid();
    if (result < minimum || result > maximum) invalid(); return static_cast<int>(result);
}
std::string string(const Json& value, const char* field) {
    if (!value.contains(field) || !value[field].is_string()) invalid();
    return value[field].get<std::string>();
}
Json clean(Json value) { value.erase("@type"); return value; }
Json active(Backend& b, const Json& args = Json::object()) {
    const auto id = get(b, "/profile/active").value("id", std::string());
    if (id.empty()) throw Error("profile_unavailable", "No active G HUB profile", "请先在 G HUB 中选择配置。");
    if (args.contains("profileId") && args["profileId"] != id) throw Error("profile_changed", "Active profile changed", "当前配置已切换，请重新读取后操作。");
    return get(b, "/profile", {{"id",id}});
}
void confirmProfile(Backend& b, const Json& profile) {
    if (get(b, "/profile/active").value("id", std::string()) != profile.at("id").get<std::string>()) throw Error("profile_changed", "Profile changed before mutation", "当前配置已切换，请重新操作。");
}
std::string prefix(const Json& d) {
    auto value = d.value("slotPrefix", std::string());
    if (d.value("capabilities", Json::object()).value("individuality",false) && d.value("individualMode",false)) value = d.at("deviceSignature").get<std::string>() + ":" + value;
    return value;
}
bool slotMatches(const std::string& slot, const std::string& base) {
    if (base.empty() || !slot.starts_with(base + "_g")) return false;
    return std::regex_match(slot.substr(base.size()), std::regex("_g([1-9][0-9]?)_m1(_shifted)?"));
}
Json summary(const Json& card) {
    const auto macro = card.value("macro", Json::object());
    return {{"id",card.value("id",std::string())},{"name",card.value("name",std::string())},{"type",macro.value("type",std::string())},{"readOnly",card.value("readOnly",true)}};
}
Json components(const Json& sequence, const char* name) { return sequence.value(name,Json::object()).value("components",Json::array()); }
Json decodeSteps(const Json& values) {
    if (!values.is_array() || values.size() > 256) invalid();
    Json output = Json::array();
    for (const auto& value : values) {
        Json step;
        if (value.contains("keyboard")) {
            const auto& k = value["keyboard"];
            if (!k.value("isDown",Json()).is_boolean()) invalid();
            step = {{"type","key"},{"code",number(k.at("hidUsage"),4,231)},{"down",k["isDown"]},{"label",k.value("displayName",std::string())}};
        } else if (value.contains("mouse") && value["mouse"].contains("button")) {
            const auto& k = value["mouse"]["button"]; if (!k.value("isDown",Json()).is_boolean()) invalid();
            step = {{"type","mouse"},{"button",number(k.at("hidUsage"),1,8)},{"down",k["isDown"]}};
        } else if (value.contains("mouse") && value["mouse"].contains("wheel")) {
            const auto& wheel = value["mouse"]["wheel"]; const auto usage = number(wheel.at("hidUsage"),0,1000);
            if (usage != 6 && usage != 7) invalid();
            step = {{"type","wheel"},{"axis",usage == 6 ? "vertical" : "horizontal"},{"positive",wheel.at("isPositive")}};
        } else if (value.contains("delay")) step = {{"type","delay"},{"ms",number(value["delay"].at("durationMs"),0,60000)}};
        else invalid("此宏包含暂未支持的动作，可以继续绑定使用。");
        output.push_back(step);
    }
    return output;
}
Json encodeSteps(const Json& steps, std::set<std::string>& pressed) {
    if (!steps.is_array() || steps.size() > 256) invalid();
    Json values = Json::array();
    for (const auto& step : steps) {
        const auto type = string(step,"type");
        if (type == "delay") { values.push_back({{"delay",{{"durationMs",number(step.at("ms"),0,60000)}}}}); continue; }
        if (type == "wheel") {
            const auto axis = step.value("axis","vertical"); if (axis != "vertical" && axis != "horizontal") invalid();
            if (!step.value("positive",Json()).is_boolean()) invalid();
            values.push_back({{"mouse",{{"wheel",{{"hidUsage",axis == "vertical" ? "6" : "7"},{"isPositive",step["positive"]}}}}}}); continue;
        }
        if ((type != "key" && type != "mouse") || !step.value("down",Json()).is_boolean()) invalid();
        const auto code = number(step.at(type == "key" ? "code" : "button"),type == "key" ? 4 : 1,type == "key" ? 231 : 8);
        const auto key = type + ":" + std::to_string(code); const bool down = step["down"].get<bool>();
        if ((down && !pressed.insert(key).second) || (!down && !pressed.erase(key))) invalid("按下和松开动作不匹配，请检查动作顺序。");
        if (type == "key") {
            const auto label = step.value("label",std::string()); if (label.size() > 80) invalid();
            values.push_back({{"keyboard",{{"hidUsage",std::to_string(code)},{"isDown",down},{"displayName",label}}}});
        } else values.push_back({{"mouse",{{"button",{{"hidUsage",std::to_string(code)},{"isDown",down}}}}}});
    }
    return values;
}
void owned(const Json& card, const Json& profile) {
    if (card.value("readOnly",true) || card.value("attribute",std::string()) != "MACRO_PLAYBACK" || card.value("applicationId",std::string()) != profile.value("applicationId",std::string()))
        throw Error("setting_read_only", "Card is readonly or belongs to another application", "此项目只允许绑定，不能修改。");
}
}
Json encodeSequence(const Json& spec) {
    const auto mode = spec.value("mode", "once");
    if (mode != "once" && mode != "hold" && mode != "toggle" && mode != "sequence") invalid();
    Json sequence;
    for (const auto* name : {"simpleSequence","pressSequence","heldSequence","releaseSequence","toggleSequence"}) sequence[name] = {{"components",Json::array()}};
    std::set<std::string> pressed;
    if (mode == "sequence") {
        sequence["pressSequence"]["components"] = encodeSteps(spec.value("press",Json::array()),pressed);
        const auto beforeLoop = pressed;
        sequence["heldSequence"]["components"] = encodeSteps(spec.value("hold",Json::array()),pressed);
        if (beforeLoop != pressed) invalid("按住阶段的按下和松开需要成对。");
        sequence["releaseSequence"]["components"] = encodeSteps(spec.value("release",Json::array()),pressed);
    } else sequence[mode == "once" ? "simpleSequence" : mode == "hold" ? "heldSequence" : "toggleSequence"]["components"] = encodeSteps(spec.value("steps",Json::array()),pressed);
    if (!pressed.empty()) invalid("请为按下的按键添加松开动作。");
    size_t count = 0; for (const auto& [_, part] : sequence.items()) count += part["components"].size();
    if (!count || count > 256) invalid("宏需要包含 1 到 256 个动作。");
    sequence["useSimpleActions"] = mode == "once"; sequence["useRepeatActions"] = mode == "hold"; sequence["useToggleActions"] = mode == "toggle";
    sequence["useDefaultDelay"] = false; sequence["defaultDelay"] = 50; sequence["showUpDown"] = true;
    return sequence;
}
Json decodeMacro(const Json& card) {
    auto result = summary(card); result["editable"] = false;
    const auto macro = card.value("macro",Json::object());
    if (macro.value("type",std::string()) != "SEQUENCE") return result;
    const auto sequence = macro.value("sequence",Json::object());
    const auto mode = sequence.value("useSimpleActions",false) ? "once" : sequence.value("useRepeatActions",false) ? "hold" : sequence.value("useToggleActions",false) ? "toggle" : "sequence";
    try {
        result["mode"] = mode;
        if (mode == std::string("sequence")) {
            result["press"] = decodeSteps(components(sequence,"pressSequence")); result["hold"] = decodeSteps(components(sequence,"heldSequence")); result["release"] = decodeSteps(components(sequence,"releaseSequence"));
        } else result["steps"] = decodeSteps(components(sequence,mode == std::string("once") ? "simpleSequence" : mode == std::string("hold") ? "heldSequence" : "toggleSequence"));
        // Expand implicit delays before editing so saving cannot silently change timing.
        if (sequence.value("useDefaultDelay",false)) {
            const auto delay = number(sequence.value("defaultDelay",Json(50)),0,60000);
            for (const auto* name : {"steps","press","hold","release"}) if (result.contains(name)) {
                Json expanded = Json::array(); for (const auto& step : result[name]) { if (!expanded.empty()) expanded.push_back({{"type","delay"},{"ms",delay}}); expanded.push_back(step); } result[name] = expanded;
            }
        }
        encodeSequence(result); result["editable"] = !card.value("readOnly",true);
    } catch (...) { result["editable"] = false; }
    return result;
}
Json readBindings(Backend& b, const Json& device) {
    const auto profile = active(b); const auto base = prefix(device);
    const bool onboard = get(b,"/onboard_profiles/"+device.at("id").get<std::string>()+"/onboard_mode").value("enabled",false);
    Json buttons = Json::array();
    for (const auto& assignment : profile.value("assignments",Json::array())) {
        const auto slot = assignment.value("slotId",std::string()); if (!slotMatches(slot,base)) continue;
        const int index = std::stoi(slot.substr(base.size()+2));
        Json card; try { card = get(b,"/card",{{"id",assignment.at("cardId")}}); } catch (const Error&) { card = {{"id",assignment.value("cardId",std::string())},{"name","当前功能"}}; }
        buttons.push_back({{"slotId",slot},{"number",index},{"shifted",slot.ends_with("_shifted")},{"card",summary(card)}});
    }
    std::sort(buttons.begin(),buttons.end(),[](const Json& a,const Json& c) { return a["number"] == c["number"] ? a["shifted"] < c["shifted"] : a["number"] < c["number"]; });
    return {{"profileId",profile.at("id")},{"profileName",profile.value("name",std::string())},{"softwareMode",!onboard},{"buttons",buttons}};
}
Json macroOperation(Backend& b, const Json& device, const std::string& op, const Json& args) {
    const auto profile = active(b,args);
    if (op == "macros.list") {
        const auto cards = get(b,"/cards",{{"applicationId",profile.at("applicationId")}}).value("cards",Json::array());
        Json items = Json::array(); for (const auto& card : cards) if (card.value("attribute",std::string()) == "MACRO_PLAYBACK") items.push_back(summary(card));
        const auto offset = number(args.value("offset",Json(0)),0,10000), limit = number(args.value("limit",Json(50)),1,100);
        Json page = Json::array(); for (size_t n = offset; n < items.size() && page.size() < static_cast<size_t>(limit); ++n) page.push_back(items[n]);
        return {{"profileId",profile.at("id")},{"items",page},{"total",items.size()},{"offset",offset}};
    }
    if (op == "macros.get") {
        const auto card = get(b,"/card",{{"id",string(args,"id")}}); auto view = decodeMacro(card);
        if (card.value("applicationId",std::string()) != profile.value("applicationId",std::string())) { view["editable"] = false; view["readOnly"] = true; }
        return view;
    }
    if (op == "macros.save") {
        const auto& spec = args.at("macro"); const auto name = string(spec,"name");
        if (name.empty() || name.size() > 192 || name.find('\0') != std::string::npos || name.find_first_not_of(" \t\r\n") == std::string::npos) invalid("请输入 1 到 64 个字的宏名称。");
        const auto sequence = encodeSequence(spec);
        Json card{{"applicationId",profile.at("applicationId")},{"attribute","MACRO_PLAYBACK"},{"name",name},{"macro",{{"type","SEQUENCE"},{"sequence",sequence}}}};
        if (spec.contains("id") && !spec["id"].get<std::string>().empty()) {
            card = get(b,"/card",{{"id",spec["id"]}}); owned(card,profile);
            if (!decodeMacro(card).value("editable",false)) throw Error("unsupported_macro", "Macro contains unsupported components", "此宏包含暂未支持的动作，可以继续绑定使用。");
            card["name"] = name;
            for (const auto& [key,value] : sequence.items()) {
                if (value.is_object()) card["macro"]["sequence"][key].update(value); else card["macro"]["sequence"][key] = value;
            }
        }
        const auto validation = get(b,"/macros/validate",card["macro"]);
        if (!validation.value("isValid",false)) throw Error("invalid_macro", "G HUB rejected macro sequence", "G HUB 未接受这组宏动作，请检查后重试。");
        card["macro"]["onboardable"] = validation.value("isOnboardable",false); confirmProfile(b,profile);
        const auto saved = b.request("SET","/card",clean(card));
        auto result = decodeMacro(get(b,"/card",{{"id",saved.at("id")}}));
        if (result.value("name",std::string()) != name || encodeSequence(result) != sequence) throw Error("readback_mismatch", "Saved macro differs from requested sequence", "宏已发送，请重新读取确认。");
        result["verified"] = true; return result;
    }
    if (op == "macros.remove") {
        const auto id = string(args,"id"); const auto card = get(b,"/card",{{"id",id}}); owned(card,profile);
        const auto profiles = get(b,"/profiles").value("profiles",Json::array());
        for (const auto& p : profiles) for (const auto& a : p.value("assignments",Json::array())) if (a.value("cardId",std::string()) == id)
            throw Error("macro_in_use", "Macro is assigned to a button", "这个宏仍被按键使用，请先解除绑定。");
        confirmProfile(b,profile); b.request("REMOVE","/card",{{"id",id}}); return {{"removed",true}};
    }
    if (op == "mouse.bindings.set") {
        const auto slot = string(args,"slotId"), base = prefix(device);
        if (!slotMatches(slot,base) || std::none_of(profile["assignments"].begin(),profile["assignments"].end(),[&](const Json& a){return a["slotId"] == slot;})) invalid("请选择这只鼠标的按键。");
        if (get(b,"/onboard_profiles/"+device.at("id").get<std::string>()+"/onboard_mode").value("enabled",false)) throw Error("setting_read_only", "Onboard assignments are readonly", "切换到软件控制后再设置按键。");
        Json payload{{"profile",profile.at("id")},{"slotId",slot},{"returnCard",true}};
        std::string cardId;
        if (args.value("restoreDefault",false)) payload["restoreDefault"] = true;
        else {
            cardId = string(args,"cardId"); const auto card = get(b,"/card",{{"id",cardId}});
            if (card.value("attribute",std::string()) != "MACRO_PLAYBACK") invalid("请选择可绑定的宏或按键功能。");
            payload["card"] = {{"id",cardId}};
        }
        confirmProfile(b,profile); const auto accepted = b.request("SET","/assignment",payload);
        if (cardId.empty()) cardId = accepted.value("card",Json::object()).value("id",std::string());
        if (cardId.empty()) throw Error("write_unconfirmed","Default assignment returned no card identity","设置已发送，请重新同步确认。");
        for (int attempt = 0; attempt < 8; ++attempt) {
            if (attempt) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            const auto after = get(b,"/profile",{{"id",profile.at("id")}});
            const auto& assignments = after["assignments"];
            const auto found = std::find_if(assignments.begin(),assignments.end(),[&](const Json& a){return a["slotId"] == slot;});
            if (found != assignments.end() && (*found)["cardId"] == cardId) return {{"verified",true},{"binding",*found}};
        }
        throw Error("readback_mismatch", "Assignment was not confirmed", "设置已发送，请同步按键确认。");
    }
    throw Error("unsupported_capability","Unknown macro operation","暂不支持此操作。");
}
}

#include "protocol.hpp"
#include "key_layout.hpp"
#include <algorithm>

namespace og98 {
namespace {
Json binding(std::span<const uint8_t,4> bytes) {
    Json result{{"raw", Json::array({bytes[0], bytes[1], bytes[2], bytes[3]})}, {"type", "special"}};
    if (bytes[0] == 0) {
        result["type"] = bytes[1] || bytes[2] || bytes[3] ? "key" : "disabled";
        result["modifier"] = bytes[1]; result["key"] = bytes[2]; result["second"] = bytes[3];
    } else if (bytes[0] == 9) { result["type"] = "macro"; result["slot"] = bytes[2]; }
    else if (bytes[0] == 3) { result["type"] = "media"; result["code"] = bytes[2] | (bytes[3] << 8); }
    return result;
}
bool physicalSlot(int slot) {
    const auto layout = Json::parse(keyLayoutJson);
    return std::any_of(layout.begin(), layout.end(), [&](const Json& key) { return key["slot"] == slot; });
}
int integer(const Json& object, const char* field, int fallback, int minimum, int maximum) {
    const auto value = object.value(field, Json(fallback));
    if (!value.is_number_integer() || value < minimum || value > maximum)
        throw Error("invalid_argument", std::string("Invalid key binding ") + field, "按键设置格式不正确。");
    return value.get<int>();
}
}
Payload Receiver::keyPage(bool fn, uint8_t profile, unsigned page) {
    Payload request{}; request[0] = fn ? 0x90 : 0x89; request[1] = profile; request[2] = static_cast<uint8_t>(page);
    // Matrix pages have no opcode/sequence header. Two equal reads reject stale queued reports.
    const auto first = transact(request, true), second = transact(request, true);
    if (first != second) throw Error("unstable_read", "Keyboard matrix page changed while reading", "键位读取尚未稳定，请再同步一次。");
    return second;
}
Json Receiver::keymap(bool fn) {
    const uint8_t profile = fn ? 0 : query(0x85)[1];
    std::array<uint8_t,512> matrix{};
    for (unsigned page = 0; page < 8; ++page) {
        const auto data = keyPage(fn, profile, page);
        std::copy(data.begin(), data.end(), matrix.begin() + page * 64);
    }
    if (!fn && query(0x85)[1] != profile) throw Error("profile_changed", "Keyboard profile changed during matrix read", "键盘配置已切换，请重新读取。");
    auto keys = Json::parse(keyLayoutJson);
    for (auto& key : keys) {
        const auto index = key["slot"].get<size_t>() * 4;
        key["binding"] = binding(std::span<const uint8_t,4>(matrix.data() + index, 4));
        key["defaultBinding"] = binding(std::span<const uint8_t,4>(defaultKeyMatrix.data() + index, 4));
    }
    return {{"layer", fn ? "fn" : "normal"}, {"profile", profile}, {"keys", keys}, {"matrix", matrix}};
}
Json Receiver::setKey(const Json& parameters) {
    const auto layer = parameters.value("layer", "normal");
    if (layer != "normal" && layer != "fn") throw Error("invalid_argument", "Unknown keyboard layer", "请选择普通层或 Fn 层。");
    const auto slot = integer(parameters, "slot", -1, 0, 127);
    if (!physicalSlot(slot) || !parameters.contains("action") || !parameters["action"].is_object())
        throw Error("invalid_argument", "Unknown physical key or action", "请选择要修改的键。");
    const auto& action = parameters["action"];
    const auto type = action.value("type", std::string());
    std::array<uint8_t,4> encoded{};
    if (type == "key") {
        const auto modifier = integer(action, "modifier", 0, 0, 231);
        const auto key = integer(action, "key", 0, 4, 231), second = integer(action, "second", 0, 0, 231);
        if ((modifier && modifier < 224) || (second && second < 4)) throw Error("invalid_argument", "Invalid HID usage", "请选择有效的按键组合。");
        encoded = {0, static_cast<uint8_t>(modifier), static_cast<uint8_t>(key), static_cast<uint8_t>(second)};
    } else if (type == "media") {
        const auto code = integer(action, "code", -1, 0, 65535);
        const std::array<int,9> supported{0xb6,0xb5,0xb7,0xcd,0xe2,0xea,0xe9,0x192,0x183};
        if (std::find(supported.begin(), supported.end(), code) == supported.end()) throw Error("invalid_argument", "Unsupported consumer action", "请选择支持的媒体功能。");
        encoded = {3,0,static_cast<uint8_t>(code & 255),static_cast<uint8_t>(code >> 8)};
    } else if (type == "default" && layer == "normal") std::copy_n(defaultKeyMatrix.begin() + slot * 4, 4, encoded.begin());
    else if (type == "restore") {
        const auto raw = action.value("raw", Json::array());
        if (!raw.is_array() || raw.size() != 4) throw Error("invalid_argument", "Expected saved four-byte binding", "原绑定数据不完整。");
        for (size_t i = 0; i < 4; ++i) {
            if (!raw[i].is_number_integer() || raw[i] < 0 || raw[i] > 255) throw Error("invalid_argument", "Invalid saved binding byte", "原绑定数据不正确。");
            encoded[i] = raw[i].get<uint8_t>();
        }
    } else if (type != "disabled") throw Error("invalid_argument", "Unsupported binding type", "暂不支持这种按键设置。");
    const bool fn = layer == "fn";
    const uint8_t profile = fn ? 0 : query(0x85)[1];
    if (parameters.contains("profile") && parameters["profile"] != profile) throw Error("profile_changed", "Keyboard profile differs from editor", "键盘配置已切换，请重新同步键位。");
    const auto before = keyPage(fn, profile, slot / 16);
    auto expected = before;
    const auto offset = (slot % 16) * 4;
    const auto old = binding(std::span<const uint8_t,4>(before.data() + offset, 4));
    std::copy(encoded.begin(), encoded.end(), expected.begin() + offset);
    if (!fn && query(0x85)[1] != profile) throw Error("profile_changed", "Keyboard profile changed before key write", "键盘配置已切换，请重新读取。");
    if (expected != before) {
        Payload request{}; request[0] = fn ? 0x15 : 0x13; request[1] = profile; request[2] = static_cast<uint8_t>(slot);
        std::copy(encoded.begin(), encoded.end(), request.begin() + 8);
        send(request, Checksum::Bit7); io_->delay(500);
    }
    try {
        const auto after = keyPage(fn, profile, slot / 16);
        if (after == expected && (fn || query(0x85)[1] == profile))
            return {{"before", old}, {"after", binding(encoded)}, {"verified", true}, {"layer", layer}, {"slot", slot}};
    } catch (const Error& e) {
        throw Error("write_unconfirmed", "Key write sent but readback failed", "设置已发送，请重新同步键位确认。", {{"cause", e.code}, {"slot", slot}});
    }
    throw Error("write_unconfirmed", "Key matrix differs from the one-key edit", "设置尚未确认，请重新同步键位。", {{"slot", slot}});
}
Json Receiver::setOptions(const Json& value) {
    if (!value.is_object() || value.empty()) throw Error("invalid_argument", "Empty keyboard option update", "请选择要调整的选项。");
    for (const auto& [key, item] : value.items()) if ((key != "winLocked" && key != "wasdSwapped") || !item.is_boolean())
        throw Error("invalid_argument", "Unsupported keyboard option", "键盘选项格式不正确。");
    const auto profile = query(0x85)[1]; const auto before = query(0x86, profile);
    if (query(0x85)[1] != profile) throw Error("profile_changed", "Keyboard profile changed before options write", "键盘配置已切换，请重新同步。");
    Payload request{}; std::copy_n(before.begin(), 5, request.begin()); request[0] = 0x06;
    for (const auto& [key, item] : value.items()) { const unsigned mask = key == "winLocked" ? 1 : 8; request[2] = static_cast<uint8_t>(item.get<bool>() ? request[2] | mask : request[2] & ~mask); }
    send(request, Checksum::Bit7); io_->delay(500);
    const auto after = query(0x86, profile);
    if (query(0x85)[1] != profile || !std::equal(request.begin() + 1, request.begin() + 5, after.begin() + 1)) throw Error("write_unconfirmed", "Keyboard options mismatch", "设置已发送，请同步后确认。");
    return {{"verified", true}};
}
}

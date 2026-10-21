#include "protocol.hpp"
#include "key_layout.hpp"
#include <algorithm>
#include <chrono>
#include <thread>
#include <utility>

namespace og98 {
Error::Error(std::string c, std::string technical, std::string user, Json d)
    : std::runtime_error(std::move(technical)), code(std::move(c)), userMessage(std::move(user)), details(std::move(d)) {}

OutReport encode(Payload payload, Checksum checksum) {
    if (checksum != Checksum::None) {
        const size_t index = checksum == Checksum::Bit7 ? 7 : 8;
        unsigned sum = 0;
        for (size_t i = 0; i < index; ++i) sum += payload[i];
        payload[index] = static_cast<uint8_t>(255 - (sum & 255));
    }
    OutReport report{}; // Report ID 0, 64-byte payload, two trailing zeros.
    std::copy(payload.begin(), payload.end(), report.begin() + 1);
    return report;
}
Payload decode(std::span<const uint8_t> report, uint8_t expected) {
    if (report.size() != 65 || report[0] != 0 || report[1] != expected)
        throw Error("unexpected_reply", "Invalid feature report length, report ID, or command", "键盘响应暂时无法识别，请重试。",
                    {{"expectedCommand", expected}, {"length", report.size()}});
    Payload result{};
    std::copy_n(report.begin() + 1, result.size(), result.begin());
    return result;
}
Payload brightnessCommand(const Payload& current, int brightness) {
    if (brightness < 0 || brightness > 4)
        throw Error("invalid_argument", "brightness must be an integer in [0,4]", "亮度范围是 0 到 4。" );
    if (current[0] != 0x87)
        throw Error("unexpected_reply", "Brightness requires a fresh lighting response", "请重新读取灯光设置。" );
    Payload command{};
    // Preserve mode, speed, option and RGB; response tail is not part of the setter.
    std::copy_n(current.begin(), 8, command.begin());
    command[0] = 0x07;
    command[3] = static_cast<uint8_t>(brightness);
    return command;
}
Json lightValue(const Payload& p) {
    Json value{{"mode", p[1]}, {"speedRaw", p[2]}, {"brightness", p[3]},
               {"optionRaw", p[4]}, {"rgbRaw", {p[5], p[6], p[7]}}};
    if (p[1] == 13) value["userPictureSlot"] = (p[4] >> 4) + 1;
    return value;
}
void FeatureIo::delay(unsigned ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }
Receiver::Receiver(std::unique_ptr<FeatureIo> io, Trace trace) : io_(std::move(io)), trace_(std::move(trace)) {}
void Receiver::send(Payload p, Checksum checksum) {
    const auto report = encode(p, checksum);
    if (trace_) trace_("hid.tx", report);
    io_->send(report);
}
InReport Receiver::receive() {
    const auto report = io_->receive();
    if (trace_) trace_("hid.rx", report);
    return report;
}
Payload Receiver::query(uint8_t command, uint8_t profile) {
    Payload request{}; request[0] = command; request[1] = profile;
    return transact(request);
}
Payload Receiver::transact(Payload request, bool rawReply) {
    const auto command = request[0];
    send(request, Checksum::Bit7);
    // Bounded protocol polling. A Windows HID call itself is synchronous.
    for (unsigned attempt = 0; attempt < 50; ++attempt) {
        io_->delay(30);
        Payload poll{}; poll[0] = 0xf7;
        send(poll, Checksum::None); io_->delay(20);
        const auto status = receive();
        if (status[0] != 0) continue;
        // status[2] is not readiness (it can be battery=100 while asleep).
        if (status[1] == 0) continue;
        Payload fetch{}; fetch[0] = 0xfc;
        send(fetch, Checksum::None); io_->delay(20);
        const auto response = receive();
        if (response[0] == 0 && rawReply && response[1] < 0x80) {
            Payload data{}; std::copy_n(response.begin() + 1, 64, data.begin()); return data;
        }
        if (!rawReply && response[0] == 0 && response[1] == command) return decode(response, command);
        if (trace_) trace_("hid.stale_reply", {{"expectedCommand", command}, {"actualCommand", response[1]}});
    }
    throw Error("device_not_responding", "Receiver did not return the requested keyboard reply within 50 polls",
                "键盘暂时没有响应，轻按一下按键后重试。", {{"command", command}, {"receiverPresent", true}});
}
Json Receiver::setBrightness(int value) {
    // Validate before any I/O.
    if (value < 0 || value > 4)
        throw Error("invalid_argument", "brightness must be an integer in [0,4]", "亮度范围是 0 到 4。" );
    const auto before = query(0x87);
    const auto command = brightnessCommand(before, value);
    send(command, Checksum::Bit8);
    io_->delay(500);
    Payload last{};
    try {
        for (unsigned attempt = 0; attempt < 4; ++attempt) {
            last = query(0x87);
            if (std::equal(command.begin() + 1, command.begin() + 8, last.begin() + 1))
                return {{"before", lightValue(before)}, {"after", lightValue(last)}, {"verified", true}};
            io_->delay(150);
        }
    } catch (const Error& e) {
        throw Error("write_unconfirmed", "Setting was sent once, but its readback failed", "设置已发送，暂时无法确认结果，请稍后重新读取。",
                    {{"cause", e.code}, {"writeSent", true}, {"requestedBrightness", value}});
    }
    throw Error("write_unconfirmed", "Lighting readback did not match all seven setting bytes", "设置已发送，暂时无法确认结果，请稍后重新读取。",
                {{"writeSent", true}, {"requestedBrightness", value}, {"lastReadback", lightValue(last)}});
}

class Simulator final : public FeatureIo {
    Payload reply_{}, light_{0x87, 13, 4, 4, 16, 0, 200, 200};
    std::array<uint8_t, 512> keys_ = defaultKeyMatrix, fn_ = defaultKeyMatrix;
    Payload options_{0x86};
    uint8_t last_{};
public:
    void delay(unsigned) override {}
    void send(const OutReport& r) override {
        last_ = r[1];
        if (last_ == 0xf7 || last_ == 0xfc) return;
        if (last_ == 0x07) {
            std::copy_n(r.begin() + 2, 7, light_.begin() + 1);
            return;
        }
        if (last_ == 0x13 || last_ == 0x15) {
            auto& matrix = last_ == 0x13 ? keys_ : fn_;
            if (r[3] < 128) std::copy_n(r.begin() + 9, 4, matrix.begin() + r[3] * 4);
            return;
        }
        if (last_ == 0x06) { std::copy_n(r.begin() + 2, 4, options_.begin() + 1); return; }
        reply_ = {}; reply_[0] = last_;
        switch (last_) {
        case 0x80: reply_[1] = 2; reply_[2] = 1; break;
        case 0x85: break;
        case 0x84: reply_[2] = 1; break;
        case 0x87: reply_ = light_; break;
        case 0x91: reply_[2] = 1; break;
        case 0x92: reply_[1] = 120; reply_[3] = 120; reply_[5] = 88; reply_[6] = 2; break;
        case 0x97: reply_[1] = 1; break;
        case 0x86: reply_ = options_; break;
        case 0x89: case 0x90: {
            const auto& matrix = last_ == 0x89 ? keys_ : fn_;
            if (r[3] < 8) std::copy_n(matrix.begin() + r[3] * 64, 64, reply_.begin());
            break;
        }
        default: throw Error("unsupported_command", "Simulator command not implemented", "暂不支持此操作。" );
        }
    }
    InReport receive() override {
        InReport r{};
        if (last_ == 0xf7) { r[1] = 1; r[2] = 100; }
        else if (last_ == 0xfc) std::copy(reply_.begin(), reply_.end(), r.begin() + 1);
        return r;
    }
};
std::unique_ptr<FeatureIo> makeSimulator() { return std::make_unique<Simulator>(); }
}

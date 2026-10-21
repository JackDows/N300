#pragma once
#include <array>
#include <cstdint>
#include <functional>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace og98 {
using Json = nlohmann::json;
using Payload = std::array<uint8_t, 64>;
using OutReport = std::array<uint8_t, 67>;
using InReport = std::array<uint8_t, 65>;
enum class Checksum { Bit7, Bit8, None };
struct Error : std::runtime_error {
    std::string code, userMessage;
    Json details;
    Error(std::string code, std::string technical, std::string userMessage, Json details = Json::object());
};
OutReport encode(Payload payload, Checksum checksum = Checksum::Bit7);
Payload decode(std::span<const uint8_t> report, uint8_t expected);
Payload brightnessCommand(const Payload& current, int brightness);
Json lightValue(const Payload& payload);

// Only feature reports on the vendor control collection; no keyboard input reports.
class FeatureIo {
public:
    virtual ~FeatureIo() = default;
    virtual void send(const OutReport&) = 0;
    virtual InReport receive() = 0;
    virtual void delay(unsigned milliseconds);
};
using Trace = std::function<void(const std::string&, const Json&)>;
class Receiver {
    std::unique_ptr<FeatureIo> io_;
    Trace trace_;
    void send(Payload, Checksum);
    InReport receive();
    Payload transact(Payload request, bool rawReply = false);
    Payload keyPage(bool fn, uint8_t profile, unsigned page);
public:
    explicit Receiver(std::unique_ptr<FeatureIo> io, Trace trace = {});
    Payload query(uint8_t command, uint8_t profile = 0);
    // A setting write is sent once. Only its readback is retried.
    Json setBrightness(int value);
    Json keymap(bool fn = false);
    Json setKey(const Json& parameters);
    Json setOptions(const Json& value);
};
std::unique_ptr<FeatureIo> makeSimulator();
Json enumerateDevices();
std::unique_ptr<FeatureIo> openDevice(const std::string& path);
}

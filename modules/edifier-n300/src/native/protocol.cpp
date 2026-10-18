#include "protocol.hpp"
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <numeric>

namespace n300 {
Codec::Codec(int v, int e) : version(v == 0 ? 1 : v), encryption(e) {
    if ((version != 1 && version != 2) || (e != 0 && e != 0x10))
        throw Error("unsupported_protocol", "Unknown N300 protocol or encryption mode.");
}
Bytes Codec::encode(uint8_t cmd, const Bytes &payload, uint8_t header) const {
    if (payload.size() > (version == 1 ? 254u : 4096u))
        throw Error("invalid_argument", "Packet payload too large.");
    Bytes out;
    if (version == 1) {
        out = {header, static_cast<uint8_t>(payload.size() + 1), cmd};
        out.insert(out.end(), payload.begin(), payload.end());
        auto crc = std::accumulate(out.begin(), out.end(), 0x2019u);
        out.push_back(static_cast<uint8_t>(crc >> 8));
        out.push_back(static_cast<uint8_t>(crc));
    } else {
        out = {header, 0xEC, cmd, static_cast<uint8_t>(payload.size() >> 8),
               static_cast<uint8_t>(payload.size())};
        for (auto b : payload)
            out.push_back(encryption == 0x10 ? b ^ 0xA5 : b);
        out.push_back(static_cast<uint8_t>(std::accumulate(out.begin(), out.end(), 0u)));
    }
    return out;
}
std::vector<Frame> Codec::feed(const Bytes &data) {
    buffer.insert(buffer.end(), data.begin(), data.end());
    std::vector<Frame> frames;
    while (buffer.size() >= (version == 1 ? 5u : 6u)) {
        auto drop = [&] { buffer.erase(buffer.begin()); };
        if (buffer[0] != 0xAA && buffer[0] != 0xBB && buffer[0] != 0xCC) {
            drop();
            continue;
        }
        size_t size;
        if (version == 1) {
            if (buffer[1] == 0) {
                drop();
                continue;
            }
            size = buffer[1] + 4;
        } else {
            if (buffer[1] != 0xEC) {
                drop();
                continue;
            }
            size = (static_cast<size_t>(buffer[3]) << 8) + buffer[4];
            if (size > 4096) {
                drop();
                continue;
            }
            size += 6;
        }
        if (buffer.size() < size)
            break;
        bool valid;
        if (version == 1) {
            auto sum = std::accumulate(buffer.begin(), buffer.begin() + size - 2, 0x2019u) & 0xFFFF;
            valid = sum == (static_cast<unsigned>(buffer[size - 2]) << 8) + buffer[size - 1];
        } else
            valid = (std::accumulate(buffer.begin(), buffer.begin() + size - 1, 0u) & 255) ==
                    buffer[size - 1];
        if (!valid) {
            ++bad_checksums;
            drop();
            continue;
        }
        Frame frame{buffer[0], buffer[2], {}, Bytes(buffer.begin(), buffer.begin() + size)};
        frame.payload = Bytes(buffer.begin() + (version == 1 ? 3 : 5),
                              buffer.begin() + size - (version == 1 ? 2 : 1));
        if (version == 2 && encryption == 0x10)
            for (auto &b : frame.payload)
                b ^= 0xA5;
        frames.push_back(std::move(frame));
        buffer.erase(buffer.begin(), buffer.begin() + size);
    }
    if (buffer.size() > 8192)
        buffer.clear();
    return frames;
}
json capabilities(const Bytes &data) {
    auto b = [&](size_t i) { return i < data.size() ? data[i] : 0; };
    static const int rename[] = {0, 24, 30, 29, 35, 30, 24};
    return {{"name", b(2) == 1},
            {"rename_bytes", b(3) < 7 ? rename[b(3)] : 0},
            {"firmware", b(5) == 1},
            {"idle_shutdown", b(8) == 1},
            {"timer", b(9) > 0},
            {"power_off", b(10) == 1},
            {"eq_index", b(13)},
            {"input", (b(19) & 1) != 0},
            {"volume", (b(19) & 2) != 0},
            {"ambient_light", (b(19) & 128) != 0},
            {"raw", hex(data)}};
}
uint64_t parse_address(const std::string &address) {
    auto first = address.find_first_not_of(" \t\r\n"), last = address.find_last_not_of(" \t\r\n");
    std::string input = first == std::string::npos ? "" : address.substr(first, last - first + 1);
    auto invalid = [&] {
        return Error("invalid_argument",
                     "Use AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF or AABBCCDDEEFF.", false,
                     {{"received", address}, {"length", address.size()}});
    };
    if (input.size() != 17 && input.size() != 12)
        throw invalid();
    if (input.size() == 17 && input[2] != ':' && input[2] != '-')
        throw invalid();
    uint64_t result = 0;
    for (size_t i = 0; i < input.size(); ++i) {
        if (input.size() == 17 && i % 3 == 2) {
            if (input[i] != input[2])
                throw invalid();
            continue;
        }
        unsigned char ch = static_cast<unsigned char>(input[i]);
        if (!std::isxdigit(ch))
            throw invalid();
        result = (result << 4) + (std::isdigit(ch) ? ch - '0' : std::tolower(ch) - 'a' + 10);
    }
    return result;
}
std::string format_address(uint64_t address) {
    char value[18];
    std::snprintf(value, sizeof value, "%02X:%02X:%02X:%02X:%02X:%02X",
                  unsigned((address >> 40) & 255), unsigned((address >> 32) & 255),
                  unsigned((address >> 24) & 255), unsigned((address >> 16) & 255),
                  unsigned((address >> 8) & 255), unsigned(address & 255));
    return value;
}
Target Target::from_json(const json &j) {
    Target t;
    t.address = format_address(parse_address(text(j.at("address"), "address")));
    t.name = j.value("name", std::string("N300"));
    t.service = j.value("service", std::string(service_v1));
    if (t.service != service_v1 && t.service != service_2026)
        throw Error("invalid_argument", "Unknown N300 service UUID.");
    t.protocol = integer(j.value("protocol", json(1)), 0, 2, "protocol");
    t.encryption = integer(j.value("encryption", json(0)), 0, 16, "encryption");
    t.rssi = integer(j.value("rssi", json(0)), -32768, 32767, "rssi");
    Codec validate(t.protocol, t.encryption);
    return t;
}
} // namespace n300

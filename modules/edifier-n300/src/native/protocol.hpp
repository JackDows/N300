#pragma once
#include "common.hpp"

namespace n300 {
struct Frame {
    uint8_t header, command;
    Bytes payload, raw;
};
class Codec {
    Bytes buffer;

  public:
    int version, encryption;
    uint64_t bad_checksums = 0;
    explicit Codec(int v = 1, int e = 0);
    Bytes encode(uint8_t command, const Bytes &payload = {}, uint8_t header = 0xAA) const;
    std::vector<Frame> feed(const Bytes &data);
};
json capabilities(const Bytes &data);
} // namespace n300

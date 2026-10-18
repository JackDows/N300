#pragma once
#include "protocol.hpp"
#include <filesystem>
#include <mutex>

namespace og98 {
class Session {
    std::mutex mutex_;
    std::unique_ptr<Receiver> receiver_;
    bool offline_ = false;
    std::string devicePath_, logError_;
    std::filesystem::path logPath_;
    uint64_t sequence_ = 0;
    Json requestId_;
    void log(const std::string& event, const Json& data) noexcept;
    Json dispatch(const std::string& method, const Json& params);
    Json get(const std::string& setting);
public:
    Json request(const std::string& text);
};
}

#pragma once
#include "common.hpp"
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>

namespace n300 {
struct Inbox {
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<Bytes> chunks;
    std::atomic_bool lost = false;
    void push(Bytes bytes) {
        std::lock_guard lock(mutex);
        if (chunks.size() < 256)
            chunks.push_back(std::move(bytes));
        changed.notify_all();
    }
};
class Transport {
  public:
    std::shared_ptr<Inbox> inbox = std::make_shared<Inbox>();
    virtual ~Transport() = default;
    virtual std::vector<Target> scan(int timeout_ms, const std::string &address,
                                     const std::atomic_bool &cancel, bool fast = false) = 0;
    virtual void connect(const Target &, int timeout_ms, const std::atomic_bool &cancel) = 0;
    virtual void write(const Bytes &, int timeout_ms, const std::atomic_bool &cancel) = 0;
    virtual void disconnect() noexcept = 0;
    virtual bool connected() const = 0;
    virtual size_t packet_size() const {
        return 20;
    }
    Bytes receive(Clock::time_point until, const std::atomic_bool &cancel);
    void clear() {
        std::lock_guard lock(inbox->mutex);
        inbox->chunks.clear();
        inbox->lost = false;
    }
};
std::unique_ptr<Transport> make_transport(bool offline, const json &config);
} // namespace n300

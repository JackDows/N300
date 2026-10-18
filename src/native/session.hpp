#pragma once
#include "protocol.hpp"
#include "transport.hpp"
#include <optional>

namespace n300 {
class Session {
    bool offline = false, verified = false;
    int scan_ms = 5000, connect_ms = 15000, request_ms = 2000, ack_ms = 250;
    int input_settle_ms = 5000;
    std::string address_filter;
    std::optional<Target> target;
    std::unique_ptr<Transport> transport;
    std::unique_ptr<Codec> codec;
    json catalog, caps = json::object(), values = json::object(), raw = json::object();
    json timings = json::object(), wire = json::array(), last_state;
    int input_group = 0;
    Bytes eq_calibration;
    json eq_layout;
    uint64_t event_sequence = 0;
    uint64_t scan_count = 0, connection_count = 0;
    int retry_attempt = 0;
    Clock::time_point retry_at = Clock::now();
    std::atomic_bool wanted = false;
    std::vector<json> events;
    void reset_state();
    void ensure_connected();
    void apply(const Frame &frame);
    Frame request(uint8_t command, const Bytes &payload = {}, int reply_timeout = -1);
    void drain();
    json read(const std::string &property, int reply_timeout = -1);
    json set(const std::string &property, const json &value);
    json set_gain(const json &params);
    json choices(const std::string &property) const;
    void supported(const std::string &property) const;
    void emit_state();
    void set_and_verify(uint8_t command, const Bytes &payload, const std::string &property,
                        const json &expected);

  public:
    std::atomic_bool cancelled = false;
    explicit Session(const json &config);
    ~Session();
    json execute(const json &request);
    json tick();
    json snapshot() const;
    json diagnostics() const;
    static json describe();
    bool is_offline() const {
        return offline;
    }
    void cancel() {
        cancelled = true;
        wanted = false;
        transport->inbox->changed.notify_all();
    }
    std::vector<json> take_events() {
        auto result = std::move(events);
        events.clear();
        return result;
    }
};
} // namespace n300

#include "client.hpp"
#include <windows.h>
#include <winhttp.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

namespace ghub {
namespace {
struct Handle {
    HINTERNET value = nullptr;
    ~Handle() { if (value) WinHttpCloseHandle(value); }
    operator HINTERNET() const { return value; }
};
class LocalBackend final : public Backend {
    unsigned port_;
    Handle session_, connection_;
    std::atomic<HINTERNET> socket_ = nullptr;
    std::atomic_bool stopped_ = false;
    std::thread receiver_;
    std::mutex mutex_;
    std::condition_variable changed_;
    std::deque<Json> replies_;
    bool ended_ = true;
    DWORD failure_ = 0;
    unsigned long long sequence_ = 0;
    [[noreturn]] void unavailable(const char* operation, DWORD error) {
        throw Error("ghub_unavailable", std::string(operation) + " failed", "请先启动 G HUB，再重新连接鼠标。", {{"win32", error}, {"port", port_}});
    }
    void disconnect() noexcept {
        if (auto socket = socket_.exchange(nullptr)) WinHttpCloseHandle(socket);
        changed_.notify_all();
        if (receiver_.joinable()) receiver_.join();
        std::lock_guard lock(mutex_);
        ended_ = true;
        replies_.clear();
    }
    void connect() {
        if (stopped_) throw Error("cancelled", "G HUB session stopped", "操作已取消。");
        if (socket_) { std::lock_guard lock(mutex_); if (!ended_) return; }
        disconnect();
        if (!session_) {
            session_.value = WinHttpOpen(L"DeskHub/0.4", WINHTTP_ACCESS_TYPE_NO_PROXY, nullptr, nullptr, 0);
            if (!session_) unavailable("WinHttpOpen", GetLastError());
            WinHttpSetTimeouts(session_, 1000, 1000, 1000, 1000);
            connection_.value = WinHttpConnect(session_, L"127.0.0.1", static_cast<INTERNET_PORT>(port_), 0);
            if (!connection_) unavailable("WinHttpConnect", GetLastError());
        }
        Handle request;
        request.value = WinHttpOpenRequest(connection_, L"GET", L"/", nullptr, nullptr, nullptr, 0);
        if (!request || !WinHttpSetOption(request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0)) unavailable("WebSocket request", GetLastError());
        DWORD redirects = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &redirects, sizeof(redirects));
        if (!WinHttpSendRequest(request, L"Sec-WebSocket-Protocol: json\r\n", static_cast<DWORD>(-1), nullptr, 0, 0, 0) || !WinHttpReceiveResponse(request, nullptr)) unavailable("WebSocket handshake", GetLastError());
        DWORD status = 0, size = sizeof(status);
        if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, nullptr, &status, &size, nullptr) || status != 101)
            unavailable("WebSocket status", status);
        auto socket = WinHttpWebSocketCompleteUpgrade(request, 0);
        if (!socket) unavailable("WebSocket upgrade", GetLastError());
        if (stopped_) { WinHttpCloseHandle(socket); throw Error("cancelled", "G HUB session stopped", "操作已取消。"); }
        socket_ = socket;
        { std::lock_guard lock(mutex_); ended_ = false; failure_ = 0; }
        receiver_ = std::thread([this, socket] {
            std::string message;
            DWORD error = 0;
            while (socket_ == socket) {
                char buffer[16384]; DWORD size = 0; WINHTTP_WEB_SOCKET_BUFFER_TYPE type;
                error = WinHttpWebSocketReceive(socket, buffer, sizeof(buffer), &size, &type);
                if (error || type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) break;
                if (type != WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE && type != WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE) { error = ERROR_INVALID_DATA; break; }
                message.append(buffer, size);
                if (message.size() > 1024 * 1024) { error = ERROR_BUFFER_OVERFLOW; break; }
                if (type == WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE) continue;
                try {
                    auto reply = Json::parse(message); message.clear();
                    if (!reply.is_object()) { error = ERROR_INVALID_DATA; break; }
                    if (!reply.value("msgId", std::string()).empty()) {
                        std::lock_guard lock(mutex_);
                        if (replies_.size() >= 16) { error = ERROR_BUFFER_OVERFLOW; break; }
                        replies_.push_back(std::move(reply)); changed_.notify_all();
                    }
                } catch (...) { error = ERROR_INVALID_DATA; break; }
            }
            { std::lock_guard lock(mutex_); ended_ = true; failure_ = error; }
            changed_.notify_all();
        });
    }
public:
    explicit LocalBackend(unsigned port) : port_(port) {}
    ~LocalBackend() override { disconnect(); }
    void cancel() noexcept override {
        stopped_ = true;
        if (auto socket = socket_.exchange(nullptr)) WinHttpCloseHandle(socket);
        changed_.notify_all();
    }
    Json request(const std::string& verb, const std::string& path, const Json& payload) override {
        connect();
        const auto id = std::to_string(++sequence_);
        Json command{{"msgId", id}, {"verb", verb}, {"path", path}};
        if (!payload.is_null()) command["payload"] = payload;
        auto data = command.dump();
        if (data.size() > 65536) throw Error("invalid_argument", "G HUB command too large", "配置内容过大。");
        const auto sent = WinHttpWebSocketSend(socket_, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE, data.data(), static_cast<DWORD>(data.size()));
        if (sent) { disconnect(); unavailable("WebSocket send", sent); }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        std::unique_lock lock(mutex_);
        for (;;) {
            while (!replies_.empty()) {
                auto reply = std::move(replies_.front()); replies_.pop_front();
                if (reply.value("msgId", std::string()) != id) continue;
                if (reply.value("path", std::string()) != path) throw Error("protocol_error", "Mismatched G HUB reply path", "鼠标状态读取失败，请重试。");
                const auto result = reply.value("result", Json::object());
                const auto code = result.value("code", std::string());
                if (code != "SUCCESS") throw Error(code == "NO_SUCH_PATH" || code == "NOT_IMPLEMENTED" ? "unsupported_capability" : "ghub_request_failed",
                    result.value("what", code), "G HUB 未完成此操作，请刷新后重试。", {{"path", path}, {"verb", verb}, {"code", code}});
                return reply.value("payload", Json::object());
            }
            if (ended_ || !socket_) { const auto error = failure_; lock.unlock(); disconnect(); unavailable("WebSocket receive", error); }
            if (changed_.wait_until(lock, deadline) == std::cv_status::timeout) {
                lock.unlock(); disconnect();
                throw Error("ghub_timeout", "G HUB reply timeout", "G HUB 暂时没有响应，请稍后重试。", {{"path", path}, {"verb", verb}});
            }
        }
    }
};
}
std::unique_ptr<Backend> online(unsigned port) { return std::make_unique<LocalBackend>(port); }
}

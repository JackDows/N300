#include "session.hpp"
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <n300/n300.h>
#include <roapi.h>
#include <winrt/base.h>

struct n300_handle {
    std::mutex operation, callback_mutex;
    n300::Session session;
    n300_event_callback callback = nullptr;
    void *context = nullptr;
    explicit n300_handle(const n300::json &config) : session(config) {}
};
namespace {
using namespace n300;
struct Apartment {
    Apartment() {
        APTTYPE type;
        APTTYPEQUALIFIER qualifier;
        if (FAILED(CoGetApartmentType(&type, &qualifier)) || type != APTTYPE_MTA)
            throw Error("wrong_thread", "Initialize an App-owned MTA worker with "
                                        "n300_thread_initialize before executing commands.");
    }
};
char *allocate(const json &value) {
    auto text = value.dump(-1, ' ', false, json::error_handler_t::replace);
    auto out = static_cast<char *>(std::malloc(text.size() + 1));
    if (!out)
        throw std::bad_alloc();
    std::memcpy(out, text.c_str(), text.size() + 1);
    return out;
}
json failure(const Error &e) {
    return {{"ok", false}, {"api_version", 1}, {"error", e.data()}};
}
json current_error() {
    try {
        throw;
    } catch (const Error &e) {
        return failure(e);
    } catch (const json::exception &e) {
        return failure(Error("invalid_argument", e.what()));
    } catch (const winrt::hresult_error &e) {
        return failure(Error("connection_failed", winrt::to_string(e.message()), true,
                             {{"hresult", static_cast<int32_t>(e.code())}}));
    } catch (const std::exception &e) {
        return failure(Error("internal_error", e.what()));
    } catch (...) {
        return failure(Error("internal_error", "Unknown native failure."));
    }
}
void events(n300_handle *handle, const std::vector<json> &list) {
    n300_event_callback callback;
    void *context;
    {
        std::lock_guard lock(handle->callback_mutex);
        callback = handle->callback;
        context = handle->context;
    }
    if (!callback)
        return;
    for (auto &event : list) {
        auto data = event.dump(-1, ' ', false, json::error_handler_t::replace);
        try {
            callback(data.c_str(), context);
        } catch (...) {
        }
    }
}
} // namespace
extern "C" {
uint32_t N300_CALL n300_abi_version() {
    return 1;
}
const char *N300_CALL n300_version() {
    return "0.3.0";
}
int N300_CALL n300_thread_initialize(char **error) {
    if (!error)
        return 2;
    *error = nullptr;
    HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
    if (SUCCEEDED(hr))
        return 0;
    try {
        *error = allocate(
            failure(Error("wrong_thread", "Use a dedicated MTA worker, not the App UI thread.",
                          false, {{"hresult", static_cast<int32_t>(hr)}})));
        return 1;
    } catch (...) {
        return 2;
    }
}
void N300_CALL n300_thread_uninitialize() {
    RoUninitialize();
}
int N300_CALL n300_create(const char *config, n300_handle **handle, char **error) {
    if (!handle || !error)
        return 2;
    *handle = nullptr;
    *error = nullptr;
    try {
        *handle = new n300_handle(config ? json::parse(config) : json::object());
        return 0;
    } catch (...) {
        try {
            *error = allocate(current_error());
            return 1;
        } catch (...) {
            return 2;
        }
    }
}
int N300_CALL n300_execute(n300_handle *handle, const char *request, char **response) {
    if (!handle || !request || !response)
        return 2;
    *response = nullptr;
    json result;
    std::vector<json> pending;
    try {
        {
            std::lock_guard lock(handle->operation);
            try {
                Apartment apartment;
                auto input = json::parse(request);
                if (input.value("method", std::string()) != "tick")
                    handle->session.cancelled = false;
                auto value = handle->session.execute(input);
                result = {{"ok", true},
                          {"api_version", 1},
                          {"offline", handle->session.is_offline()},
                          {"result", value}};
            } catch (...) {
                result = current_error();
            }
            pending = handle->session.take_events();
        }
        *response = allocate(result);
        events(handle, pending);
        return result.value("ok", false) ? 0 : 1;
    } catch (...) {
        try {
            *response = allocate(current_error());
            return 1;
        } catch (...) {
            return 2;
        }
    }
}
int N300_CALL n300_tick(n300_handle *handle, char **response) {
    return n300_execute(handle, "{\"method\":\"tick\"}", response);
}
void N300_CALL n300_cancel(n300_handle *handle) {
    if (handle)
        handle->session.cancel();
}
void N300_CALL n300_set_event_callback(n300_handle *handle, n300_event_callback callback,
                                       void *context) {
    if (!handle)
        return;
    std::lock_guard lock(handle->callback_mutex);
    handle->callback = callback;
    handle->context = context;
}
void N300_CALL n300_destroy(n300_handle *handle) {
    if (!handle)
        return;
    handle->session.cancel();
    delete handle;
}
void N300_CALL n300_free(char *string) {
    std::free(string);
}
}

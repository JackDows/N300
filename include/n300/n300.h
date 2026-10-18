#pragma once
#include <stdint.h>

#if defined(_WIN32)
#if defined(N300_BUILD_DLL)
#define N300_API __declspec(dllexport)
#else
#define N300_API __declspec(dllimport)
#endif
#define N300_CALL __cdecl
#else
#define N300_API
#define N300_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct n300_handle n300_handle;
typedef void(N300_CALL *n300_event_callback)(const char *event_json_utf8, void *context);

/* ABI 1. All strings are UTF-8 JSON. All returned strings must be freed with n300_free.
 * No C++/STL objects or exceptions cross this boundary. 0 = success, 1 = device/argument
 * error (inspect response JSON), 2 = invalid ABI arguments/allocation failure.
 * The DLL creates no worker thread, UI, child process or cache file.
 */
N300_API uint32_t N300_CALL n300_abi_version(void);
N300_API const char *N300_CALL n300_version(void);
/* Initialize the App-owned device worker as MTA. Balance every successful call
 * with thread_uninitialize on the same thread, after stop and pending I/O finish. */
N300_API int N300_CALL n300_thread_initialize(char **error_json_utf8);
N300_API void N300_CALL n300_thread_uninitialize(void);
N300_API int N300_CALL n300_create(const char *config_json_utf8, n300_handle **handle,
                                   char **error_json_utf8);
N300_API int N300_CALL n300_execute(n300_handle *handle, const char *request_json_utf8,
                                    char **response_json_utf8);
/* Call tick on the host's worker periodically (100-500 ms) after method=start.
 * It drains notifications and performs at most one due reconnect attempt.
 * tick/execute can block for the configured timeout: never call on a UI thread.
 */
N300_API int N300_CALL n300_tick(n300_handle *handle, char **response_json_utf8);
/* Safe from another thread; interrupts waits and disables reconnect. Already-sent
 * hardware commands cannot be undone. Join the host worker before destroy. */
N300_API void N300_CALL n300_cancel(n300_handle *handle);
/* Callback runs on the thread calling execute/tick, outside the operation lock.
 * JSON is borrowed for the callback duration. Queue it to the App; do not destroy
 * the handle from a callback. context must live until the host worker has stopped. */
N300_API void N300_CALL n300_set_event_callback(n300_handle *handle, n300_event_callback callback,
                                                void *context);
N300_API void N300_CALL n300_destroy(n300_handle *handle);
N300_API void N300_CALL n300_free(char *string);

#ifdef __cplusplus
}
#endif

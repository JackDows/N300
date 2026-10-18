#pragma once
#ifdef _WIN32
#ifdef OG98_BUILD_DLL
#define OG98_API __declspec(dllexport)
#else
#define OG98_API __declspec(dllimport)
#endif
#else
#define OG98_API
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct og98_context og98_context;
// Returns NULL only on allocation failure. No hardware is opened here.
OG98_API og98_context* og98_create(void);
// UTF-8 JSON in/out. The caller must free the returned buffer with og98_free.
// Blocking: call on an application-owned worker, not the UI thread.
OG98_API char* og98_request(og98_context* context, const char* request_json);
OG98_API void og98_free(char* response_json);
// Call only after all requests have finished. Releases the HID handle.
OG98_API void og98_destroy(og98_context* context);
#ifdef __cplusplus
}
#endif

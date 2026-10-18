// This is the future App's worker, not a thread created inside n300.dll.
#include <chrono>
#include <iostream>
#include <n300/n300.h>
#include <stdexcept>
#include <string>
#include <thread>

static void execute(n300_handle *device, const char *command) {
    char *result = nullptr;
    int code = n300_execute(device, command, &result);
    std::string message = result ? result : "ABI failure";
    n300_free(result);
    if (code)
        throw std::runtime_error(message);
    std::cout << message << '\n';
}

int main() {
    n300_handle *device = nullptr;
    char *error = nullptr;
    // Default example is entirely offline. The App chooses target/config itself.
    if (n300_create(R"({"offline":true})", &device, &error)) {
        std::cerr << (error ? error : "create failed") << '\n';
        n300_free(error);
        return 1;
    }
    n300_set_event_callback(
        device,
        [](const char *event, void *) {
            // In a GUI App, enqueue a copy onto the App's event/UI queue here.
            std::cout << "event: " << event << '\n';
        },
        nullptr);
    bool succeeded = false;
    std::thread worker([&] {
        char *thread_error = nullptr;
        if (n300_thread_initialize(&thread_error)) {
            std::cerr << (thread_error ? thread_error : "worker init failed") << '\n';
            n300_free(thread_error);
            return;
        }
        try {
            execute(device, R"({"method":"start"})");
            // A real App keeps this worker alive, consumes its device command queue,
            // and calls tick every 100-500 ms while waiting for work.
            execute(device, R"({"method":"tick"})");
            execute(device, R"({"method":"get","params":{"property":"volume"}})");
            execute(device, R"({"method":"set","params":{"property":"volume","value":9}})");
            succeeded = true;
        } catch (const std::exception &exception) {
            std::cerr << exception.what() << '\n';
        }
        char *stopped = nullptr;
        n300_execute(device, R"({"method":"stop"})", &stopped);
        n300_free(stopped);
        n300_thread_uninitialize();
    });
    // For user-triggered shutdown while an operation is pending:
    // n300_cancel(device); then join the worker before releasing the handle.
    worker.join();
    n300_set_event_callback(device, nullptr, nullptr);
    n300_destroy(device);
    return succeeded ? 0 : 1;
}

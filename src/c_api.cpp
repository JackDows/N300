#include <og98/og98.h>
#include "session.hpp"
#include <cstdlib>
#include <cstring>

struct og98_context { og98::Session session; };
og98_context* og98_create() { try { return new og98_context; } catch (...) { return nullptr; } }
char* og98_request(og98_context* context, const char* input) {
    try {
        std::string output;
        if (!context || !input) output = R"({"apiVersion":1,"ok":false,"error":{"code":"invalid_argument","message":"Null context or request","userMessage":"请求参数不正确。"}})";
        else output = context->session.request(input).dump();
        auto* copy = static_cast<char*>(std::malloc(output.size() + 1));
        if (copy) std::memcpy(copy, output.c_str(), output.size() + 1);
        return copy;
    } catch (...) { return nullptr; }
}
void og98_free(char* response) { std::free(response); }
void og98_destroy(og98_context* context) { delete context; }

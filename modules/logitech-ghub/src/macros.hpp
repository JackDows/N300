#pragma once
#include "client.hpp"
namespace ghub {
Json readBindings(Backend&, const Json& device);
Json macroOperation(Backend&, const Json& device, const std::string& operation, const Json& arguments);
Json decodeMacro(const Json& card);
Json encodeSequence(const Json& specification);
}

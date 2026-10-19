#pragma once
#include <deskhub/module.hpp>
#include <memory>

namespace ghub {
using deskhub::Json;
using deskhub::Error;
class Backend {
public:
    virtual ~Backend() = default;
    virtual Json request(const std::string& verb, const std::string& path, const Json& payload = nullptr) = 0;
    virtual void cancel() noexcept = 0;
};
std::unique_ptr<Backend> online(unsigned port = 9010);
std::unique_ptr<Backend> simulator();
}

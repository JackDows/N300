#pragma once
#include "client.hpp"

namespace ghub {
struct Settings {
    bool onboard = false;
    std::string profileId;
    Json values = Json::object();
    Json card, sensitivity;
};
std::string identity(const Json& device);
Json mice(Backend& backend);
Settings readSettings(Backend& backend, const Json& device);
void writeSetting(Backend& backend, const Json& device, const std::string& capability, const Json& value);
}

#include "transport.hpp"
#include "protocol.hpp"
#include <algorithm>
#include <map>
#include <optional>
#include <set>
#include <thread>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.Streams.h>

namespace n300 {
using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Devices::Bluetooth;
using namespace Windows::Devices::Bluetooth::Advertisement;
using namespace Windows::Devices::Bluetooth::GenericAttributeProfile;
using namespace Windows::Storage::Streams;

template <class Operation>
auto wait(Operation operation, int timeout_ms, const std::atomic_bool &cancel) {
    auto until = Clock::now() + Ms(timeout_ms);
    if (operation.Status() == AsyncStatus::Started) {
        struct Signal {
            std::mutex mutex;
            std::condition_variable changed;
            bool complete = false;
        };
        auto signal = std::make_shared<Signal>();
        operation.Completed([signal](auto &&, AsyncStatus) {
            std::lock_guard lock(signal->mutex);
            signal->complete = true;
            signal->changed.notify_all();
        });
        std::unique_lock lock(signal->mutex);
        while (!signal->complete) {
            if (cancel || Clock::now() >= until) {
                lock.unlock();
                operation.Cancel();
                check_cancel(cancel);
                throw Error("timeout", "Windows Bluetooth operation timed out.", true);
            }
            signal->changed.wait_until(lock, std::min(until, Clock::now() + Ms(20)));
        }
    }
    check_cancel(cancel);
    return operation.GetResults();
}
static Bytes bytes(const IBuffer &buffer) {
    Bytes result(buffer.Length());
    DataReader::FromBuffer(buffer).ReadBytes(result);
    return result;
}
static void success(GattCommunicationStatus status) {
    if (status != GattCommunicationStatus::Success)
        throw Error("connection_failed", "Windows GATT request failed.", true,
                    {{"gatt_status", static_cast<int>(status)}});
}
Bytes Transport::receive(Clock::time_point until, const std::atomic_bool &cancel) {
    std::unique_lock lock(inbox->mutex);
    while (inbox->chunks.empty()) {
        check_cancel(cancel);
        if (inbox->lost)
            throw Error("disconnected", "The speaker disconnected.", true);
        if (Clock::now() >= until)
            throw Error("timeout", "The speaker did not reply.", true);
        inbox->changed.wait_until(lock, std::min(until, Clock::now() + Ms(20)));
    }
    auto result = std::move(inbox->chunks.front());
    inbox->chunks.pop_front();
    return result;
}

class WindowsTransport final : public Transport {
    BluetoothLEDevice device{nullptr};
    GattDeviceService service{nullptr};
    GattCharacteristic read{nullptr}, output{nullptr};
    event_token notification{}, connection{};
    bool notify_registered = false, connection_registered = false;
    GattWriteOption write_option = GattWriteOption::WriteWithResponse;

  public:
    ~WindowsTransport() {
        disconnect();
    }
    std::vector<Target> scan(int timeout_ms, const std::string &address,
                             const std::atomic_bool &cancel, bool fast) override {
        struct Scan {
            std::mutex mutex;
            std::condition_variable changed;
            std::map<std::string, Target> found;
            std::set<std::string> protocol_ready;
            bool stopped = false;
            BluetoothError error = BluetoothError::Success;
        };
        auto state = std::make_shared<Scan>();
        BluetoothLEAdvertisementWatcher watcher;
        watcher.ScanningMode(BluetoothLEScanningMode::Active);
        auto received = watcher.Received(
            [state](auto &&, const BluetoothLEAdvertisementReceivedEventArgs &args) {
                try {
                    Target t;
                    t.address = format_address(args.BluetoothAddress());
                    t.rssi = args.RawSignalStrengthInDBm();
                    auto ad = args.Advertisement();
                    t.name = to_string(ad.LocalName());
                    bool known = false;
                    for (auto uuid : ad.ServiceUuids()) {
                        if (uuid == guid("00007e00-0000-1000-8000-00805f9b34fb") ||
                            uuid == guid(service_v1)) {
                            t.service = service_v1;
                            known = true;
                        }
                        if (uuid == guid("00009503-0000-1000-8000-00805f9b34fb") ||
                            uuid == guid(service_2026)) {
                            t.service = service_2026;
                            known = true;
                        }
                    }
                    auto name = t.name;
                    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) {
                        return static_cast<char>(std::toupper(c));
                    });
                    std::lock_guard lock(state->mutex);
                    if (!known && name.find("N300") == std::string::npos &&
                        !state->found.contains(t.address))
                        return;
                    if (auto prior = state->found.find(t.address); prior != state->found.end()) {
                        if (!known)
                            t.service = prior->second.service;
                        if (t.name.empty())
                            t.name = prior->second.name;
                        t.protocol = prior->second.protocol;
                        t.encryption = prior->second.encryption;
                    }
                    for (auto md : ad.ManufacturerData())
                        if (md.CompanyId() == 2016) {
                            auto data = bytes(md.Data());
                            if (data.size() < 2)
                                return;
                            t.protocol = data[data.size() - 2];
                            t.encryption = data.back();
                            state->protocol_ready.insert(t.address);
                        }
                    if (t.name.empty())
                        t.name = "N300";
                    state->found[t.address] = std::move(t);
                    state->changed.notify_all();
                } catch (...) { /* Ignore incomplete advertisements; no callbacks may throw into
                                   WinRT. */
                }
            });
        auto stopped = watcher.Stopped(
            [state](auto &&, const BluetoothLEAdvertisementWatcherStoppedEventArgs &args) {
                std::lock_guard lock(state->mutex);
                state->error = args.Error();
                state->stopped = true;
                state->changed.notify_all();
            });
        auto cleanup = [&] {
            try {
                watcher.Stop();
                watcher.Received(received);
                watcher.Stopped(stopped);
            } catch (...) {
            };
        };
        try {
            watcher.Start();
            auto until = Clock::now() + Ms(timeout_ms);
            std::optional<Clock::time_point> settle_until;
            std::unique_lock lock(state->mutex);
            while (Clock::now() < until) {
                check_cancel(cancel);
                if (state->stopped && state->error != BluetoothError::Success)
                    throw Error("bluetooth_unavailable",
                                "Windows could not start Bluetooth discovery.", true,
                                {{"bluetooth_error", static_cast<int>(state->error)}});
                if (!address.empty() && state->found.contains(address) &&
                    state->protocol_ready.contains(address))
                    break;
                if (fast && address.empty() && !state->found.empty()) {
                    if (!settle_until)
                        settle_until = Clock::now() + Ms(300);
                    if (state->found.size() > 1 ||
                        (Clock::now() >= *settle_until &&
                         state->protocol_ready.contains(state->found.begin()->first)))
                        break;
                }
                state->changed.wait_until(lock, std::min(until, Clock::now() + Ms(20)));
            }
            std::vector<Target> result;
            for (const auto &[key, value] : state->found)
                if (address.empty() || key == address)
                    result.push_back(value);
            lock.unlock();
            cleanup();
            return result;
        } catch (...) {
            cleanup();
            throw;
        }
    }
    void connect(const Target &target, int timeout_ms, const std::atomic_bool &cancel) override {
        disconnect();
        clear();
        auto until = Clock::now() + Ms(timeout_ms);
        auto remaining = [&] {
            check_cancel(cancel);
            auto ms = std::chrono::duration_cast<Ms>(until - Clock::now()).count();
            if (ms <= 0)
                throw Error("timeout", "Bluetooth connection timed out.", true);
            return static_cast<int>(ms);
        };
        try {
            device =
                wait(BluetoothLEDevice::FromBluetoothAddressAsync(parse_address(target.address)),
                     remaining(), cancel);
            if (!device)
                throw Error("not_found",
                            "Windows could not open this Bluetooth address. Scan again.", true);
            for (auto cache : {BluetoothCacheMode::Cached, BluetoothCacheMode::Uncached}) {
                auto result = wait(device.GetGattServicesForUuidAsync(guid(target.service), cache),
                                   remaining(), cancel);
                success(result.Status());
                if (result.Services().Size()) {
                    service = result.Services().GetAt(0);
                    auto chars = wait(service.GetCharacteristicsAsync(cache), remaining(), cancel);
                    success(chars.Status());
                    for (auto ch : chars.Characteristics()) {
                        if (ch.Uuid() == guid(read_uuid))
                            read = ch;
                        if (ch.Uuid() == guid(write_uuid))
                            output = ch;
                    }
                    if (read && output)
                        break;
                    read = nullptr;
                    output = nullptr;
                    service.Close();
                    service = nullptr;
                }
            }
            if (!read || !output)
                throw Error("service_mismatch",
                            "The expected N300 BLE control service was not found.");
            auto props = read.CharacteristicProperties();
            auto cccd =
                (props & GattCharacteristicProperties::Notify) != GattCharacteristicProperties::None
                    ? GattClientCharacteristicConfigurationDescriptorValue::Notify
                : (props & GattCharacteristicProperties::Indicate) !=
                        GattCharacteristicProperties::None
                    ? GattClientCharacteristicConfigurationDescriptorValue::Indicate
                    : GattClientCharacteristicConfigurationDescriptorValue::None;
            if (cccd == GattClientCharacteristicConfigurationDescriptorValue::None)
                throw Error("service_mismatch", "N300 reply notifications unavailable.");
            props = output.CharacteristicProperties();
            if ((props & GattCharacteristicProperties::Write) != GattCharacteristicProperties::None)
                write_option = GattWriteOption::WriteWithResponse;
            else if ((props & GattCharacteristicProperties::WriteWithoutResponse) !=
                     GattCharacteristicProperties::None)
                write_option = GattWriteOption::WriteWithoutResponse;
            else
                throw Error("service_mismatch", "N300 control characteristic is not writable.");
            std::weak_ptr<Inbox> weak = inbox;
            notification =
                read.ValueChanged([weak](auto &&, const GattValueChangedEventArgs &args) {
                    try {
                        if (auto rx = weak.lock())
                            rx->push(bytes(args.CharacteristicValue()));
                    } catch (...) {
                    }
                });
            notify_registered = true;
            success(wait(read.WriteClientCharacteristicConfigurationDescriptorAsync(cccd),
                         remaining(), cancel));
            connection =
                device.ConnectionStatusChanged([weak](const BluetoothLEDevice &dev, auto &&) {
                    if (auto rx = weak.lock()) {
                        rx->lost =
                            dev.ConnectionStatus() == BluetoothConnectionStatus::Disconnected;
                        rx->changed.notify_all();
                    }
                });
            connection_registered = true;
        } catch (...) {
            disconnect();
            throw;
        }
    }
    void write(const Bytes &data, int timeout_ms, const std::atomic_bool &cancel) override {
        if (!output || !connected())
            throw Error("disconnected", "N300 is disconnected.", true);
        DataWriter writer;
        writer.WriteBytes(data);
        success(
            wait(output.WriteValueAsync(writer.DetachBuffer(), write_option), timeout_ms, cancel));
    }
    bool connected() const override {
        return device && read && output && !inbox->lost &&
               device.ConnectionStatus() == BluetoothConnectionStatus::Connected;
    }
    void disconnect() noexcept override {
        try {
            if (read && notify_registered)
                read.ValueChanged(notification);
        } catch (...) {
        }
        try {
            if (device && connection_registered)
                device.ConnectionStatusChanged(connection);
        } catch (...) {
        }
        notify_registered = false;
        connection_registered = false;
        read = nullptr;
        output = nullptr;
        try {
            if (service)
                service.Close();
        } catch (...) {
        }
        service = nullptr;
        try {
            if (device)
                device.Close();
        } catch (...) {
        }
        device = nullptr;
        inbox->lost = true;
        inbox->changed.notify_all();
    }
};

class SimulatedTransport final : public Transport {
    bool open = false, drop_ack = false, reject = false;
    int disconnect_command = -1;
    bool disconnected_once = false;
    Codec codec;
    std::map<int, Bytes> values;
    std::vector<int> silence;
    int input_delay_reads = 0, input_reads_remaining = 0;
    std::optional<Bytes> pending_input;

  public:
    explicit SimulatedTransport(const json &config) : codec(config.value("offline_protocol", 1)) {
        drop_ack = config.value("offline_drop_ack", false);
        reject = config.value("offline_reject_writes", false);
        disconnect_command = config.value("offline_disconnect_on_command", -1);
        silence = config.value("offline_silent_commands", std::vector<int>{});
        input_delay_reads = integer(config.value("offline_input_delay_reads", json(0)), 0, 1000,
                                    "offline_input_delay_reads");
        Bytes caps(20);
        for (int i : {2, 3, 5, 8, 9, 10})
            caps[i] = 1;
        caps[13] = 19;
        caps[19] = 3;
        Bytes eq = codec.version == 2 ? Bytes{1, 4} : Bytes{};
        int i = 0;
        for (int hz : {100, 500, 2000, 8000}) {
            eq.insert(eq.end(), {static_cast<uint8_t>(i++), 0, static_cast<uint8_t>(hz >> 8),
                                 static_cast<uint8_t>(hz), 6, 7});
        }
        values = {{0xD8, caps},
                  {0xC9, {'N', '3', '0', '0'}},
                  {0xC6, {1, 5, 1}},
                  {0x66, {16, 8}},
                  {0x61,
                   {static_cast<uint8_t>(integer(config.value("offline_input_group", json(5)), 0,
                                                 255, "offline_input_group")),
                    2}},
                  {0xD5, {4}},
                  {0x43, eq},
                  {0xD3, {0, 0}},
                  {0xD7, {0}},
                  {0xF7, {1}}};
    }
    std::vector<Target> scan(int, const std::string &address, const std::atomic_bool &cancel,
                             bool) override {
        check_cancel(cancel);
        Target t;
        t.address = "00:11:22:33:44:55";
        t.name = "N300 (offline)";
        t.protocol = codec.version;
        t.rssi = -40;
        return address.empty() || address == t.address ? std::vector<Target>{t}
                                                       : std::vector<Target>{};
    }
    void connect(const Target &, int, const std::atomic_bool &cancel) override {
        check_cancel(cancel);
        clear();
        open = true;
    }
    void disconnect() noexcept override {
        open = false;
        inbox->lost = true;
        inbox->changed.notify_all();
    }
    bool connected() const override {
        return open;
    }
    void write(const Bytes &data, int, const std::atomic_bool &cancel) override {
        check_cancel(cancel);
        if (!open)
            throw Error("disconnected", "Offline link closed.", true);
        for (auto &frame : codec.feed(data)) {
            auto cmd = frame.command;
            auto &payload = frame.payload;
            if (std::find(silence.begin(), silence.end(), cmd) != silence.end())
                continue;
            Bytes answer;
            if (cmd == 0x61 && pending_input) {
                if (input_reads_remaining == 0) {
                    values[0x61] = *pending_input;
                    pending_input.reset();
                } else --input_reads_remaining;
            }
            if (values.contains(cmd))
                answer = values[cmd];
            else {
                if (!reject) {
                    static const std::map<int, int> mapping = {{0x62, 0x61}, {0xC4, 0xD5},
                                                               {0xF8, 0xF7}, {0xD6, 0xD7},
                                                               {0xD1, 0xD3}, {0xCA, 0xC9}};
                    if (cmd == 0x62 && input_delay_reads > 0) {
                        pending_input = payload;
                        input_reads_remaining = input_delay_reads;
                    } else if (mapping.contains(cmd))
                        values[mapping.at(cmd)] = payload;
                    else if (cmd == 0x67)
                        values[0x66] = {16, payload.at(0)};
                    else if (cmd == 0xD2)
                        values[0xD3] = {0, 0};
                    else if (cmd == 0xCE) {
                        disconnect();
                        return;
                    } else if (cmd == 0x44) {
                        auto offset = (codec.version == 2 ? 2 : 0) + payload.at(0) * 6;
                        std::copy(payload.begin(), payload.end(), values[0x43].begin() + offset);
                    }
                }
                if (cmd == disconnect_command && !disconnected_once) {
                    disconnected_once = true;
                    disconnect();
                    throw Error("disconnected", "Simulated link loss after a write.", true);
                }
                if (drop_ack)
                    continue;
                answer =
                    cmd == 0xF8 || cmd == 0xD6 ? payload : Bytes{static_cast<uint8_t>(!reject)};
            }
            auto packet = codec.encode(cmd, answer, 0xBB);
            for (size_t i = 0; i < packet.size(); i += 3)
                inbox->push(
                    Bytes(packet.begin() + i, packet.begin() + std::min(i + 3, packet.size())));
        }
    }
};
std::unique_ptr<Transport> make_transport(bool offline, const json &config) {
    if (offline)
        return std::make_unique<SimulatedTransport>(config);
    return std::make_unique<WindowsTransport>();
}
} // namespace n300

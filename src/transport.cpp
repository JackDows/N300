#include "protocol.hpp"
#include <windows.h>
#include <hidsdi.h>
#include <setupapi.h>
#include <vector>

namespace og98 {
namespace {
struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE v) : value(v) {}
    ~Handle() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
std::wstring wide(const std::string& s) {
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.c_str(), -1, nullptr, 0);
    if (!size) throw Error("invalid_argument", "Invalid UTF-8 device path", "设备路径无效。" );
    std::wstring out(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.c_str(), -1, out.data(), size);
    out.pop_back(); return out;
}
std::string utf8(const wchar_t* s) {
    const int size = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, s, -1, out.data(), size, nullptr, nullptr);
    out.pop_back(); return out;
}
[[noreturn]] void winError(const char* operation) {
    const auto error = GetLastError();
    throw Error(error == ERROR_SHARING_VIOLATION ? "device_busy" : "hid_io_error",
                std::string(operation) + " failed", error == ERROR_SHARING_VIOLATION ?
                "键盘控制接口正在使用中，请退出其他控制程序后重试。" : "无法与键盘通信，请检查接收器连接后重试。",
                {{"operation", operation}, {"win32", error}});
}
bool isReceiver(HANDLE h, HIDD_ATTRIBUTES& attr, HIDP_CAPS& caps) {
    attr.Size = sizeof(attr);
    if (!HidD_GetAttributes(h, &attr) || attr.VendorID != 0x3151 || attr.ProductID != 0x4011) return false;
    PHIDP_PREPARSED_DATA data = nullptr;
    if (!HidD_GetPreparsedData(h, &data)) return false;
    const auto result = HidP_GetCaps(data, &caps);
    HidD_FreePreparsedData(data);
    return result == HIDP_STATUS_SUCCESS && caps.UsagePage == 0xffff && caps.Usage == 2 && caps.FeatureReportByteLength >= 65;
}
class WindowsFeature final : public FeatureIo {
    Handle handle_;
public:
    explicit WindowsFeature(const std::wstring& path)
        : handle_(CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr)) {
        if (handle_.value == INVALID_HANDLE_VALUE) winError("CreateFileW");
        HIDD_ATTRIBUTES attr{}; HIDP_CAPS caps{};
        if (!isReceiver(handle_.value, attr, caps))
            throw Error("unsupported_device", "Not the supported vendor feature collection", "这个连接暂不支持，请使用 OG98 的 2.4G 接收器。" );
    }
    void send(const OutReport& report) override {
        auto mutableReport = report;
        if (!HidD_SetFeature(handle_.value, mutableReport.data(), static_cast<ULONG>(mutableReport.size()))) winError("HidD_SetFeature");
    }
    InReport receive() override {
        InReport report{};
        if (!HidD_GetFeature(handle_.value, report.data(), static_cast<ULONG>(report.size()))) winError("HidD_GetFeature");
        return report;
    }
};
}
Json enumerateDevices() {
    Json devices = Json::array();
    GUID guid{}; HidD_GetHidGuid(&guid);
    const HDEVINFO info = SetupDiGetClassDevsW(&guid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
    if (info == INVALID_HANDLE_VALUE) winError("SetupDiGetClassDevsW");
    struct Cleanup { HDEVINFO info; ~Cleanup() { SetupDiDestroyDeviceInfoList(info); } } cleanup{info};
    for (DWORD index = 0;; ++index) {
        SP_DEVICE_INTERFACE_DATA iface{}; iface.cbSize = sizeof(iface);
        if (!SetupDiEnumDeviceInterfaces(info, nullptr, &guid, index, &iface)) {
            if (GetLastError() == ERROR_NO_MORE_ITEMS) break;
            winError("SetupDiEnumDeviceInterfaces");
        }
        DWORD size = 0;
        SetupDiGetDeviceInterfaceDetailW(info, &iface, nullptr, 0, &size, nullptr);
        if (!size) continue;
        std::vector<uint8_t> buffer(size);
        auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(buffer.data());
        detail->cbSize = sizeof(*detail);
        if (!SetupDiGetDeviceInterfaceDetailW(info, &iface, detail, size, nullptr, nullptr)) continue;
        Handle handle(CreateFileW(detail->DevicePath, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr));
        if (handle.value == INVALID_HANDLE_VALUE) continue;
        HIDD_ATTRIBUTES attr{}; HIDP_CAPS caps{};
        if (!isReceiver(handle.value, attr, caps)) continue;
        wchar_t product[128]{};
        HidD_GetProductString(handle.value, product, sizeof(product));
        devices.push_back({{"path", utf8(detail->DevicePath)}, {"product", utf8(product)}, {"vid", attr.VendorID},
                           {"pid", attr.ProductID}, {"usagePage", caps.UsagePage}, {"usage", caps.Usage},
                           {"featureReportBytes", caps.FeatureReportByteLength}, {"transport", "2.4GHz"},
                           {"modelVerified", false}, {"candidateModel", "OG98"}});
    }
    return devices;
}
std::unique_ptr<FeatureIo> openDevice(const std::string& path) { return std::make_unique<WindowsFeature>(wide(path)); }
}

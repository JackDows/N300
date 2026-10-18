# 基础层 API v1

`og98.dll` 导出 `og98_create`、`og98_request`、`og98_free`、`og98_destroy`。公开头文件是 `include/og98/og98.h`，Windows x64，默认 C 调用约定。入参和返回值均为 UTF-8 JSON。返回字符串必须用 DLL 的 `og98_free` 释放。

一次请求同步执行；在应用自己的工作线程调用，避免阻塞界面。同一个上下文内串行处理请求。销毁前等待所有调用结束。创建、销毁不修改设置；连接仅做固件读取握手。控制接口以独占方式打开，断开或销毁时释放。

```cpp
#include <og98/og98.h>
#include <cstdio>
int main() {
    auto* context = og98_create();
    if (!context) return 1;
    const char* requests[] = {
        R"({"id":1,"method":"initialize","params":{"offline":true}})",
        R"({"id":2,"method":"connect"})",
        R"({"id":3,"method":"status"})"
    };
    for (auto* request : requests) {
        auto* response = og98_request(context, request);
        if (!response) { og98_destroy(context); return 1; }
        std::puts(response);
        og98_free(response);
    }
    og98_destroy(context);
}
```

其他语言可加载 DLL，或启动 `og98.exe --offline serve` / `og98.exe serve` 使用标准输入输出。每行一个请求、每行一个响应；stdout 不混入启动横幅和日志。JSON 中的反斜线需正常转义。

| method | params | 行为 |
| --- | --- | --- |
| initialize | `offline` 布尔值，`logPath` 可选路径 | 重置会话，选择真实设备/模拟器，设置日志。默认真实设备，DLL 默认不写文件日志 |
| describe | 无 | API 能力与版本 |
| scan | 无 | 兼容接口候选列表；已有会话时返回当前会话 |
| connect | `model:"OG98"`，可选 `path` | 型号由调用者确认；候选唯一时可省略路径。模拟器不需要型号 |
| disconnect | 无 | 释放接口 |
| status | 无 | 顺序读取八类基础设置；没有后台定时刷新 |
| get | `name` | 读取单项，见下表 |
| set | `name:"brightness", value:0..4` | 读取当前灯效，写一次亮度，再回读确认 |

| get.name | result |
| --- | --- |
| firmware | `raw` 16 位固件值，`bytes` 两字节；不推测版本格式 |
| profile | 当前板载配置编号 |
| reportRate | `hz` 和 `raw`；未知编码时 `hz:null` |
| lighting | `mode, speedRaw, brightness, optionRaw, rgbRaw`；模式 13 另含 `userPictureSlot` |
| debounce | 原厂消抖值，尚未独立确认其时间单位 |
| sleep | 蓝牙/2.4G 的普通/深度休眠秒数；0 表示禁用 |
| autoOS | 自动系统切换布尔值 |
| keyboardOptions | 原始三字节选项及已确认的部分布尔位；不推断有冲突的系统位 |

成功响应：

```json
{"apiVersion":1,"id":3,"ok":true,"result":{"brightness":4,"mode":13},"elapsedMs":75}
```

示例仅展示部分字段。`id` 原样返回，日志中另有递增 `sequence`，可关联 API 与该次 HID 交换。

错误响应区分工程诊断和使用提示：

```json
{
  "apiVersion":1,
  "id":3,
  "ok":false,
  "error":{
    "code":"device_not_responding",
    "message":"Receiver did not return the requested keyboard reply within 50 polls",
    "userMessage":"键盘暂时没有响应，轻按一下按键后重试。",
    "details":{"receiverPresent":true,"command":128}
  }
}
```

未来界面显示 `userMessage`；`message`、`details` 和原始报文留在日志中。超时不能直接等同于休眠，也可能是信号、掉线等原因；唤醒后重试是本机已验证的恢复方式。

`write_unconfirmed` 表示设置已发送，但无法确认回读结果。此时应重新读取状态，不能自动重复写设置。亮度写入最多尝试四次回读；每次查询最多 50 轮 F7 状态检查。Windows HID API 本身为同步调用，这个限制不是操作系统 I/O 的硬性取消期限。

常见其他错误：`model_required`、`device_not_found`、`device_ambiguous`、`device_busy`、`not_connected`、`invalid_argument`、`unsupported_setting`。日志写入失败会在响应中附加 `logWarning`。接口版本尚为基础阶段，不提供宏、键位、固件刷写、重置或任意报文透传。

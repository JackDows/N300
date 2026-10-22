# N300 设备接口 v1

## 集成方式

推荐自研 App 直接链接 `n300.dll` 的 C ABI，公开头文件为 `include/n300/n300.h`，
Windows x64 导入库为 `lib/n300.lib`。Qt/C++ 直接链接；C# 可通过 P/Invoke 使用 `cdecl`
和 UTF-8 字符串。DLL 不依赖 Python、Qt、.NET 或 JSON 库的动态运行时。

每个 handle 对应一台设备，拥有独立协议缓存、状态和连接。
DLL 不创建工作线程、GUI、子进程，也不读写缓存文件。
App 负责命令队列、线程、设备配置持久化和 UI 事件分发。

同一个 handle 的 `execute/tick` 内部串行化；不要把同一物理音响交给多个 handle 同时控制。
不同 handle 可分配不同工作线程。BLE 是 I/O 操作，UI 线程不能承担扫描、连接或等待回复。

## 生命周期

1. `n300_create(config, &handle, &error)` 创建会话，不访问硬件。
2. App 创建工作线程，在该线程调用 `n300_thread_initialize(&error)` 初始化 MTA。
3. 注册事件回调，发送 `start`；工作循环在没有命令时每 100–500 ms 调用 `n300_tick`。
4. App 将命令放入自己的队列，工作线程调用 `n300_execute`。
5. 停用时，App 停止接受新命令，必要时从另一线程调用 `n300_cancel` 中断等待。
6. 工作线程执行 `stop` 释放连接，调用 `n300_thread_uninitialize`，退出工作循环。
7. App 等待工作线程结束，再取消回调并 `n300_destroy`。所有会话释放后才卸载 DLL。

成功的 `n300_thread_initialize` 必须在同一线程配对一次 `n300_thread_uninitialize`。
STA UI 线程会收到 `wrong_thread`，不会在内部偷偷创建线程。
完整、可编译的示例见 [cpp_host.cpp](../examples/cpp_host.cpp)。

`start` 本身立即返回；实际连接发生在 `tick` 或需要设备的命令中。
`tick` 最多执行一次到期的连接尝试，可阻塞至配置的超时，不应在 UI 线程调用。
`stop/disconnect` 会关闭控制连接、清除当前值、暂停重连；不会给音响发送关机命令。
后续 `get/set/connect` 为显式设备操作，会按需重新连接；恢复后台重连使用 `start`。

取消会停止软件继续等待，Windows 蓝牙栈已经排队的操作可能仍在结束过程中，
已发出的硬件命令不能撤销。遇到写入超时或断线，App 应重新读取状态后再决定下一步，
底层不会自动重放写命令。

## C ABI 与内存

| 函数 | 用途 |
| --- | --- |
| `n300_abi_version()` / `n300_version()` | ABI/软件版本 |
| `n300_thread_initialize(&error)` | 初始化调用线程的 MTA；成功后必须配对释放 |
| `n300_thread_uninitialize()` | 在同一工作线程释放初始化 |
| `n300_create(config, &handle, &error)` | 创建实例；config 可为 null 或 UTF-8 JSON 对象 |
| `n300_execute(handle, request, &response)` | 执行一次命令 |
| `n300_tick(handle, &response)` | 处理通知、检查断线、按退避策略重连 |
| `n300_cancel(handle)` | 可跨线程调用，中断等待并暂停重连 |
| `n300_set_event_callback(handle, callback, context)` | 设置或移除事件回调 |
| `n300_destroy(handle)` | 工作线程结束后销毁实例 |
| `n300_free(string)` | 释放 DLL 分配的字符串 |

返回码 0 表示成功，1 表示操作失败（读取返回 JSON），2 表示 ABI 参数或内存分配失败。
所有输出字符串由 DLL 分配，调用方必须使用 `n300_free`；不要跨 CRT 使用普通 `free/delete`。
`n300_version` 返回的静态字符串不需要释放。C++ 异常、STL 对象均不跨越 ABI。

回调发生在调用 `execute/tick` 的工作线程中、操作锁之外。事件字符串只在回调期间有效，
App 应复制后排队交给自身事件/UI 线程。回调应快速返回；不要在回调中销毁 handle。
context 的生命周期必须覆盖所有工作线程调用，不能在仍有回调时释放。

## 配置

```json
{
  "address": "AA:BB:CC:DD:EE:FF",
  "scan_timeout_ms": 5000,
  "connect_timeout_ms": 15000,
  "request_timeout_ms": 2000,
  "ack_timeout_ms": 250,
  "input_settle_timeout_ms": 5000,
  "offline": false
}
```

全部可选。连接过程中发现多台候选 N300 时返回 `ambiguous_device`，不按信号强度擅自选择。
App 可保存成功连接后的 `state.target` 对象，下次通过 `{"target":...}` 传入。
其中含地址、服务 UUID、协议和加密信息；使用已验证 target 可直接请求 Windows GATT，
省去扫描。仅提供 address 时会定向扫描，收到目标及完整协议广播即继续。
首次没有目标时，发现首台候选后用 300 ms 收集附近广播；协议信息完整且只有一个候选时提前结束。
这段观察时间不能证明附近没有其他设备；多设备环境应先用 `scan` 列出设备并指定地址。
显式 `scan` 按配置时限列举设备；连接发现所用的 5 秒仍是上限，不是固定延迟。
传入 `offline:true` 时全部硬件访问由模拟设备替代。

每次连接仅读取 D8 功能信息；具体属性按命令读取。`status` 是显式批量读取。
服务枚举优先使用 Windows 缓存；缓存缺少所需通道时重新发现。
同一 handle 保留 GATT 对象、通知订阅与能力信息，后续 `get/set` 直接复用连接。
连续设置音量复用已确认的范围，每次写入仍回读验证。断线后才重新建立连接和握手。

输入源切换是异步操作：只发送一次写入，在 `input_settle_timeout_ms`（默认 5000 ms）内
持续查询，查询之间等待 150 ms。回读达到目标才返回成功；过渡期间的旧值不立即判为失败。
等待支持取消，不重新发送写入。超时、断线或最终值不符仍返回原始错误，并保留回读过程。
离线配置 `offline_input_delay_reads` 可模拟指定次数的旧值，用于验证这个时序。

## 命令

C ABI 的 request 为 `{"method":"get","params":{"property":"volume"}}`。
成功响应为 `{"ok":true,"api_version":1,"offline":false,"result":...}`，
错误为 `{"ok":false,"api_version":1,"error":{...}}`。

| method | params | result |
| --- | --- | --- |
| `describe` | `{}` | API 版本、方法、属性、未实现功能；不访问硬件 |
| `scan` | 可选 `timeout_ms` | 发现的 target 数组；已有连接时报 busy，调用方先 disconnect |
| `connect` | 可选 `address` | 只验证控制服务和能力，返回状态 |
| `start` | `{}` | 启用后续 tick 的自动连接/重连 |
| `stop` / `disconnect` | `{}` | 断开并暂停重连后的状态 |
| `tick` | `{}` | 处理通知和重连后的状态 |
| `status` | 可选 `full:bool` | 状态、已读取值、不可用字段及其原因 |
| `capabilities` | `{}` | 固件报告的功能标记 |
| `get` | `property:string` | 对应属性的当前值及元数据 |
| `set` | `property:string,value` | 经回读确认的属性值 |
| `eq.set` | `band:int,gain:number` | 回读后的 EQ 频段；band 从 0 起，gain 单位 dB |
| `power.off` | `{}` | `command_sent:true,power_state:"unverified"`；停止重连 |
| `diagnostics` | `{}` | 当前会话原始回复、最近命令和统计；不自动查询硬件 |

`status` 默认读取 name、firmware、volume、input、preset；`full:true` 再读取 eq、led、
idle_shutdown、timer。不可用属性列在 `unavailable`，不伪装为完整读取成功。

| property | value | 可写与附加信息 |
| --- | --- | --- |
| `volume` | 整数 | 可写；设备回复 min/max/step，不能假设是 0–100 |
| `input` | 名字或未识别的原始数值 | 可写；raw 与 choices 映射真实输入分组 |
| `preset` | 名字或未识别的原始数值 | 可写；带未适配校准数据时禁止切换 |
| `eq` | 频段数组 | 用 eq.set 修改增益；保留频率和 Q |
| `led` | 布尔值 | 读取到合法回复后可写 |
| `idle_shutdown` | 布尔值 | 可写；无信号自动关机 |
| `timer` | 0–240 整数 | 可写，单位分钟；0 使用取消定时命令 |
| `name` | UTF-8 字符串 | 可写；长度以固件报告的字节上限检查 |
| `firmware` | 版本字符串 | 只读 |

音量结果示例：`{"value":8,"min":0,"max":16,"step":1}`。
输入结果包含 `value:"aux",raw:2,choices:[...]`；宿主 App 应使用 choices 生成自己的菜单。
输入的 `group` 是固件报告的分组，USB 与 USB 声卡分别为 `usb`、`usb_audio`；不能跨分组套用 raw。
参数类型严格区分布尔值和整数，不会把字符串 `"false"` 当作 false。

## 状态与错误

state 包含 `api_version,offline,connected,auto_reconnect,target,values,capabilities,timings`。
values 为已读取且仍有效的值；断线后的状态不再暴露旧值为当前状态。
capabilities 表示设备声明，并非所有字段都已实机确认。

`timings` 记录最近一次连接的 `scan_ms`、`connect_ms`，以及后者内部的 `gatt_ms`、`handshake_ms`。
已连接后的命令不会重新产生这些耗时；它们保留用于诊断，不是该条命令的耗时。
`diagnostics.scan_count/connection_count` 为会话累计扫描次数和成功连接次数，可检查是否重复建连。

事件为 `{"type":"state","sequence":1,"state":...}` 或
`{"type":"connection_error","sequence":2,"error":...,"retry_in_ms":1000}`。
`set` 的写入确认过程还产生 `operation` 事件，包含 `method`、`property`、`expected`、
`outcome`（`confirmed` / `failed`）、`elapsed_ms`、`readbacks` 和失败时的 `error`。
每条 readback 包含 `after_ms` 与回读 `value` 或查询 `error`；输入源使用当前分组的 raw 值。
参数校验阶段失败没有写入确认事件，错误仍通过请求响应返回。
事件 sequence 在同一实例内递增。通知在 execute/tick 中处理，因此 App 必须持续调度 tick。

error 包含稳定的 `code`、说明 `message`、`retryable` 和 `details`。
常见 code：`invalid_argument`、`not_found`、`ambiguous_device`、`wrong_thread`、
`bluetooth_unavailable`、`connection_failed`、`disconnected`、`timeout`、`cancelled`、
`unsupported_protocol`、`service_mismatch`、`unsupported`、`unsupported_response`、
`verification_failed`、`busy`、`method_not_found`、`internal_error`。

## JSON-RPC stdio

启动 `n300.exe serve`；每行一个 UTF-8 JSON 消息，最大 1 MiB，支持标准请求、通知和 batch。
方法与 DLL 相同；有 id 返回 response，无 id 的请求不返回 response。
设备事件作为 `method:"event"` 通知输出，首条 `ready` 通知说明进程已经就绪，并带 `core_version`。
处理带 id 的请求期间产生的事件附带 `request_id`，可与请求、响应关联。后台 tick 事件没有请求编号。
stdout 不混入日志，stderr 用于诊断；关闭 stdin 后处理已接受请求，停止连接并退出。

```json
{"jsonrpc":"2.0","id":1,"method":"get","params":{"property":"volume"}}
{"jsonrpc":"2.0","id":1,"result":{"value":8,"min":0,"max":16,"step":1}}
```

错误码遵循 JSON-RPC：-32700 解析错误，-32600 请求无效，-32601 方法不存在，
-32602 参数错误，-32603 内部错误；设备错误为 -32000，error.data 为底层 error 对象。

## 实现参考

- [Windows GATT 客户端](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/gatt-client)：设备发现、服务、通知和连接生命周期。
- [C++/WinRT 并发](https://learn.microsoft.com/en-us/windows/apps/develop/cpp-winrt/concurrency)：Windows Runtime 的线程与异步操作。
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)：请求、响应、通知与批量调用格式。

## 0.1.1 连接恢复

保存过地址仍可能遇到 Windows 的 BLE 发现缓存失效。连接返回 `not_found` 后，模块会在同一会话内只扫描原地址，更新发现信息，再连接和握手；不会改绑到另一台音响。已连接时复用会话，不为每次读写扫描。

GATT 服务以 `SharedReadAndWrite` 打开。缓存服务或特征查询失败时再查实机；占用、访问拒绝与设备未发现分别进入诊断。重连没有修改输入源的请求，也不会重放已经发出的设置指令。

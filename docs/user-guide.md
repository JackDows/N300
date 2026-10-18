# N300 命令行使用

运行分发目录中的 `n300.exe`，同目录保留 `n300.dll`。没有图形界面，也不需要启动脚本。

## 第一次连接

1. 打开电脑蓝牙，让音响处于可发现状态。
2. 执行 `n300.exe shell`，程序自动发现、连接并保持会话。
3. 输入 `volume` 查看音量。需要主动选择设备时，使用 `scan` 列表中的地址启动。

```powershell
.\n300.exe --address AA:BB:CC:DD:EE:FF status
```

程序会核对 N300 控制服务与功能回复。能播放蓝牙音频并不代表控制服务已连接。
成功后，CLI 将目标地址、服务和广播协议信息保存在 `%LOCALAPPDATA%\n300\target.json`。
下一次优先使用已验证目标直接连接；不会固定等待一次完整扫描。
指定地址时，收到完整的目标广播即结束发现；首次自动发现会额外观察 300 ms 收集候选。
附近有多台音响时先执行 `scan`，指定地址，避免早期发现顺序影响选择。
缓存目标失效时，可执行 `n300.exe --no-cache scan` 并重新指定地址，或执行 `forget` 清除缓存。
未发现或无法连接时，再退出手机 EDIFIER Connect、断开手机连接后重试。

## 常用命令

```powershell
.\n300.exe status                   # 常用设置；按设备支持情况读取
.\n300.exe status --full            # 还包括 EQ、灯光、定时等
.\n300.exe capabilities             # 固件报告的功能
.\n300.exe volume                   # 当前音量和设备范围
.\n300.exe volume 8                 # 设置绝对音量，随后回读验证
.\n300.exe input aux                # 输入选择：以 get input 的 choices 为准
.\n300.exe preset music             # 音效选择：以 get preset 的 choices 为准
.\n300.exe preset customized
.\n300.exe eq                       # EQ 频段、频率、增益、范围与步进
.\n300.exe eq set 1 -2              # 第 2 个频段（索引从 0 起），增益 -2 dB
.\n300.exe led off
.\n300.exe idle-shutdown on
.\n300.exe timer 30                 # 30 分钟后关机
.\n300.exe timer 0                  # 取消定时
.\n300.exe name "桌面 N300"
.\n300.exe firmware
.\n300.exe power-off
```

所有属性也可使用统一形式：`get volume`、`set volume 8`、`get idle_shutdown`。
输入、音效允许使用设备回复的名字或 `raw` 数值。未确认的选项或 EQ 格式会返回错误。
没有实现固件升级、恢复出厂、EQ 频率/Q 编辑或云端 EQ 功能。

## 连续输入命令

```powershell
.\n300.exe shell
# 无参数启动 n300.exe 也进入 shell
```

启动后自动连接并保持会话。可以连续输入：

```text
volume
volume 8
preset music
status
stop
start
exit
```

`stop` 断开控制连接并暂停重连，不关闭音响；`start` 恢复自动连接。
断线后以 1、2、4、8、15 秒的间隔重试，之后最多每 15 秒一次；
遇到需要明确选择设备、协议不支持等错误则停止重试。
`exit` 或 stdin EOF 会停止工作线程并清理控制连接。Ctrl+C 请求取消等待并退出。
写入命令不会自动重放，避免在断线后重复改动设置。

单条命令执行完即退出并释放连接，适合脚本和调试。
频繁控制请使用 shell、`serve` 或 DLL 会话，以复用连接。

## 首次连接与连续操作耗时

```powershell
.\n300.exe benchmark
```

该命令只连接和读取，不修改音量：连接一次，连续读取三次音量，再读取输入及诊断。
`connect_elapsed_ms` 是这次 connect 调用的耗时（新进程包括必要的发现），
`warm_volume_ms` 是同一连接上三次真实查询的耗时；`diagnostics.connection_count` 正常为 1。
在已经连接的 shell 中执行 `benchmark`，connect 调用只检查并复用现有连接。

状态中的 `timings` 保留最近一次连接记录，不能把 `connect_ms` 当成每条命令的耗时。
`gatt_ms` 记录 Windows 打开设备、查询服务及订阅通知，`handshake_ms` 记录能力握手；
两者包含在 `connect_ms` 内。连接保持期间只执行需要的命令与回复，没有固定的连接等待。

## 离线版与自研 App

```powershell
.\n300.exe --offline status --full
.\n300.exe --offline shell
.\n300.exe --offline serve
```

离线模式使用内存模拟设备，不扫描或控制真实音响，不读写目标缓存。
每个进程/会话的模拟状态独立，不作为实机验证结果。

`serve` 为 UTF-8 JSON-RPC 2.0，每行一个 JSON 消息。stdout 只输出响应和事件，
诊断写入 stderr。默认自动连接；`--no-autoconnect` 可等待 App 主动调用。

```json
{"jsonrpc":"2.0","id":1,"method":"get","params":{"property":"volume"}}
{"jsonrpc":"2.0","id":2,"method":"set","params":{"property":"volume","value":8}}
{"jsonrpc":"2.0","id":3,"method":"stop"}
```

stdout 会穿插 `method: "event"` 的通知，App 应根据 `id` 匹配请求响应。
完整的进程和 DLL 接口见 [API 文档](api.md)。

## 参数和诊断

全局参数可放在命令前：

| 参数 | 用途 |
| --- | --- |
| `--address XX:XX:XX:XX:XX:XX` | 明确选择一台设备 |
| `--cache path` | 指定 CLI 缓存路径 |
| `--no-cache` | 不读取或保存目标缓存 |
| `--scan-timeout-ms 5000` | 扫描上限；连接发现可在目标信息齐全后提前结束 |
| `--connect-timeout-ms 15000` | 一次 Windows GATT 连接流程时限 |
| `--request-timeout-ms 2000` | 单次底层写入/回复等待时限 |
| `--debug` | 将状态事件和诊断写入 stderr |
| `--offline` | 使用模拟设备 |

单条命令成功时，stdout 为 `{ok:true, api_version:1, result:...}`；失败时 stderr
为 `{ok:false, error:{code,message,retryable,details}}`。单条命令及 shell 的设备命令均有 `elapsed_ms`。
退出码：0 成功，2 参数错误，3 未找到/多个设备，4 连接或超时错误，5 其他设备错误，130 取消。

在 shell 中执行 `diagnostics` 查看当前会话的原始回复、最近 128 条命令、校验错误计数和连接耗时。
单独运行 `diagnostics` 只显示新会话，不自动查询硬件。状态中缺失的字段不代表设备当前值为零。

读取成功后，可再验证切回原来的 AUX 输入是否保持控制连接。
输入切换可能影响正在播放的声音；Windows 默认音频输出设备不会由该程序修改。

# G HUB 本地接口依据

分析目标为 G HUB 2026.6.981214。官方 Electron 容器 `resources/app.asar` 的 SHA-256 为 `5bcb683032410c4fc35462822751fcb1429d4da7cebfa57cda688d9468401875`。只提取并静态读取 `main.js`、`preload.bundle.js` 和 `app.min.js`，未执行提取代码或修改原厂安装。

REA 静态记录：`ev_eaa92c7056d238f78db3faf40f76b217c649ea317ce46bf0155cc565a2e7db99`；摘要：`ev_d0661b79b017e229619ccba66f809affab5860f195579d83a85b0b080134a84e`。语法分析有节点上限，结论只覆盖所列路径。完整输入及索引在忽略目录 `research/inputs/ghub-2026.6.981214/`，精简实测记录在 `research/evidence/ghub-2026-10-19/`。

## 传输与路由

官方主进程连接 `ws://localhost:9010`，子协议 `json`。DeskHub 固定连接 `127.0.0.1:9010`，使用 Windows WinHTTP。请求为 `{msgId,verb,path,payload?}`，响应按 `msgId` 匹配并检查路径和 `result.code`，仅 `SUCCESS` 算成功。忽略没有请求编号的后台通知，通过轮询读取状态。单响应上限 1 MiB，单次响应等待上限三秒。

| 路由 | 语义 |
| --- | --- |
| `GET /devices/list` | `deviceInfos` 列表；仅 `ACTIVE` 可控制 |
| `GET /profile/active` | 当前软件配置 ID |
| `GET /profile`，`{id}` | 配置及 `assignments` |
| `GET /card`，`{id}` | 配置卡片；写回前移除根 `@type` |
| `SET /card` | 写回目标卡片，仅修改指定字段 |
| `GET /report_rate/{id}/report_rate_list` | `rates` / `wirelessRates` |
| `GET /battery/{id}/state` | `percentage` / `charging`，不支持时省略 |
| `GET /onboard_profiles/{id}/onboard_mode` | `enabled` |
| `SET /onboard_profiles/{id}/onboard_mode` | `{mode:"HOST"}` 或 `{mode:"ONBOARD"}` |
| `GET /onboard_profiles/{id}/profiles` | `directoryEntries`、启用状态、板载默认设置 |
| `GET /onboard_profiles/{id}/active_profile` | `onboardSlotId` |
| `SET /onboard_profiles/{id}/active_profile` | `{onboardSlotId:"PROFILE_1"}` 等启用项 |

旧卡片使用 `<slotPrefix>_mouse_settings` 的 `mouseSettings.dpiTable.activeDpi`。新卡片使用 `<slotPrefix>_mouse_sensitivity`：`mouseSensitivity.presetId` 引用包含 `advancedDpiTable` 的设置卡，切换档位只改引用卡的 `activeDpiIndex`。回报率只改设置卡中当前连接方式对应的 `reportRate.value` 或 `wirelessRate`。个体配置模式按原厂规则在 slotPrefix 前加设备签名。

写前再次读取活动配置身份，配置切换时拒绝写入；不自动切板载模式、不写原厂数据库、不创建新预设。新统一配置路由在本机返回 `NO_SUCH_PATH`，实现采用实际使用的 profile/card 接口。

WinHTTP 参考微软 [WebSocket 示例](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/WinhttpWebsocket/cpp/WinhttpWebsocket.cpp) 和 [CompleteUpgrade 文档](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpwebsocketcompleteupgrade)。

## 2026-10-19 验证范围

真实后台只读连接已确认：PRO X SUPERLIGHT 2 SE，固件 32.5.29，状态 `NOT_CONNECTED`。可读取配置、预设和板载目录；依赖设备在线的部分路径返回不支持或无数据。模块将其呈现为等待连接，未伪造 DPI 或连接成功。

用户确认鼠标实物暂时不在。本轮没有真实鼠标设置写入，实际 DPI、回报率、模式和板载配置效果待设备返回后验证。写入结构依据官方静态代码，完整控制链路由原生模拟及本地协议服务测试覆盖；这些结果不能代替硬件验证。

本地接口是 G HUB 内部接口，升级可能改变路径或字段。遇到不支持时保留错误证据并停用对应控制项；可独立更新本模块，不影响 N300、OG98。

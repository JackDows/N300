# Logitech G HUB 模块

DeskHub 的独立鼠标模块，复用本机已安装并运行的 G HUB 后台，原厂窗口可以关闭。模块不启动、停止或修改 G HUB 的服务和系统配置。

## 基础功能

| 能力 | 数据与行为 |
| --- | --- |
| `device.info` | 名称、型号、固件、连接方式；设备未连接时仍可显示后台记录的身份 |
| `device.battery` | 电量百分比、充电状态；后台不提供时不显示 |
| `device.onboardMode` | `false` 为软件控制，`true` 为板载模式；显式切换后回读确认 |
| `mouse.dpiStage` | 字符串档位 ID，例如 `"3"`；`choices` 提供当前配置已有的 DPI，支持 X/Y 分离标签 |
| `mouse.reportRate` | Hz 整数；选项来自设备支持列表，有线和无线设置分别保存 |
| `mouse.profile` | 板载模式可选已启用配置；软件模式显示当前配置身份，只读 |
| `mouse.bindings` / `mouse.bindings.set` | 当前鼠标标准与 G-Shift 按键读取、绑定卡片、恢复默认 |
| `macros.list/get/save/remove` | 当前应用的宏库、动作编辑、原生验证与回读；软件模式绑定使用 |

每次读取提供 `writable`，不可写的控制项置灰。板载模式显示配置的**默认 DPI**，不代表鼠标硬件临时切换后的当前 DPI。调整 DPI 档位和回报率需选择软件控制。只读预设由 G HUB 管理，本模块不复制或覆盖它。

0.2.0 增加软件按键绑定与宏：单次、按住重复、切换重复和分阶段执行，支持键盘、鼠标按钮、滚轮与延时。原厂只读和未知动作的已有宏保留绑定能力；完整结构见 [控制接口](../../docs/controls.md)。自定义 DPI 档位、灯效、游戏配置管理、板载宏写入与固件更新不在当前范围。

## 构建、替换与模拟

从仓库根目录运行：

```powershell
.\scripts\project.ps1 -Action Install -Module logitech-ghub
.\scripts\project.ps1 -Action Test -Module logitech-ghub -Configuration Debug
.\scripts\project.ps1 -Action Run -Module logitech-ghub -Offline
```

构建依赖 VS 2022、Windows SDK、CMake 与固定版本 nlohmann/json。测试用的 Node `ws` 在根锁文件中声明；正式 EXE 使用系统 WinHTTP，不需要 Node。模块运行包位于 `artifacts/package/<配置>/modules/logitech-ghub/0.2.0/`。

独立模块使用公共 stdio JSON-RPC 协议；离线初始化、连接后可读取 `mouse.dpiStage`。在宿主中以 `moduleId:"logitech-ghub"` 添加实例，扫描并绑定候选的完整 `target`，随后连接。`resourceId` 使用稳定设备签名，不保存本次 G HUB 会话的临时设备 ID。

桌面鼠标逻辑 ID 是 `mouse`。模块通过已有 `modules.download/install` 独立安装更新，通过 `devices.replace` 替换，其他设备进程不受影响。多个鼠标候选时由用户选择。

离线模式使用内存后台，仍经过同一套设置解析与写入逻辑；不访问 G HUB 或真实鼠标。浏览器模拟快照由原生离线模块采集。测试还覆盖真实 WinHTTP 到本地 WebSocket 测试服务的分片响应、断连、延迟回读、失败拒绝、超时与退出取消。

## 连接与诊断

G HUB 未启动、设备不在线或正在初始化时保持等待，每三秒检查一次。没有变化时不重复发布界面状态。断开 DeskHub 会话会停止重连；关闭模块会结束它自己的接收线程，保留官方后台。

写命令只发送一次，短暂模式切换允许约两秒回读等待；超时不重放写入。设置修改保留同一配置内的其他字段。日志保留请求路径、错误代码和模块会话，界面仅显示操作提示。DeskHub 系统页可导出统一日志。

协议来源、已验证版本与硬件验证边界见 [协议依据](docs/protocol.md)。

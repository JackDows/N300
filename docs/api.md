# DeskHub 公共接口 v1

运行 `deskhub.exe --module-root modules --data-dir data --offline serve`。UTF-8，每行一个 JSON-RPC 请求或响应，stdout 同时输出事件通知，stderr 输出诊断。每帧上限 64 KiB。请求必须带字符串/整数 `id`；不支持批量请求。调用有依赖的操作时，等待前一条响应。

```json
{"jsonrpc":"2.0","id":1,"method":"devices.add","params":{"id":"speaker","moduleId":"edifier-n300","label":"桌面音响"}}
{"jsonrpc":"2.0","id":2,"method":"devices.connect","params":{"deviceId":"speaker"}}
{"jsonrpc":"2.0","id":3,"method":"devices.read","params":{"deviceId":"speaker","capability":"audio.volume"}}
```

方法清单与参数 Schema：[api.schema.json](../contracts/api.schema.json)。类型定义：[client.d.mts](../contracts/client.d.mts)。`moduleId` 默认选择本地最高稳定版本；同版本存在不同包时明确传 `packagePath`，指向完整模块包的目录或 `module.json`。已有设备的绑定版本不随目录变化自动替换。

| 方法 | 主要参数 | 返回 |
| --- | --- | --- |
| hub.describe | 无 | 后端版本、方法、运行模式与数据目录 |
| modules.list | 无 | 随应用提供及用户安装的已校验模块 |
| modules.inspect | moduleId 或 packagePath | 包清单、路径、指纹；不启动模块 |
| modules.catalog / checkUpdates | 无 | 签名在线目录与已安装版本 |
| modules.download / install | moduleId/version 或 jobId/deviceId | 下载与安装任务 |
| updates.list / get / cancel | 单项操作需要 jobId | 更新任务及取消结果 |
| app.updates.info / check / download / install | install 需要 jobId | 桌面整包升级流程，CLI 不提供 |
| devices.add | id、模块选择；可选 label/offline/target/config | 保存后的实例，尚未连接 |
| devices.list / get | get 需要 deviceId | 全部实例 / 单个缓存快照 |
| devices.start / stop / restart | deviceId | 模块生命周期操作后的快照 |
| devices.scan | deviceId；可选 arguments | `{label, modelVerified, target}` 候选列表 |
| devices.connect / disconnect | deviceId | 连接状态快照 |
| devices.refresh | deviceId | 主动从设备读取后的快照 |
| devices.read | deviceId、capability | `{value,...元数据}` |
| devices.write | deviceId、capability、value | 回读确认的结果；不自动重放写命令 |
| devices.invoke | deviceId、capability、arguments | 功能专属结果，例如 EQ 单频段设置 |
| devices.replace | deviceId、模块选择 | 相同 moduleId 的新版本；保留目标与配置 |
| devices.rebind | deviceId、模块选择、target；可选 config | 换设备/型号；保留 ID 与 label |
| devices.rename | deviceId、label | 更新显示名称 |
| devices.remove | deviceId | 停止并移除绑定；日志保留 |
| diagnostics.export | 无 | `{directory}`，诊断文件目录 |

设备操作可传 `timeoutMs`，范围 50–60000，默认 30000；包括排队时间。模块启动握手固定最多 5 秒，生命周期预检查与清理不受此字段控制。EOF 会等待已接受的宿主请求完成；需要立即停止某台设备时调用 `devices.stop`。

## 状态与能力

快照含 `id,label,moduleId,moduleVersion,generation,revision,phase,offline,target,bindingTarget,capabilities,values,unavailable,valueState,error,processId`。

`phase` 为 stopped、starting、disconnected、connected、waiting、faulted。`processId` 仅供诊断。`target` 是当前观测信息，`bindingTarget` 是保存的连接目标。

`capabilities` 声明模块支持的 read/write/invoke，`values[capability]` 是设备返回的值与范围/选项，不能默认音量为 0–100。`unavailable` 保存当前设备不能读取的功能及原因。模块声明有实现，不等于所有固件均已实测。

数值控制使用读取结果的 `min/max/step`；定时关机的单位是分钟，范围 0–240，0 表示取消。设备重命名使用 `device.name.maxBytes` 检查 UTF-8 编码长度，不按字符个数截断。EQ 的频段列表、范围和步进取自 `audio.eq`；模拟配置与真实固件可能不同。

`valueState` 为 unknown、confirmed、stale。连接断开或模块停止时清除当前值；操作失败后可能保留旧值，但标为 stale。用 `devices.refresh` 更新，不把旧值当作刚刚确认的结果。

| 模块 | 能力 |
| --- | --- |
| N300 | audio.volume、audio.input、audio.preset、audio.eq、lighting.enabled、device.idleShutdown、device.timer、device.name、device.firmware；invoke：audio.eq.setBand、device.powerOff |
| OG98 | device.firmware、keyboard.profile、keyboard.reportRate、lighting.state、lighting.brightness、keyboard.debounce、keyboard.sleep、keyboard.autoOS、keyboard.options；目前只有亮度可写 |

N300 EQ 调用示例：`devices.invoke`，`capability:"audio.eq.setBand"`，`arguments:{band:0,gain:2}`。关机的返回值可能标明状态未验证，不能仅凭请求完成推断硬件已经关机。

## 真实设备绑定

1. 添加一个模块实例，暂不填写 target。
2. `devices.scan` 获取候选。
3. 用户选择后，通过 `devices.rebind` 将候选的完整 target 原样保存。
4. `devices.connect` 连接。真实实例没有 resourceId 时返回 target_required。

OG98 的 USB ID 与其他型号共用，候选 `modelVerified:false`；选择此模块前须确认键盘是 OG98。当前只支持 2.4G。N300 连接目标和能力依据已有 BLE 实现。

## 事件与错误

- `devices.changed`：`params.device` 是完整快照。前端按 ID 更新，忽略较旧 generation 或 revision。
- `devices.removed`：`params.deviceId`。
- `updates.changed`：`params.job` 为完整更新任务快照。调用顺序与失败恢复见 [更新接口](updates.md)。
- `operations.changed`：包含 deviceId、generation、requestId，以及 pending/completed/failed。用于表示正在操作，completed 代表请求结束；实际确认程度看返回数据。

失败在 `error.data` 提供 `code,message,userMessage,details`。界面显示 userMessage，message/details 用于日志。SDK 的 `DeskHubError.message` 已选择用户提示，技术原因另放在 technicalMessage。

重要错误：`queue_timeout` 表示尚未发送；`write_unconfirmed` 表示设备可能已执行；`stale_session` 表示会话已更换。后两种不能自动重放操作，应重新读取状态。模块崩溃/超时后可重新连接；损坏或接口不兼容的替换包会在停旧模块之前拒绝。

导出的日志包含设备地址、配置与控制报文，不采集普通键盘输入。浏览器模拟器不写本地日志；原生离线模式走相同的日志链路。

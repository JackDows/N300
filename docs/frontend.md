# 前端接手指南

前端只对接 DeskHub 公共接口。设备进程、线程、重连和协议都由后端管理。现有 N300 界面在 `apps/desktop/`，视觉设计与多设备页面由前端工程继续完成。

## 先在浏览器开发

`contracts/mock.mjs` 不依赖 Node 或硬件。将 `contracts/fixtures/devices.json` 作为普通 JSON 数据加载后：

```js
import { createMockClient } from './contracts/mock.mjs';
const client = createMockClient(deviceFixtures);
const devices = await client.request('devices.list');
const unsubscribe = client.subscribe((event) => {
  if (event.type === 'devices.changed') updateDevice(event.device);
});
await client.request('devices.write', {
  deviceId: 'keyboard', capability: 'lighting.brightness', value: 2,
});
// 仅模拟器提供：切换休眠等待、断开或故障，用来验证界面状态。
client.simulate('keyboard', 'waiting');
```

也可把 `contracts` 作为本地 npm 包引入，包名为 `@deskhub/client`。类型定义随包提供，SDK 不含 UI 组件。

模拟器覆盖设备列表、连接、读写、停止、重启、换设备和状态事件。它使用原生离线模块采集的快照，支持每台设备串行、不同设备并行，以及旧会话写入取消。模块包校验、真实进程故障和诊断导出请用下一种方式验收。

## 用真实后端做离线联调

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
node examples/offline-demo.mjs
```

`contracts/node.mjs` 启动 `deskhub.exe` 并管理输入输出，示例展示两个设备同时连接、读取音量、设置亮度和单独重启键盘。`--offline` 强制所有实例使用模块内部模拟器，连接过程不会访问真实硬件。模拟状态在模块重启后回到基线，宿主不会自动恢复旧写入。

这一层与真实模式的公共 API、模块包、进程、队列和事件相同，只替换最底层硬件访问。

## 接入桌面壳

公共 Rust 库位于 `backend/`，可作为 Tauri 壳的路径依赖。启动时创建一个 `Hub`，把其事件回调发送到前端；命令桥在后台执行器调用 `Hub::request`。退出或安装应用更新前调用 `Hub::shutdown`。

```rust
// 注册命令并把 Hub 放入应用 state 后：
#[tauri::command]
async fn deskhub_request(
    hub: tauri::State<'_, deskhub_backend::Hub>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.request(request))
        .await.map_err(|e| e.to_string())
}
```

也可托管 `deskhub.exe serve`，继续使用相同协议。`contracts/client.mjs` 的 transport 只需实现 send(message) 和 subscribe(callback)。不要在界面线程同步等待设备操作。

## 界面应遵守的接口语义

- 初始读取 devices.list，随后订阅事件；刷新页面不需要重启设备模块。
- 按稳定的 deviceId 保存页面归属，label 可变，moduleId 在换硬件时也可变。
- 从 capabilities、读取结果的范围与 choices 构造控制项；未知能力可留给专用页面。
- 使用 pending/completed/failed 表示操作进度；旧值、等待状态和错误分开显示，避免整页反复进入加载态。
- 写入失败时不要重复发送。用新的读取结果恢复显示；会话已经变化时丢弃旧结果。
- 技术错误进入诊断，界面只显示 userMessage。模块版本、进程号和原始报文用于开发与排查。

测试入口 `scripts/project.ps1 -Action Test` 包含类型检查、浏览器模拟器、原生离线模块和进程故障测试。更新能力定义后，用 `examples/capture-fixtures.mjs` 重新采集浏览器基线。

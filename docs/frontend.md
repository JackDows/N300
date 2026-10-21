# 前端接手指南

DeskHub 0.6 采用用户选定的 B「现代平面」方案。正式入口在 `apps/desktop/`，`design/ui-concepts/` 保留设计对照样稿。后端与设备模块继续独立运行，前端只使用公共接口。

## 界面结构与验证

- `App.tsx` 管理总览、音响、键盘、鼠标、主机、设备与应用六个页面；侧栏和窗口控制常驻。访问过的页面保持挂载，切换页面保留未保存的内容，隐藏页面立即停止录制。
- `styles/tokens.css` 定义中性色、文字和交互状态；`styles/workbench.css` 定义 B 方案的排版与结构。按钮和输入采用平面造型、清晰边界和黑白反转选中态，无场景资产或三维依赖。
- `Overview` 读取真实设备状态，直接调节音量、键盘亮度和 DPI 档位；离线时数值留空并禁用写入。主机摘要由 `HardwareProvider` 共享，不伪造温度或使用率。
- `KeymapEditor` 使用真实槽位布局，下方编辑当前功能、组合键与媒体键。普通/Fn 层草稿独立保存，写入可撤销；会话替换后清除旧草稿及请求结果。
- `MouseTools` 使用宏库、动作序列和属性栏，保留录制、动作编辑、执行方式、保存和按键绑定。失焦或切换页面停止录制，Esc 只结束当前录制或文本编辑。
- `SystemConsole` 管理连接、日志、整包升级与模块独立下载安装。`ModulePanel` 使用现有签名目录及更新任务接口，支持进度、取消、安装应用与失败重试。
- `ConsoleHeader` 是页面标题；返回总览不销毁草稿。图标操作提供可访问名称，Tab、方向键与原生表单操作可用。技术错误进入诊断。
- `npm --prefix apps/desktop run dev` 打开浏览器离线预览；`?view=overview|speaker|keyboard|mouse|computer|system` 直接进入页面。日志导出在原生宿主验证。
- `npm --prefix apps/desktop run test:ui` 使用 Windows 上的 Microsoft Edge 执行控制、焦点、离线更新与窗口尺寸回归，自动启动预览服务。`test:desktop` 使用已构建的 Windows 程序和原生离线模块验证设备控制、更新校验、单实例与日志导出。

窗口默认 1360 × 900，最小 960 × 680，可最大化。小窗口通过页面滚动和编辑器重排保持操作可达。验证记录见 [界面审查](design-review.md)，生成物位于 `artifacts/validation/`；交付前按 `AGENTS.md` 人工检查和清理。

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

模拟器覆盖模块信息、设备列表、全部已声明基础控制项、EQ 单频段设置、离线关机、停止、重启、替换、换设备和状态事件。它使用原生离线模块采集的快照，支持每台设备串行、不同设备并行，以及旧会话正在执行和排队写入的取消。重复连接保留当前设置；重启模拟设备恢复基线。`tests/features.mjs` 对模拟器和原生离线后端执行同一组功能场景。模块包校验、真实进程故障和诊断导出请用下一种方式验收。

## 用真实后端做离线联调

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
node examples/offline-demo.mjs
```

`contracts/node.mjs` 启动 `deskhub.exe` 并管理输入输出，示例展示两个设备同时连接、读取音量、设置亮度和单独重启键盘。`--offline` 强制所有实例使用模块内部模拟器，连接过程不会访问真实硬件。模拟状态在模块重启后回到基线，宿主不会自动恢复旧写入。

这一层与真实模式的公共 API、模块包、进程、队列和事件相同，只替换最底层硬件访问。

## 接入桌面壳

桌面宿主已接入公共 Rust 库 `backend/`，统一管理设备模块与整包安装。前端直接使用以下 SDK，不需要再实现 Rust 桥或托管子进程：

```js
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createDesktopClient } from './contracts/desktop.mjs';
const client = await createDesktopClient({ invoke, listen });
const info = await client.request('hub.describe');
const updates = await client.request('updates.list');
```

设备与模块更新也可通过 `deskhub.exe serve` 使用；整包安装需要桌面宿主。以 `hub.describe.methods` 判断可用接口。`contracts/client.mjs` 的自定义 transport 只需实现 send(message) 和 subscribe(callback)。

整包升级、模块独立下载和安装的完整调用顺序、任务状态与错误处理见 [更新接口](updates.md)。浏览器模拟器通过 `updateScenario` 提供成功、网络失败、坏签名、安装失败场景，便于设计更新页面。

## 界面应遵守的接口语义

鼠标由独立 `MouseProvider` 通过公共 SDK 管理，未依赖音响状态。界面读取 `writable` 和 `choices`，不把 G HUB 的内部配置 ID、WebSocket 路径或原始错误展示给用户。未连接时不显示上次 DPI、电量和回报率；等待设备不会阻塞音响和键盘。键位、宏编辑及录制行为详见 [控制接口](controls.md)。灯效模式/逐键颜色编辑不在当前范围。

- 初始读取 devices.list，随后订阅事件；刷新页面不需要重启设备模块。
- 按稳定的 deviceId 保存页面归属，label 可变，moduleId 在换硬件时也可变。
- 从 capabilities、读取结果的范围与 choices 构造控制项；未知能力可留给专用页面。
- 使用 pending/completed/failed 表示操作进度；旧值、等待状态和错误分开显示，避免整页反复进入加载态。
- 写入失败时不要重复发送。用新的读取结果恢复显示；会话已经变化时丢弃旧结果。
- 技术错误进入诊断，界面只显示 userMessage。模块版本、进程号和原始报文用于开发与排查。

测试入口 `scripts/project.ps1 -Action Test` 包含类型检查、浏览器模拟器、原生离线模块和进程故障测试。更新能力定义后，用 `examples/capture-fixtures.mjs` 重新采集浏览器基线。

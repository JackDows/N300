# DeskHub 桌面

Tauri 宿主直接托管 `deskhub-backend`，设备通过各自独立的模块进程运行。整包更新使用签名 NSIS 安装器，模块目录、下载、校验与替换由公共后端管理。

根目录通用工程入口负责依赖、构建、运行和测试。打开根目录的 `DeskHub.code-workspace`，或执行：

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
.\scripts\project.ps1 -Action Run -Configuration Debug -Offline
```

仅浏览器开发可在本目录执行 `npm run dev`，使用共享离线模拟器。视觉设计与多设备页面由前端继续安排；现有音响页面已经接入公共接口。

- `src-tauri/src/lib.rs`：统一 `hub_request` 命令、事件、单实例与生命周期。
- `src-tauri/src/updates.rs`：应用更新检查、下载、安装、重启结果与安装包清理。
- `src/device/`：现有音响页面使用的展示状态与公共 API 调用。
- `src/updates/`：现有更新提示的接口接线。
- `tests/`：SDK 桥与真实 Windows WebView 验收。

[前端接手指南](../../docs/frontend.md) · [更新接口](../../docs/updates.md) · [打包发布](../../docs/releases.md)

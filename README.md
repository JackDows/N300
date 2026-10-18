# DeskHub

个人多设备控制软件的后端工程。当前接入 EDIFIER N300 音响与腹灵 OG98 键盘：统一管理设备实例，每台设备使用独立控制进程、工作队列和线程，模块可单独运行、重启、替换。

桌面宿主、整包升级与模块独立下载安装均使用统一后端。`apps/desktop/` 中的现有音响页面已接入公共接口；多设备页面与视觉设计由前端继续开发。接口、TypeScript SDK 和更新流程的离线模拟已提供。

## 开发入口

打开 [DeskHub.code-workspace](DeskHub.code-workspace)。运行面板固定为：安装依赖、构建 Debug、构建 Release、运行 Debug、运行 Release、运行离线测试版。

基础环境：Windows x64、VS 2022 C++ 桌面开发工具与 Windows SDK、CMake 3.24+、Node.js 24+、PowerShell 5.1/7。缺少 Cargo 时，安装入口会在工程依赖目录内安装固定的 Rust 1.99.1，不修改系统 PATH。npm、Cargo 与 C++ 依赖均有锁或下载哈希；工作区共享依赖的位置见 [文件与依赖](docs/storage.md)。

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Test -Configuration Debug
.\scripts\project.ps1 -Action Test -Configuration Release
.\scripts\project.ps1 -Action Run -Offline
```

`Run` 启动 DeskHub 桌面程序。加 `-Component Backend` 可运行独立后端控制台；离线控制台自动准备 `speaker` 和 `keyboard`，可输入 `list`、`read speaker audio.volume`、`write keyboard lighting.brightness 2`、`restart keyboard`、`quit`。Node 端到端示例：

```powershell
node examples/offline-demo.mjs
```

只构建一个模块或公共后端：

```powershell
.\scripts\project.ps1 -Action Build -Module edifier-n300 -Configuration Release
.\scripts\project.ps1 -Action Build -Module flesports-og98 -Configuration Release
.\scripts\project.ps1 -Action Build -Module Backend -Configuration Release
```

模块由 `modules/*/module.json` 自动发现；增加模块时实现该目录的 `module.ps1` 构建入口，通用任务名称保持不变。

## 交付目录

`artifacts/desktop/Debug` / `Release` 中包含 `DeskHub.exe` 与模块；`artifacts/package/Debug` / `Release` 包含独立后端 CLI、模块、接口 SDK 与文档。复制整个目录到另一台 Windows x64 电脑即可运行，无需 Node、Rust、原厂软件或 REA；桌面需要 WebView2 Runtime。Release 构建同时生成 NSIS 安装器，有签名私钥时生成整包与模块发布文件。

桌面和公共后端默认使用 `%LOCALAPPDATA%\DeskHub\backend\online` / `offline` 保存绑定、模块、更新任务和日志；控制台开发脚本使用 `artifacts/data/online` / `offline`。运行时模块复制到数据目录中按版本和哈希划分的目录。整包升级保留用户数据；模块更新只替换指定实例，失败时恢复原模块。

## 工程结构

```text
apps/desktop/       DeskHub 桌面宿主与现有设备页面
backend/            Rust 公共后端库、进程管理与命令行
modules/            两个设备核心、适配器及公共模块 SDK
contracts/          请求 Schema、前端 SDK、TypeScript 类型与浏览器模拟器
examples/           原生离线联调示例
scripts/            通用工程入口、签名打包和发布
tests/              跨模块、故障注入与接口测试
docs/               架构、API、前端接入、模块开发与验证
research/           逆向资料索引；设备专用资料随模块保留
artifacts/          全部生成物，不提交
.local/             本机密钥、操作锁与维护记录，不提交
```

- [前端接手指南](docs/frontend.md)
- [公共 API](docs/api.md) · [模块开发与替换](docs/modules.md)
- [更新接口与离线模拟](docs/updates.md) · [构建、签名和发布](docs/releases.md)
- [后端架构](docs/architecture.md) · [验证记录](docs/validation.md)
- [工程历史](docs/migration.md) · [逆向资料](research/README.md)
- [文件与依赖](docs/storage.md) · [开发收尾要求](AGENTS.md)

日志可通过 `diagnostics.export` 导出为一个目录，包含运行日志与设备状态摘要。错误里的 `userMessage` 用于界面提示；详细原因、请求编号、设备实例和会话代次留在日志中。

这是非官方个人项目，与设备厂商无关联。模块支持情况以各模块文档和实测记录为准。

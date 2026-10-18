# DeskHub

个人多设备控制软件的后端工程。当前接入 EDIFIER N300 音响与腹灵 OG98 键盘：统一管理设备实例，每台设备使用独立控制进程、工作队列和线程，模块可单独运行、重启、替换。

本阶段交付公共后端、设备模块、接口和离线开发环境。已有 N300 界面保存在 `apps/desktop/`，供前端继续开发；DeskHub 多设备界面尚未接入。

## 开发入口

打开 [DeskHub.code-workspace](DeskHub.code-workspace)。运行面板固定为：安装依赖、构建 Debug、构建 Release、运行 Debug、运行 Release、运行离线测试版。

基础环境：Windows x64、VS 2022 C++ 桌面开发工具与 Windows SDK、CMake 3.24+、Node.js 24+、PowerShell 5.1/7。缺少 Cargo 时，安装入口会在用户共享缓存 `%USERPROFILE%\.cache\DeskHub` 内安装固定的 Rust 1.99.1，不修改系统 PATH。npm、Cargo 与 C++ 依赖均有锁或下载哈希；共享缓存可通过 `DESKHUB_CACHE_ROOT` 指定位置。

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Test -Configuration Debug
.\scripts\project.ps1 -Action Test -Configuration Release
.\scripts\project.ps1 -Action Run -Offline
```

`Run` 当前启动后端控制台。离线控制台自动准备 `speaker` 和 `keyboard`，可输入 `list`、`read speaker audio.volume`、`write keyboard lighting.brightness 2`、`restart keyboard`、`quit`。Node 端到端示例：

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

`artifacts/package/Debug` / `Release` 中包含 `deskhub.exe`、完整模块包、接口 SDK 与文档。把整个目录复制到另一台 Windows x64 电脑即可使用，不需要 Node、Rust、原厂软件或 REA。C++ 和 Rust 均静态链接 C 运行库。

公共后端默认使用 `%LOCALAPPDATA%\DeskHub\backend\online` / `offline` 保存绑定和日志；项目脚本使用 `artifacts/data/online` / `offline`，开发数据与正常使用分开。运行时模块包复制到数据目录的按版本和哈希划分的目录，不覆盖正在使用的文件。

## 工程结构

```text
apps/desktop/       保留的 N300 前端与桌面壳，后续接入 DeskHub
backend/            Rust 公共后端库、进程管理与命令行
modules/            两个设备核心、适配器及公共模块 SDK
contracts/          请求 Schema、前端 SDK、TypeScript 类型与浏览器模拟器
examples/           原生离线联调示例
scripts/            通用工程入口
tests/              跨模块、故障注入与接口测试
docs/               架构、API、前端接入、模块开发与验证
research/           逆向资料索引；设备专用资料随模块保留
artifacts/          全部生成物，不提交
.local/             本机密钥、操作锁与维护记录，不提交
```

- [前端接手指南](docs/frontend.md)
- [公共 API](docs/api.md) · [模块开发与替换](docs/modules.md)
- [后端架构](docs/architecture.md) · [验证记录](docs/validation.md)
- [迁移与发布边界](docs/migration.md) · [逆向资料](research/README.md)
- [磁盘管理与自动清理](docs/maintenance.md)

日志可通过 `diagnostics.export` 导出为一个目录，包含运行日志与设备状态摘要。错误里的 `userMessage` 用于界面提示；详细原因、请求编号、设备实例和会话代次留在日志中。

这是非官方个人项目，与设备厂商无关联。模块支持情况以各模块文档和实测记录为准。

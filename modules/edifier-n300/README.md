# N300 桌面控制工程

Edifier N300 的非官方 Windows x64 控制台。桌面界面、设备核心、依赖锁和构建脚本在同一个 Git 仓库中。
本项目与 EDIFIER 无关联。

直接使用可下载 [GitHub Releases 安装包](https://github.com/JackDows/N300/releases/latest)。后续在应用内检查更新并覆盖升级。

- **桌面**：Tauri 2 + React + TypeScript，保留音量 / 音效 / 设置三页。
- **设备核心**：C++20 DLL 与 CLI，负责 BLE、协议、回读验证和重连。
- **连接方式**：桌面程序托管一个 n300.exe serve 进程，经 JSON-RPC 传递状态和命令。

[桌面使用说明](docs/desktop.md) · [命令行说明](docs/user-guide.md) · [C ABI / JSON-RPC API](docs/api.md) · [诊断与问题追溯](docs/diagnostics.md) · [逆向依据](docs/reverse-engineering.md)

## VS Code

打开 [N300.code-workspace](N300.code-workspace)，运行与调试面板提供固定入口：

| 动作 | 结果 |
| --- | --- |
| 安装依赖 | 配置 CMake，恢复 npm / Cargo 锁定依赖，准备固定 Rust 工具链 |
| 构建 Debug | 构建 Debug 核心和桌面程序，运行单元 / 原生离线测试 |
| 构建 Release | 构建 Release 核心和桌面程序，生成免安装目录和 NSIS 安装包 |
| 运行 Debug | 启动 Debug 桌面程序 |
| 运行 Release | 启动 Release 桌面程序 |
| 运行离线测试版 | 启动 Debug 桌面程序与原生模拟设备，不访问真实音响 |

构建和运行任务按顺序执行所需步骤。六个名称与语言无关，统一调用 scripts/project.ps1。

## 换电脑 / 从源码构建

基础环境：Windows x64、Node.js 24+ / npm、CMake 3.24+、PowerShell 5.1 或 7、
Visual Studio 2022 的“使用 C++ 的桌面开发”（含 Windows SDK）。运行桌面窗口需要 WebView2 Runtime。

未安装 Cargo 时，“安装依赖”会将 Rust 安装到项目 .local 内，不改系统 PATH；
已有 Cargo 时使用现有安装。工具链由 [rust-toolchain.toml](rust-toolchain.toml) 固定。
下载的 rustup 安装器按固定 SHA-256 校验，npm、Cargo、C++ JSON 库也分别有版本锁或哈希。
应用构建无需 APK、REA、JADX、Java 或 Python，也无需另一个源码仓库或预编译的核心文件。

克隆此仓库，然后在根目录执行：

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
.\scripts\project.ps1 -Action Run -Configuration Debug -Offline
.\scripts\project.ps1 -Action Test -Configuration Debug
.\scripts\project.ps1 -Action Build -Configuration Release
.\scripts\project.ps1 -Action Test -Configuration Release
```

首次安装和构建需要联网。默认生成：

| 路径 | 用途 |
| --- | --- |
| artifacts/desktop/Debug、Release | 完整桌面程序及各自配置的核心，运行 N300Desk.exe |
| artifacts/installers/Release | Windows NSIS 安装包 |
| artifacts/package/Debug、Release | 独立设备核心 SDK：CLI、DLL、头文件、库和接口文档 |
| artifacts/validation | 测试报告、截图和构建日志 |
| .local | 依赖、工具链和机器本地缓存，不纳入 Git |

免安装分发必须复制整个桌面目录，不能只复制 EXE。安装包会携带核心 EXE/DLL，缺少 WebView2 时安装器会下载安装。
基础编译工具不随成品分发。

## 开发

仅预览前端，在 desktop 内执行 npm run dev，浏览器使用内存示例。
桌面热更新执行根目录 scripts/dev.ps1；加 -Offline 即通过真实核心的模拟设备联调。
窗口热更新、普通桌面运行和测试均使用相同的设备接口。
桌面程序实行单实例；运行离线测试前先关闭正在运行的程序。Debug / Release / 离线版不会同时占用设备控制会话。

只构建设备核心可在通用入口加 -Component Core：

```powershell
.\scripts\project.ps1 -Action Build -Configuration Release -Component Core
.\scripts\project.ps1 -Action Run -Configuration Debug -Component Core -Offline
```

也可使用 cmake --preset windows、cmake --build --preset release 和 ctest --preset release。
JSON 库为 nlohmann/json 3.12.0，版本和下载哈希见 [CMakeLists.txt](CMakeLists.txt)。

## 工程结构

```text
desktop/               React 界面、Tauri 壳、npm/Cargo 锁、桌面测试
include/n300/          C ABI 公共头文件
src/native/            帧编解码、传输、状态机、DLL、CLI
resources/             构建时编入核心的设备设置表
examples/              App 自己管理工作线程的 C++ 示例
tests/                 原生协议/API 和 CLI/stdio 离线测试
scripts/               统一的安装、构建、运行、测试入口
docs/                  桌面、CLI、API 和逆向文档
research/              逆向输入及辅助脚本，不参与产品构建
artifacts/             全部生成物（不提交）
.local/                本地缓存（不提交）
```

前端初版的 Git 历史已导入 desktop；前后端修改可在同一提交中同步。
本机原前端检出保存在 .local/imports/n300-desktop，仅作接手时的备份，不是工程依赖。

## 验证范围

Test 会运行 C++ 协议/API/stdio 测试、前端 RPC 生命周期测试、Rust 进程托管测试，
并启动构建好的桌面 EXE，通过 WebView2 执行离线界面联调。
覆盖音量回读、失败恢复、输入、EQ、名称、灯光、定时、断开重连、核心崩溃重启和窗口关闭。
也覆盖延迟切换、错误溯源、多开唤起、未发现设备时的重试与停止、Windows 减少动画设置、更新检查及损坏安装包的拒绝。
自动测试只使用 --offline，不控制真实音响。

此前底层已在本机读取真实 N300 的固件 1.5.1、音量、输入、名称和音效；
2026-10-18 已在 AUX 输入下验证发现、连接、状态读取和音量原值写入回读；无需先切换蓝牙输入。
0.2.1 另已实测桌面切换蓝牙、切回 AUX，确认期间没有误报，保留了关联请求的诊断记录。
其他固件及其余写入功能仍需逐项实机验证。

签名、发布目录、GitHub Releases 及升级验证见[版本发布与应用内更新](docs/releases.md)。

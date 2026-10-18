# OG98 控制基础工程

腹灵 OG98 三模机械键盘的独立 Windows 控制基础层。提供 C ABI DLL、命令行与逐行 JSON 接口，直接访问 2.4G 接收器的专用 HID 控制接口。运行时不需要原厂驱动、Electron、Node.js 或网络。

当前范围：查找接收器，读取固件、当前配置、回报率、灯光、消抖、休眠、自动系统切换和部分键盘选项；修改亮度并回读确认；离线模拟、诊断日志。当前没有桌面界面，更多功能等待具体需求。

## 获取依赖与构建

开发基础环境：Windows x64、Visual Studio 2022 C++ 桌面开发工具、CMake 3.24+、PowerShell 5.1/7。打开 `OG98.code-workspace`，安装推荐的 VS Code 扩展。

运行和调试面板使用固定入口：**安装依赖、构建 Debug、构建 Release、运行 Debug、运行 Release、运行离线测试版**。同样可从项目根目录执行：

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
.\scripts\project.ps1 -Action Build -Configuration Release
.\scripts\project.ps1 -Action Run -Configuration Debug -Offline
```

`Install` 检查工具链并通过 CMake 下载 nlohmann/json **3.12.0**，校验固定 SHA-256，缓存在 `.local/dependencies/`。`Build` 编译、运行离线测试并生成 `artifacts/package/Debug` 或 `Release`。首次安装依赖需要网络，之后已有缓存即可离线构建。没有依赖相邻的 N300、REA 或本机原厂安装目录。

编译结果在 `artifacts/dist/<配置>/`。可把 `artifacts/package/Release/` 整个目录复制到另一台 Windows x64 电脑运行；C++ 运行库静态链接。调试配置用于构建调试符号，现有 VS Code 入口运行工作流脚本；要逐步调试 C++ 可另附加原生调试器。

## 使用基础功能

退出原厂软件及其后台服务，接上 OG98 的 2.4G 接收器，轻按键盘唤醒。无需改键盘连接模式。

```powershell
$og98 = '.\artifacts\dist\Release\og98.exe'
& $og98 scan
& $og98 --model OG98 status
& $og98 --model OG98 get lighting
& $og98 --model OG98 brightness 3
& $og98 --offline shell
```

亮度范围 0–4。设置前先读取当前灯效，保留模式、速度、选项与颜色；设置只发送一次，随后读取确认。`shell` 提供 `connect`、`status`、`get lighting`、`brightness 3`、`disconnect`、`quit`。离线版仅修改模拟数据。

硬件 VID/PID 被多个型号共用，因此扫描结果是候选设备，真实连接要求明确选择 `--model OG98`。存在多个候选时，用 `--device` 指定 `scan` 返回的路径。本版已针对本机 OG98 的 **2.4G** 通路实现；有线、蓝牙及其他型号不在当前支持范围。

接收器在线时，键盘仍可能休眠。超时提示只表示暂未收到应答，轻按按键再重试；不会自动修改休眠设置。原厂程序同时占用控制接口时，请退出后再连接。

## 日志与工程记录

VS Code/脚本运行的日志在 `artifacts/logs/`；直接运行 EXE 默认在 `%LOCALAPPDATA%\FlesportsOG98\logs\`。文件名带进程 ID，每个文件达到 2 MiB 后轮换，最多保留该进程的三个备份。可用 `--log 路径` 指定位置；把出问题那次的 `.jsonl` 和同名前缀的备份打包，即可定位 API 请求、HID 包、回读与错误。`--no-log` 关闭文件日志。

日志保留工程细节，API 的 `error.userMessage` 是给未来界面使用的简短提示。日志包含设备路径及设置，不读取普通键盘输入报告。

- [API 与接入](docs/api.md)
- [协议与证据](docs/protocol.md)
- [验证记录及限制](docs/validation.md)
- [后续本地功能清单](docs/features.md)
- [原厂产物复查](research/README.md)

这是个人开发的非官方项目，与腹灵 / F·L ESPORTS 无关联。仓库只保存自主实现、构建入口和证据索引，原厂二进制及提取代码不纳入版本控制。

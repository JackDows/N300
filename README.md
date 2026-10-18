# N300 device core

用于 Edifier N300 的非官方 Windows x64 设备控制底层，C++20 实现，无图形界面。

- `n300.dll`：供自研设备管理 App 集成的 C ABI；会话、工作线程和启停由 App 管理。
- `n300.exe`：使用同一 DLL 的控制台程序，支持单条命令、交互式命令行、JSON-RPC stdio。
- 运行不需要 Python、Node.js、Qt 或额外安装 VC 运行库；保留 EXE 同目录的 DLL。

支持设备发现、连接、功能查询、音量、输入、音效、自定义 EQ 增益、灯光、
无信号自动关机、定时关机、改名、固件信息和关机。支持范围按设备实际回复确定。
协议依据见 [逆向记录](docs/reverse-engineering.md)。

## 使用

构建后的分发目录为 `artifacts/package/Release`。

```powershell
cd artifacts/package/Release
.\n300.exe --offline status --full
.\n300.exe scan
.\n300.exe status
.\n300.exe volume 8
.\n300.exe preset music
.\n300.exe shell
.\n300.exe benchmark                 # 分别测初次连接和同一连接上三次读取
```

`shell` 保持连接，可连续输入 `volume`、`volume 8`、`input aux`、`eq`、`exit`。
无参数启动也进入 shell。`--offline` 使用内存模拟音响，不访问蓝牙。
详细命令、自动连接策略与错误说明见 [命令行使用说明](docs/user-guide.md)。

## 接入自研 App

App 通过 [n300.h](include/n300/n300.h) 调用 DLL，完整约定见 [API 文档](docs/api.md)。

```text
你的设备管理 App
  └─ 每台设备的会话 / 命令队列 / 工作线程
       └─ n300.dll（C ABI，协议与状态机，Windows BLE）

n300.exe（CLI / stdio）也调用同一个 n300.dll
```

DLL 不创建工作线程、界面或子进程，不写缓存文件。App 决定如何调度、保存设备选择、
分发事件和释放会话。使用 `start` 后，在 App 的工作线程中定期调用 `n300_tick`，
实现自动连接和断线重连；`stop` 停止重连并断开，`n300_cancel` 可从其他线程取消等待。

[C++ 工作线程示例](examples/cpp_host.cpp) 随工程编译和离线验证。
Qt 可直接使用 C 头文件；C# 可用 P/Invoke。若以后需要隔离故障或采用其他语言，
也可由 App 启动 `n300.exe serve`，通过 JSON-RPC 调用同样的功能。

## 通用工程入口

打开 [N300.code-workspace](N300.code-workspace)。VS Code 保留固定的六个启动项：

| 动作 | 本工程实现 |
| --- | --- |
| 安装依赖 | 检查 C++ 工具链，获取固定版本依赖，生成 CMake 工程 |
| 构建 Debug | 编译带调试信息的 DLL/EXE，运行离线测试，整理分发目录 |
| 构建 Release | 编译优化版本，运行离线测试，整理分发目录 |
| 运行 Debug | 运行 Debug 命令行，开启诊断输出 |
| 运行 Release | 运行 Release 命令行 |
| 运行离线测试版 | 运行 Debug 命令行和模拟设备，不访问蓝牙 |

启动项与任务调用 `scripts/project.ps1` 的 Install / Build / Run / Test。
PowerShell 脚本仅用于开发构建流程，正式运行入口为 EXE 或 DLL。

## 从源码构建 / 换电脑

基础环境：Windows x64、Visual Studio 2022 的“使用 C++ 的桌面开发”（含 Windows SDK）、
CMake 3.24+、PowerShell 5.1/7。无需复制 `.venv`、旧 Python 程序或本机编译缓存。

唯一第三方编译依赖为 `nlohmann/json 3.12.0`，由 CMake 下载；URL、版本和 SHA-256
固定在 [CMakeLists.txt](CMakeLists.txt)，下载与生成文件放在被 Git 忽略的 `.local/dependencies`。
首次配置需要联网，以后可复用缓存。应用编译不需要官方 APK、REA、JADX、Java 或 Python。

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Debug
.\scripts\project.ps1 -Action Build -Configuration Release
.\scripts\project.ps1 -Action Run -Configuration Debug -Offline
.\scripts\project.ps1 -Action Test -Configuration Release
```

也可直接调用标准 CMake：

```powershell
cmake --preset windows
cmake --build --preset release --parallel 4
ctest --preset release --output-on-failure
cmake --install artifacts/build/native --config Release --prefix artifacts/package/Release
```

复制 `artifacts/package/Release` 即可分发。集成 App 时使用其中的 DLL、`include` 和 `lib`；
分发目录包含接口文档和第三方许可证。Debug/Release 生成物分开保存。

## 工程层级

```text
include/n300/       对外 C ABI 头文件
src/native/         帧编解码、BLE/离线传输、会话、C ABI、CLI
resources/          从官方 App 核对的设置表，构建时编入 DLL
examples/           App 自己管理工作线程的调用示例
tests/              原生协议/API 测试与 CLI/stdio 集成测试
cmake/              构建时资源模板
scripts/            通用工程动作的实现
docs/               使用、API、协议来源
research/           逆向资料获取和辅助脚本，不参与产品构建
artifacts/build/    CMake 中间产物（不提交）
artifacts/dist/     编译输出（不提交）
artifacts/package/  可分发目录（不提交）
artifacts/validation/ 验证日志（不提交）
.local/            本地依赖缓存和临时数据（不提交）
```

本项目独立使用 Git。另一台电脑克隆仓库后执行 Install 和 Build 即可；也可以用
`git bundle create n300.bundle --all` 导出已有提交，再在目标机器克隆 bundle。
原始 APK、反编译资料和生成物不纳入 Git；继续逆向时参考 [研究目录说明](research/README.md)。

## 验证范围

离线测试覆盖协议字节向量、分包/校验、回读验证、缓存目标、会话隔离、取消等待、
启停重连、JSON-RPC 错误与 EOF 清理。离线模拟不能证明实际音响固件接受每一条命令。
原生版已在用户 Windows 会话中连接真实 N300，读取固件 1.5.1、音量、名称、输入和音效。
优化后的实机记录：发现 1132 ms、连接与握手 2599 ms；同一连接连续读取音量为 23/29/30 ms。
再次启动使用已保存目标，扫描为 0 ms、连接 1706 ms；音量原值写入并回读为 89 ms，后续读取 30 ms。
源码在不含原构建缓存、路径含空格的副本中完成依赖下载、Release 构建和全部离线测试。
在 AUX 播放时能否保持 BLE 控制，仍需针对本机固件验证。

# EDIFIER N300 设备模块

DeskHub 的 N300 适配器与 C++ 原生核心，提供音量、输入源、音效、EQ 与设备设置。模块通过 BLE 控制，音响保持 AUX 或 USB 输入时也可控制。具体能力以设备固件回报为准。

从 DeskHub 仓库根目录执行：

```powershell
.\scripts\project.ps1 -Action Install -Module edifier-n300
.\scripts\project.ps1 -Action Build -Module edifier-n300 -Configuration Release
.\scripts\project.ps1 -Action Run -Module edifier-n300 -Configuration Release -Offline
```

产物位于 `artifacts/package/Release/modules/edifier-n300/<版本>/`。整个模块包可以独立运行，也可由 DeskHub 托管。`module.json` 声明身份、协议版本、入口与文件校验值；`module.build.json` 声明构建输出。

- `adapter.cpp`：公共模块协议与 N300 能力映射。
- `src/native/`、`include/n300/`：原生 DLL、协议、传输、会话及独立诊断 CLI。
- `resources/`：设备设置表，构建时编入核心。
- `tests/`：协议、C ABI 与原生离线测试。
- `research/`：原始输入与逆向证据，不参与产品构建。

[DeskHub 工程入口](../../README.md) · [公共 API](../../docs/api.md) · [模块下载安装与更新](../../docs/updates.md)

[原生 C ABI / JSON-RPC](docs/api.md) · [诊断 CLI](docs/user-guide.md) · [协议依据](docs/reverse-engineering.md)

这是非官方个人项目，与 EDIFIER 无关联。

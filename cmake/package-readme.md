# OG98 控制基础层 0.1.0

Windows x64。把本目录整体复制即可运行，`og98.exe` 与 `og98.dll` 放在一起；无需原厂后台或 Node.js。当前是供后续应用接入的基础层，没有桌面界面。

```powershell
.\og98.exe --offline shell
.\og98.exe scan
.\og98.exe --model OG98 status
.\og98.exe --model OG98 brightness 3
```

真实设备使用 OG98 的 2.4G 接收器，退出原厂控制程序，轻按键盘唤醒。亮度范围 0–4，设置后自动回读。当前型号需要调用者确认，有线与蓝牙通路未实现。

默认日志：`%LOCALAPPDATA%\FlesportsOG98\logs\`。出问题时打包当次 `core-进程号.jsonl` 和同名备份。

- [DLL 与标准输入输出 API](docs/api.md)
- [已完成的验证与限制](docs/validation.md)
- [协议证据](docs/protocol.md)
- [后续本地功能清单](docs/features.md)

库头文件在 `include/`，链接库在 `lib/`，第三方许可在 `licenses/`。源码工程的 `scripts/project.ps1` 提供依赖安装、Debug/Release 构建、测试和运行入口。

非官方项目，与腹灵 / F·L ESPORTS 无关联。

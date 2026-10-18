# N300 native SDK 0.3.0

Windows x64 原生设备控制库和命令行工具。运行时无需 Python、Node.js、Qt 或额外安装 VC 运行库。

- `n300.exe`：直接运行的控制台程序；保持 `n300.dll` 在同一目录。
- `n300.dll`、`include/n300/n300.h`、`lib/n300.lib`：供自研 App 集成的 C ABI。
- `examples/cpp_host.cpp`：App 自己创建工作线程并调用库的示例。
- `licenses/`：第三方许可。

```powershell
.\n300.exe --offline status --full
.\n300.exe scan
.\n300.exe status
.\n300.exe shell
```

参阅 [命令行说明](docs/user-guide.md) 和 [API 文档](docs/api.md)。
设备实际支持的输入、音效、音量范围与 EQ 格式由设备回复决定。

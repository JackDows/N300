# 原厂产物复查

研究脚本不参与基础库的编译或运行。需要 Node.js 22+ 的内置 WebSocket/fetch，原厂 F. L Driver 2.1.101，以及可选 REA/Frida 工具。生产工程只依赖 CMake 中固定版本的 nlohmann/json。

`official-manifest.json` 保存从原厂 `resources/app` 复制的文件名、长度和 SHA-256。将同一版本文件放到 `research/inputs/official/`，先执行：

```powershell
node research/verify-inputs.mjs
```

原厂程序以 `--remote-debugging-port=19381` 启动后，使用下面的顺序获取本机运行证据。脚本只连接回环地址；研究完成后正常退出原厂程序，调试端口随之关闭。

```powershell
node research/inspect-page.mjs
node research/inspect-runtime.mjs
node research/extract-device-runtime.mjs
```

`inspect-runtime` 在对应版本的初始化位置加临时断点，刷新页面，向该页面暴露只用于调试的控制器引用，然后恢复执行；`extract-device-runtime` 读取实际选择的设备及其原型链。它们不修改安装文件。刷新会重新触发原厂自身初始化，包括它自己的设备访问，不适合与独立控制程序同时运行。

采集结果写在 `artifacts/analysis/`。提取代码属于研究输入，不得作为实现代码复制提交。研究工具生成的完整记录保留本地；简洁的哈希、函数偏移、证据 ID 与解释在 [协议文档](../docs/protocol.md)。

REA 静态图的部分路径因内存预算未覆盖；native 后台未做完整反编译。当前通信结论来自实际 OG98 控制器代码定位、原厂运行时 feature 报文和独立硬件往返验证。

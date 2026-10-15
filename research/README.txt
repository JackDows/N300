逆向资料与复现

本目录用于解释和扩展控制协议，不参与应用的正常安装、测试和编译。
sources.json 随 Git 提交，记录官方输入文件的来源、文件大小和 SHA-256。
inputs 与 evidence 保留本机资料，不纳入源码仓库。
PDF/二维码分析的额外 Python 依赖只在需要时安装：
  .\.venv\Scripts\python.exe -m pip install -r research/requirements.lock.txt

下载原始资料
在项目根目录执行（需要基础环境 Node.js）：
  node research/scripts/fetch-inputs.mjs
该脚本只下载 sources.json 中列出的官方资料，并检查 SHA-256。
已经存在且校验相符的文件不会重复下载。

继续静态分析
需要自行安装 Java 17+ 和 JADX。当前工作区的公共工具位于
../../tools/toolchain/jadx/jadx-headless-mcp-0.7.1-all.jar。
DecompileSelected.java 接受 APK 路径、输出目录和类名；
ExportResources.java 接受 APK 路径和输出目录。
工具本身不执行 APK 内的代码。

REA 会话脚本需要 REA 源码及其已安装的 npm 依赖。
默认查找 ../../tools/rea；如果项目单独放在其他位置，可以设置环境变量
REA_ROOT 指向 REA 仓库，并将 Codex config.toml 路径作为首个参数传入
research/scripts/rea-session.mjs。环境配置属于分析工具，不影响应用编译。

资料路径
  inputs/edifier-connect-8.5.3.apk       官方 Android App
  inputs/n300-manual.pdf               官方说明书
  evidence/jadx-source/                定向反编译源码
  evidence/rea-evidence-bundle.json     原始 REA 会话证据
  evidence/n300-product-config.json    从 App 配置提取的设备信息
  scripts/extract_catalog.py           从反编译源码生成应用菜单资源

证据保留
原始 REA 证据中的绝对路径对应分析时的位置，目录整理后仍按原样保存，
避免改动证据内容与摘要。判断目标文件身份请使用 sources.json 的 SHA-256。
GUI 预览图在 ../docs/preview.png；当前测试和构建结果在 ../artifacts/validation。

人工实测
probe_bluetooth.py 和 probe_classic.py 会进行真实蓝牙扫描。
它们不会由 setup、test 或 build 自动调用。

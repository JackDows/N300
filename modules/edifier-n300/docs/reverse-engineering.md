# N300 控制协议：逆向与实现记录

日期：2026-10-15

## 交付

artifacts/package/Release/n300.dll 与 n300.exe：原生 Windows x64 设备核心和命令行。
`n300.exe --offline` 使用协议模拟设备，不操作蓝牙。
[使用说明](user-guide.md)：操作步骤、当前支持范围和实机验证步骤。
src/native/：协议、BLE 传输、会话、C ABI 和 CLI；resources/ 保存菜单资源。

## 当前结论

已从官方 Android App 恢复 N300 的 BLE 服务配置和控制命令，并实现可运行
的 Windows 首版控制工具。软件包含音量、输入、音效、自定义 EQ 增益、
指示灯、自动关机、定时关机、改名、固件信息与关机入口。

原生版已在用户 Windows 会话中连接真实 N300，并成功读取常用状态。
2026-10-18 已在 AUX 输入下完成 BLE 扫描、状态读取、音量原值写入及回读；无需先切换到蓝牙输入。
真实固件对其余各指令的接受情况仍需逐项核对。
离线测试不能证明已经完整替代手机 App。

## 官方来源

- [产品支持页](https://www.edifier.com/cn/product/support-727.html)
- [说明书](https://cn-oss.edifier.com/Uploads/images/2024/05/13/2024051313484517155793255005.pdf)
- [官方二维码落地页](https://admin-app.edifier.com/edifier_provider/public/appDownload?appTag=EdifierConnect)
- [版本接口](https://admin-app.edifier.com/home/api/v1/apps?tag=EdifierConnect)
- [APK](https://edifier-provider-oss.edifier.com/apk/20261010/EC_v8.5.3_300-jiagu_1791626658.apk)

## 下载的 App

EDIFIER Connect 8.5.3，build 300，官方版本记录日期 2026-10-10。
包名 com.edifier.edifierconnect；文件 294,968,680 字节。
SHA-256：346270d7a8d924a204f96f4cb011f9b4819df79fc609454cd651470d75571229
仅进行了静态解包、反编译和配置解码，没有安装或运行 APK。

## 控制依据

assets/products_release.json 经 App 自身配置解码逻辑还原后包含已发布的
N300（id 363）条目：
  广播 UUID  00007e00-0000-1000-8000-00805f9b34fb
  服务 UUID  48097e01-1a48-11e9-ab14-d663bd873d93
  通知 UUID  48090001-1a48-11e9-ab14-d663bd873d93
  写入 UUID  48090002-1a48-11e9-ab14-d663bd873d93
  ProductSPPUuid 为空，App 使用 BLE 控制通道。
配置中另有尚未发布的 N300-26版记录（id 607）。软件识别该服务地址，
但未据此宣称支持该型号的真实硬件。

协议来自 CommandBean、CommandManager、CommandParser、BLEManager。
V1：AA | 长度 | 命令 | 载荷 | (前面字节之和 + 0x2019) 的两字节校验。
V2：AA | EC | 命令 | 两字节长度 | 载荷 | 一字节累加校验。
支持广播声明的明文和 XOR 0xA5 载荷，不对未知协议或握手方式猜测回退。
控制服务和读写特征均匹配后，先查询 D8 功能信息；具体设置按命令读取。

## App 中核对的菜单

CommandParserHelper 输入分组 5：1 蓝牙、2 AUX、3 USB。
本机输入分组 15：1 蓝牙、2 USB 声卡、3 AUX。类型来自 InputSourceType，USB 与 USB 声卡不能混用。
EQ 分组 19：0 音乐、1 监听、2 游戏、3 电影、4 自定义。
本机已确认 EQ 分组 19；61 回复 `0f01` 确认输入分组 15，当前蓝牙。
程序按回复选择分组，不预先假定所有 N300 固件都返回以上数值。

## EQ 依据

EqSelfViewModel 负责频段布局，GainSbAdapter 负责增益单位，
CommandManager.setSingleCustomEq 负责写入格式；对应 XML 确认滑块步进。
已适配格式 1、2、3、17、18，编辑增益时保留现有频率和 Q。
未确认的布局只记录原始回复。频率/Q 编辑、云端 EQ 分享、固件升级、
恢复出厂和额外校准流程尚未实现。

## 验证记录

tests/native_tests.cpp 保存按官方代码计算的固定字节向量、全部分包边界、
损坏校验恢复、两版协议的模拟 GATT 读写、范围限制、回读不一致、UTF-8 名称限制、
EQ 参数保留、会话隔离、启停、取消和断线不重放写入等验证。
tests/test-stdio.ps1 验证实际 EXE 的 JSON-RPC 接口。
examples/cpp_host.cpp 验证由 App 自己创建工作线程调用 DLL 的生命周期。
最新构建和 CTest 结果保存在 artifacts/validation/tests-Debug.log、tests-Release.log。

2026-10-15，用户运行原生 Release 的 `--no-cache status`：总计 8310 ms，
扫描 5022 ms，连接与能力握手 2805 ms。设备声明协议 V2、无加密，固件 1.5.1，
音量范围 0–16、当前 5，音效为监听，EQ 分组 19。
该结果是单次冷启动，不能据此判断连接后每条操作的耗时。`benchmark` 分别测量两者。
旧菜单提取会排除含 USB 声卡等类型的整个输入分组，已按官方类型表补全；
实际菜单使用固件回复的分组，不按型号猜测。

同日更新后，用户运行 `benchmark` 的真实结果：

| 阶段 | 耗时 |
| --- | --- |
| 初次发现 | 1132 ms，提前结束扫描 |
| Windows 打开设备、服务发现、通知订阅 | 2569 ms |
| D8 能力握手 | 30 ms |
| 连续三次音量查询 | 23 / 29 / 30 ms |
| 输入查询 | 30 ms |

该进程共一次扫描、一次成功连接、一次 D8 握手，校验错误为 0；
初次 connect 调用共 3739 ms（包括扫描及 CLI 缓存写入等），整个只读测速 3852 ms。
音量查询均真实发送 66 并等待回复，不以本地缓存模拟快速响应。

随后用户在同一 shell 中执行 `volume`、`volume 5`、`volume`、`diagnostics`：
缓存目标直接连接，扫描次数 0、连接次数 1；首次连接 1706 ms（GATT 1660 ms、握手 45 ms），
含第一次读取共 1736 ms。把音量原值 5 写回并回读确认用时 89 ms，下一次查询 30 ms。
实际命令序列为 D8、66、67(05)、66、66，表明写入和后续读取未重复握手；校验错误为 0。
该测试确认音量设置命令的响应和回读，不代表已经逐项实测其他写入功能。

Debug 与 Release 的 5 组 CTest 均通过，包括 31 项原生用例、离线状态、测速、
App 工作线程和 stdio 集成。另在只复制源码且路径含空格的新目录中，
从固定 URL 下载依赖并完成 Release 构建、测试和分发，不依赖原目录的 Python 环境或产物。

## 工具和复现

REA 6.5.0 已接入 Codex。本次使用 REA/JADX 读取 APK 类、方法和引用。
research\evidence\rea-evidence-bundle.json 保存本次 REA 会话 32 条证据记录。
补充的定向 JADX 源码导出在 research\evidence\jadx-source，脚本为 research/scripts/DecompileSelected.java。
research/scripts/extract_catalog.py 从已导出的方法常量生成菜单表，并保留 EQ 提取审计结果。
scripts/build.ps1 执行 CMake 编译、CTest 和分发目录整理。
CMakeLists.txt 固定 nlohmann/json 的版本、来源与校验值，Windows 蓝牙由系统 SDK 提供。
研究脚本使用的 Python/Node/Java 不参与产品构建和运行。

## 下一次实机核对

在用户方便时释放手机占用并使 N300 可发现，连接后导出 D8、61、66、D5、43。
本机固件 1.5.1 的 AUX 模式已验证扫描、连接与音量原值写入回读；本次验证没有改变输入或播放音量。
`artifacts/validation/ble-aux-write-readback.json` 保存该次会话证据。后续继续逐项核对其余设置。
上述结果将决定是否还需适配固件差异，以及能否实现日常只用电脑控制。

# OG98 2.4G 协议与证据

## 分析对象

原厂 F. L Driver **2.1.101**，Electron **22.3.15**。原厂本地 Rust 后台自报版本 **222**，监听 `127.0.0.1:3814` 的 gRPC-Web；独立实现没有调用这个服务。

原厂识别本机设备为 `yc3121_k249_soc` / **OG98**，接收器模型 ID `-2147485011`，对应基础型号编号 1363。USB 控制接口为 VID `3151`、PID `4011`、UsagePage `FFFF`、Usage `0002`、FeatureReportByteLength 65。有线模型表条目为 PID `4015`，但未做有线实测。

VID/PID 被多个键盘型号共用。独立程序目前不能从原始 USB 报文自行读取该模型 ID，所以只枚举候选，并要求调用方明确选择 OG98。一次 `F1` 探索读取仅拿到状态/旧数据，**没有证明它是型号查询命令**；不纳入生产协议。

## 报文

以下偏移都以去掉 Report ID 后的 64 字节 payload 为准。

- SetFeature：67 字节，Report ID=0，后接 64 字节 payload，再接两个零。该长度来自原厂实际调用与独立实测；不要只根据 HID caps 的 65 推断发送长度。
- GetFeature：65 字节缓冲区，Report ID=0，payload 从返回缓冲区下标 1 开始。
- BIT7：payload[7] = `255 - (sum(payload[0..6]) & 255)`。
- BIT8：payload[8] = `255 - (sum(payload[0..7]) & 255)`。灯光写入使用 BIT8，不能覆盖 payload[7] 的蓝色值。
- 接收器 F7、FC 请求不附加上述校验。

2.4G 读取过程：发送查询一次，等待，发送 F7，GetFeature 读状态。**返回缓冲区下标 1** 非零才表示可取回复；下标 2 可能是电量 100，休眠时也有值，不能当就绪位。就绪后发 FC，再 GetFeature，检查返回 opcode 与查询一致。遇到旧回复继续等待，不接受错配的数据。

独立实现使用 30 ms + 20 ms 的状态轮询间隔，FC 后等待 20 ms；最多 50 轮。该间隔已在本机验证，没有据此宣称适用于所有固件或电脑。

| 设置 | 读 / 写 opcode | 数据位置 | 本版开放 |
| --- | --- | --- | --- |
| 固件 | 80 / — | LE16 [1..2] | 读 |
| 当前配置 | 85 / 05 | [1] | 读 |
| 回报率 | 84 / 04 | [1] 配置编号；[2] 1/2/4/8 对应 1000/500/250/125 Hz | 读 |
| 键盘选项 | 86 / 06 | [1] 配置编号；[2..4] 标志 | 读部分含义并保留 raw |
| 灯光 | 87 / 07 | [1] 模式，[2] 原始速度，[3] 亮度，[4] 选项，[5..7] RGB | 读；只写亮度 |
| 消抖 | 91 / 11 | [2] | 读 |
| 休眠 | 92 / 12 | 读 LE16 位于 [1],[3],[5],[7]；写位置从 [8] 开始 | 读 |
| 自动系统 | 97 / 17 | [1] | 读 |

表中 opcode 为十六进制。未开放的写命令仅是原厂代码中的证据，不是独立工程已验证的能力。

灯光模式 13 为自定义图片；[4] 高半字节 +1 为槽位，OG98 界面提供三个槽。实测槽位 2、亮度 4，原始参数为 `87 0D 04 04 10 00 C8 C8`。亮度写入仅改 opcode 和亮度，保留其余七字节中的其他字段，校验按 BIT8 重算。

键盘选项的原厂 getter 用 bit1 解释系统类型，setter 却左移 2 位，两者不一致。没有依此实现系统切换写入，也没有把未经确认的系统类型作为 API 结论。

## 溯源

原始文件 SHA-256 见 [official-manifest.json](../research/official-manifest.json)。关键文件：

- renderer `main_36623ada.js`：`8c604678512d5fa9c0a1a62e7d687e60c16200d0f16f41d6551500251299762e`
- backend `iot_driver.exe`：`7e56bc75152450a454c874f6e0eb1d1cc09bf65e00db002021c4b14b70430583`

| 证据 | 内容 |
| --- | --- |
| `ev_859a5eb7d41e7f74fa824e52f70cda79a31fa44fa60576881555cc8ad52925cf` | REA renderer 静态摘要；886 个模块；语义图因预算不足被舍弃，不能声称全量数据流覆盖 |
| `ev_342d419b2a231e782ea5acf6096ce1d96cfd757763a673cbcdf3685887642388` | 原厂 Electron 运行页观察，加载脚本与静态文件哈希对应 |
| `ev_7d2799e301134fc359ea0094c58fad0e643a7f1554dbba3576e3d3aeadf4f889` | Frida 捕获原厂 HidD_SetFeature：67 字节发送、80/87/91 查询、F7/FC |
| `ev_6099e567076510ac27382fc85f342c7d1aa6cd03c772057215f7a4024fe792fa` | Frida 捕获 NtDeviceIoControlFile 的 HID GetFeature，应答长度与状态位置 |
| `artifacts/analysis/device-runtime.json` | CDP 提取实际 OG98 控制器、原型链、型号元数据和本地功能 store；本地忽略文件 |
| `artifacts/analysis/basic-read-baseline.json` | 原厂 getter 的实际值与耗时；只能说明这些查询的耗时，不能作为整套程序卡顿根因的证明 |
| `artifacts/analysis/hardware-validation.json` | 独立原生程序读取、亮度往返、恢复后状态比对 |

控制器在原始 renderer 的 JavaScript 字符偏移：OG98 构造器 **11558508**，扩展键位/自动系统层 **9995724**，当前灯光/选项/消抖/休眠层 **7744252**，基础 HID 封装 **7567977**。这是 JS 字符偏移，不是 UTF-8 字节偏移；仅对上述哈希有效。完整原型映射在本地 `controller-source-index.json`。

完整 REA 证据保存在本地 `artifacts/analysis/rea-evidence.json`。原厂文件、提取代码和完整运行记录不提交 Git；仓库保留哈希、证据 ID、定位信息及自主实现。跨电脑复现可按清单重新读取原厂产物，或复制本地证据目录。

Windows 接口语义参考 [Microsoft HidD_GetFeature 文档](https://learn.microsoft.com/zh-cn/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getfeature) 和 [IOCTL_HID_GET_FEATURE 文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidclass/ni-hidclass-ioctl_hid_get_feature)。设备私有 opcode、校验和接收器轮询逻辑来自上述原厂产物与实测。

# 逆向资料索引

协议资料按设备保留，应用构建不需要 REA、原厂 APK/EXE 或反编译输出。

- N300：[研究入口](../modules/edifier-n300/research/README.md)、[协议依据](../modules/edifier-n300/docs/reverse-engineering.md)。
- G HUB：[模块说明](../modules/logitech-ghub/README.md)、[协议依据](../modules/logitech-ghub/docs/protocol.md)。
- OG98：[研究入口](../modules/flesports-og98/research/README.md)、[协议与证据 ID](../modules/flesports-og98/docs/protocol.md)、[本地功能清单](../modules/flesports-og98/docs/features.md)。

Git 保存源码、依赖锁、产物哈希、证据索引、测试和验证结论。原厂输入、完整 REA 记录和抓包迁入各模块的 `research/inputs/`、`research/evidence/`，不进入 Git，也不参加生成物清理。换电脑构建只需要本仓库；复查逆向过程时复制这些证据目录，或按研究清单取得对应输入。

OG98 原始分析记录：`modules/flesports-og98/research/evidence/2026-10-18/`。N300 历史验收记录：`modules/edifier-n300/research/evidence/migration-0.2.1/`；最后已发布安装包与签名：`research/evidence/releases/0.2.1/`（相对 N300 模块）。

G HUB 原厂输入保留在 `research/inputs/ghub-2026.6.981214/`，精简实测记录在 `research/evidence/ghub-2026-10-19/`。构建不需要这些文件；在线控制需要本机 G HUB 后台。

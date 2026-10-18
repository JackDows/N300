# 磁盘管理

Git 只保存源码、依赖锁、配置和文档。工具链和依赖下载放共享缓存；构建中间文件、测试副本、截图和发布输出放忽略目录。长期协议证据放各模块 `research/`，不混在可清理的测试缓存中。

`maintenance.json` 声明清理规则，`scripts/maintenance.ps1` 执行。安装依赖、构建、运行、测试前都会检查规则；正常 Git 工作副本执行“安装依赖”时注册当前用户的每日 03:30 清理任务，错过时间会在下次可执行时补跑。任务使用当前用户权限，后台运行。CI 可设置 `DESKHUB_SKIP_SCHEDULE=1` 禁用任务注册，工程入口的清理检查仍生效。

| 内容 | 保留规则 |
| --- | --- |
| Rust/Cargo/npm 缓存 | 每用户一份，默认 `%USERPROFILE%\.cache\DeskHub`；可用 `DESKHUB_CACHE_ROOT` 调整 |
| 构建中间文件、模块分发副本 | 闲置 7 天或合计超过 2 GiB 时回收；下次按依赖锁重建 |
| Debug/Release 联调副本、清理测试副本 | 各最多 2 次，最长 7 天 |
| 临时源码复现目录、WebView 测试缓存 | 1 天 |
| 临时截图 | 最多 10 份，最长 7 天 |
| 旧桌面安装包/更新输出 | 14 天，数量另受规则限制 |
| 运行时模块旧版本 | 后端未运行时，保留最近 2 份及绑定仍引用的包；其余至少留 7 天 |
| 运行日志 | 单文件 2 MiB 轮换、3 份备份；过期设备会话日志另按数量和 7 天期限回收 |
| 当前可运行包 | 根目录 `artifacts/package/Debug`、`Release` 保留，不自动删除 |
| 设备配置、私钥、源码、Git 历史、协议证据 | 不参与清理 |

共享缓存保留可复用依赖，不在每次清理时反复下载。后端包不携带构建工具、符号、中间库或测试模块。原桌面壳仅构建使用到的 Rust 库类型，避免额外生成体积很大的静态库。

## 手动操作

```powershell
# 只查看当前规则将清理什么
.\scripts\maintenance.ps1 -Action Inspect

# 清理构建中间文件并执行留存规则；保留当前可运行包
.\scripts\project.ps1 -Action Clean

# 仅清理过期内容，同时检查本机正常使用的数据目录
.\scripts\maintenance.ps1 -Action Clean -IncludeUserData

# 重新注册当前工作副本的每日清理任务
.\scripts\maintenance.ps1 -Action RegisterSchedule
```

VS Code 任务面板也提供 `clean`，六个通用运行入口不变。最近清理结果在 `.local/maintenance-last.json`，记录删除路径、原因、字节数及跳过原因。

清理与通用构建/安装/测试共用操作锁；运行中的后端数据目录也有独立锁。正在运行的程序文件会跳过。删除前校验完整路径、允许目录和链接，拒绝跟随符号链接或目录联接删除外部文件。保护测试随 `-Action Test` 执行。

正常使用数据位于 `%LOCALAPPDATA%\DeskHub\backend\online|offline`；开发数据在 `artifacts/data/online|offline`。绑定配置永远保留，只有未使用的模块副本和过期日志进入运行时清理。自定义 `--data-dir` 不由工程清理脚本猜测或扫描。

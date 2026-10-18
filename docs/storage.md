# 文件与依赖

源码、依赖锁和工程文档进入 Git。每次功能开发或 bug 修复结束，由开发者按 [AGENTS.md](../AGENTS.md) 手动检查和清理生成物。

| 目录 | 用途 |
| --- | --- |
| `artifacts/package/Debug`、`Release` | 当前可运行的后端和设备模块包 |
| `artifacts/build`、模块的 `artifacts/build` / `dist` | 可重新生成的编译中间文件 |
| `artifacts/validation` | 测试记录和临时联调副本；收尾时保留必要日志，删除临时副本 |
| `.local` | 本机操作锁、迁移核对记录、私钥及未共享的工具依赖 |
| 各模块 `research/inputs`、`research/evidence` | 原厂输入和协议证据，长期保留，不作为临时缓存删除 |

工具依赖默认安装在工程 `.local/dependencies/tools`。同一工作区可通过本机忽略文件 `.local/cache-root.txt` 指定共享位置；相对路径以工程根目录为基准，也可在当前进程设置 `DESKHUB_CACHE_ROOT`。本工作区使用 `../../tools/cache/deskhub`，供 Rust、Cargo 和 npm 复用。新电脑没有该文件时按默认路径恢复，不依赖当前电脑的绝对路径。

生成目录被 Git 忽略不代表它们已经清理。手动删除前检查是否仍被运行程序使用，以及所需产物、诊断记录和研究证据是否已保留。应用自身已有的日志轮换和更新包清理属于应用行为；工程生成物由开发收尾检查处理。

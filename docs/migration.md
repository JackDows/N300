# 工程历史

DeskHub 整合 N300 与 OG98 的源码和 Git 历史。N300 原生核心位于 `modules/edifier-n300`，OG98 位于 `modules/flesports-og98`，桌面宿主与前端位于 `apps/desktop`。根目录是统一开发、构建、测试和发布入口。

迁移起点 N300 `a3324b77ce2182f270fde3f5b9b3f07cbbe7c31a` 与 OG98 `d68ede4f3899335c315a967c7b9e9c90cb825d2e` 均保留为合并提交的祖先。源码远端为 `https://github.com/JackDows/N300.git`，`main` 跟踪 `origin/main`。旧工程检出已退役，回溯与回退使用 Git。

当前产品为 DeskHub。旧 N300 桌面专用 IPC、进程管理和发布脚本已移除；桌面直接托管公共 Hub，通过统一 JSON-RPC 接口访问全部设备和更新任务。安装身份为 `local.deskhub.desktop`，主程序为 `DeskHub.exe`。

签名私钥位于 `.local/keys/deskhub-updater.key`，不进入 Git。原厂输入和协议证据位于各模块的 `research/inputs/` 与 `research/evidence/`。换电脑构建只需要克隆仓库并运行安装依赖；签发正式更新时另行安全迁移私钥。

[发布与签名](releases.md) · [更新接口](updates.md) · [前端接手](frontend.md)

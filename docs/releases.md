# 版本发布与应用内更新

“构建 Release”生成 Windows 安装包。有签名私钥时，同一构建会生成签名和 `artifacts/updates/<版本>/` 发布文件。
没有私钥的干净克隆仍可编译、运行和测试，但不能签发更新。

## 签名与配置

- 更新地址和公钥保存在 `desktop/src-tauri/tauri.conf.json` 的 `plugins.updater`。
- 本机私钥在 `.local/keys/n300-updater.key`，不进入 Git。请单独备份；迁移发布电脑时复制到相同相对位置，或设置 `TAURI_SIGNING_PRIVATE_KEY` 为私钥路径。
- 有密码的私钥通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供密码。不得把私钥或密码写入源码、日志或发布包。
- 自动检查使用 GitHub Releases 的 `latest.json`。源码仓库可以私有；普通用户免登录下载的安装包需要可公开访问的发布地址。不要将 GitHub 访问令牌打进应用。

## 发布步骤

1. 同步修改 `desktop/package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock` 和 `tauri.conf.json` 的应用版本。
2. 更新 `packaging/release-notes.md`。
3. 运行 `scripts/project.ps1 -Action Build -Configuration Release`，再运行 `-Action Test -Configuration Release`。
4. 运行 `node scripts/publish-release.mjs` 创建或更新草稿，上传安装包、`.sig`、`latest.json` 和 `SHA256SUMS`。确认后用 `node scripts/publish-release.mjs --publish` 发布。

发布脚本复用 Git 的 GitHub 登录，CI 可以通过 `GH_TOKEN` 提供凭据；凭据不会进入安装包。已经发布的版本不会覆盖，后续更新必须增加版本号。

现有程序通过“设置 → 软件更新”检查新版本。下载包验签后调用安装器的 `/UPDATE` 模式，不要求用户先卸载；设备核心会在安装前退出以释放文件。
安装器原位替换文件并重启程序。新进程只删除更新记录中明确列出的临时安装包，不清理用户手动下载的文件。

## 本地验证

`N300_UPDATE_URL` 可把当前进程的更新源指向本地测试服务。仅允许 HTTPS 或回环 HTTP；包签名仍然必须匹配应用内公钥。
发布包应使用默认 GitHub 地址，不应设置该环境变量。
常规桌面测试覆盖无更新、新版本提示、网络失败和签名校验失败；完整安装升级需要单独验证新进程启动、核心退出、设备记录保留及临时文件清理。

完整升级测试：先安装带更新功能的旧版本，设置 `N300_UPGRADE_TEST_EXE` 为该安装目录的 `N300Desk.exe`，然后运行 `node tests/verify-upgrade.mjs`。
该测试会实际覆盖所指定的安装，使用本地签名更新包和离线模拟设备；验证结束后关闭测试程序。

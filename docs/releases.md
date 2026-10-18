# 构建与发布

应用版本位于根 `package.json`、`backend/Cargo.toml`、`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`tauri.conf.json` 与对应锁文件。设备模块独立使用各自 `module.json` 的版本。发布过的版本不可覆盖；修改模块后二进制需发布新版本。

## 依赖与构建

```powershell
.\scripts\project.ps1 -Action Install
.\scripts\project.ps1 -Action Build -Configuration Release
.\scripts\project.ps1 -Action Test -Configuration Release
```

根入口恢复 npm/Cargo/C++ 锁定依赖，构建公共后端、设备模块与桌面程序。`-Component Backend` 用于仅构建或测试无窗口后端，`-Module <ID>` 用于单独构建模块。无签名私钥也可编译运行；正式签发更新需要密钥。

| 路径 | 内容 |
| --- | --- |
| `artifacts/desktop/Release/` | `DeskHub.exe` 与完整模块目录，复制整个目录可运行 |
| `artifacts/package/Release/` | 独立后端 CLI、模块包、接口和文档 |
| `artifacts/releases/<版本>/` | NSIS 安装器、签名、整包更新清单和 SHA-256 |
| `artifacts/module-releases/` | 独立模块 ZIP、签名及目录发布输入 |

## 签名

信任公钥与发布地址统一声明在 `distribution.json`。私钥放 `.local/keys/deskhub-updater.key`，或使用 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH`；密码用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥和凭据不进入 Git、安装包或日志。

模块清单整体签名，包含模块 ID、版本、最低宿主版本、下载地址、大小、SHA-256 与包签名。模块 ZIP 只含模块清单声明的运行文件。整包使用 Tauri 的签名安装器，启用签名版本绑定，防止清单把旧包宣称为新版本。

签名机制依据 [Tauri Updater](https://v2.tauri.app/plugin/updater/) 与 [Minisign 验签库](https://docs.rs/minisign-verify/latest/minisign_verify/)。

## GitHub 发布

先完成验收，再提交并推送源码。发布脚本要求工作区干净，且本地 HEAD 与远端 main 一致。

```powershell
node scripts/package-release.mjs modules
node scripts/publish-release.mjs app --publish
node scripts/publish-release.mjs modules --publish
```

不带 `--publish` 时只生成版本草稿，不更新稳定频道。发布脚本复用 Git 的 GitHub 登录，CI 可提供 `GH_TOKEN`，不把凭据嵌入客户端。

- 整包安装器放不可变的 `v<版本>` Release，`deskhub-stable/latest.json` 提供稳定频道。
- 模块放各自 `module-<ID>-v<版本>` Release，`modules-stable/catalog.json` 提供签名目录。
- 独立发布模块：先构建该模块，再运行 `node scripts/package-release.mjs modules --module <ID>` 与 `node scripts/publish-release.mjs modules --publish`。脚本验证现有签名目录并合并该模块，其他模块记录不变。

仅推送源码不会改变下载频道。发布后从默认 HTTPS 地址实际检查版本、下载和安装，再记录验收结果。

## 实际覆盖升级

普通 `Test` 不覆盖已安装程序。安装验收单独进行：准备一个版本较低的 DeskHub 测试安装，设置 `DESKHUB_UPGRADE_TEST_EXE` 为其 `DeskHub.exe`，执行：

```powershell
node tests/verify-upgrade.mjs
# 发布后从默认 GitHub 更新地址实际下载并升级：
node tests/verify-upgrade.mjs --published
```

该脚本使用已签名的 Release 安装器与本地更新源，验证退出全部模块、覆盖、重启、绑定/用户配置/页面存储保持、下载与临时安装器删除、两个设备模块可继续工作。测试记录在 `artifacts/validation/upgrade-*/result.json`。验收结束后按 `AGENTS.md` 手动检查并移除测试安装和临时文件，保留正式安装包与精简记录。

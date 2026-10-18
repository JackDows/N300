# N300 Desktop

Edifier N300 的桌面控制界面（非官方）。Tauri 2 + React + TypeScript，
设备控制由相邻工程 [edifier-n300](../edifier-n300) 的 `n300.exe serve` 负责，本工程只做界面。

```text
React 界面 ──invoke/event──▶ Tauri（Rust，约 150 行）──stdin/stdout──▶ n300.exe serve ──BLE──▶ N300
```

## 运行

```powershell
npm install

# 只看界面：浏览器 + 内存模拟音响，不需要 Rust
npm run dev                  # 打开 http://localhost:1420

# 桌面版（需要 Rust 工具链，见下）
npm run app:dev              # 连接真实音箱
$env:N300_OFFLINE = "1"; npm run app:dev   # 桌面窗口 + n300 内置模拟设备
npm run app:build            # 生成 NSIS 安装包，自动附带 n300.exe / n300.dll
```

桌面版第一次运行前需要安装 Rust：`winget install Rustlang.Rustup`，然后重开终端。
Visual Studio 的 C++ 工具链和 WebView2 在构建 edifier-n300 时已经具备。

`n300.exe` 的查找顺序：环境变量 `N300_EXE` → 安装目录下的 `n300/n300.exe` →
开发时的 `../edifier-n300/artifacts/package/Release/n300.exe`。打包前先构建一次 edifier-n300 的 Release。

浏览器预览参数：`?tab=sound`、`?tab=settings` 直接打开对应页面；`?preset=customized` 让模拟音箱以自定义音效启动。

## 设计

- **三页分工**：音量（首页只有设备名、旋钮、输入源）/ 音效（预设 + 均衡器）/ 设置（设备信息与开关）。
- **一处换肤**：所有颜色、圆角、动效时长、字体都在 [src/styles/tokens.css](src/styles/tokens.css)。
  强调色只用在“当前值”和“正在发生的事”上，改 `--accent*` 几个变量即可换主色。
- **窗口**：400×720 无边框，保留系统阴影和 Win11 圆角；标题栏整条可拖动。

## 目录

```text
src/
  styles/tokens.css        设计变量（换主题改这里）
  styles/base.css          骨架、颗粒质感、页面切换、浏览器预览窗口
  device/                  设备层：类型、Tauri 通道、模拟音箱、状态 Context
  components/              旋钮、分段选择、EQ 曲线、预设、列表/开关、标题栏/导航、图标
  pages/                   三个页面及页面样式
src-tauri/
  src/lib.rs               启动并托管 n300.exe serve，逐行转发 JSON-RPC
  tauri.conf.json          窗口、CSP、打包资源
  capabilities/            前端可用的最小权限
app-icon.svg               图标源文件（npx tauri icon app-icon.svg -o src-tauri/icons 重新生成）
```

## 交互约定（对齐 n300 接口）

- 音量范围取设备返回的 `min/max/step`；旋钮按相对角度拖动，按下不会跳值，停止 160 ms 后才写入。
- 输入源、音效菜单由设备回复的 `choices` 生成，未知值用通用图标。
- 写入先乐观更新界面，成功后弹出轻提示；失败则提示错误，并重新读取该属性纠正界面。
- 断开后不显示旧值；连上后自动 `status {full:true}` 读一次全部设置。
- 关机需要长按 1.1 秒；接口返回 `power_state: "unverified"`，界面只提示“指令已发送”。
- EQ 曲线是按对数频率画的示意曲线，不是设备实际频响。

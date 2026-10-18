# 保留的 N300 桌面界面

Tauri 2 + React + TypeScript。设备控制通过同仓库的 C++ 核心完成。

这里保留原 N300 前端基线。DeskHub 的公共后端与前端接口见 [前端接手指南](../../docs/frontend.md)。根目录通用入口当前构建 DeskHub 后端与模块，尚未把此界面改成多设备 UI。
需要维护旧桌面时，使用 modules/edifier-n300/scripts/project.ps1 的 -Component Desktop；其构建仍会打包原生核心。

浏览器预览：npm run dev（模拟数据）；桌面热更新：npm run app:dev。
离线桌面热更新在仓库根目录执行 modules/edifier-n300/scripts/dev.ps1 -Offline。

旧设备连接约定见 [原生 API](../../modules/edifier-n300/docs/api.md)，旧成品用法见 [桌面说明](../../modules/edifier-n300/docs/desktop.md)。

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
  updates/                 更新提醒、下载进度与设置入口
src-tauri/
  src/lib.rs               启动并托管 n300.exe serve，逐行转发 JSON-RPC
  src/updates.rs           官方更新插件、安装前清理核心、升级包清理
  tauri.conf.json          窗口、CSP、打包资源
  capabilities/            前端可用的最小权限
app-icon.svg               图标源文件（npm run tauri -- icon app-icon.svg -o src-tauri/icons 重新生成）
```


## 接口与生命周期

- RPC 响应按请求 ID 匹配，消息携带核心进程代次，旧进程的退出通知不会干扰新进程。
- 写入返回核心回读后的确认值；失败重新读取，不能继续把乐观值当作设备实际值。
- 断线后隐藏旧值，连接后加载设置；渲染器热更新能恢复已运行核心的状态。
- 窗口关闭先发送 stdin EOF，超时后终止核心；Windows Job Object 在桌面异常退出时也释放核心进程。
- 核心退出可手动重新连接，不自动重放可能已执行的写入。
- 通过 --offline 运行的是原生模拟设备，标题栏会明确显示“离线演示”。

# 诊断与问题追溯

DeskHub 将公共后端、设备模块、更新任务和前端错误记录到所选数据目录的 `logs/`。默认路径为 `%LOCALAPPDATA%\DeskHub\backend\online\logs`，离线模式使用相邻的 `offline` 目录。

通过公共 API `diagnostics.export` 导出一份日志与状态目录，发送整个导出目录即可排查。导出包含请求编号、设备 ID、会话代次、技术错误和模块版本；用户界面只显示 `userMessage`。

N300 原生核心的协议事件由适配器转交模块日志。模块失败不会阻塞键盘等其他设备；定位问题时保留故障前后的日志与 `summary.json`。

[公共 API](../../../docs/api.md) · [更新任务与日志](../../../docs/updates.md)

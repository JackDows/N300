# 下载、安装与更新接口

设备模块更新由公共后端管理；整包安装由桌面宿主执行。两者共用下载任务、签名验证、进度事件和诊断日志。前端只调用接口，不处理下载地址、签名、压缩包、安装器或设备进程。

## 通道与初始化

桌面使用 `contracts/desktop.mjs` 的 `createDesktopClient({ invoke, listen })`。它调用 Tauri 命令 `hub_request`，订阅 `deskhub://event`。请求与响应都是 JSON-RPC 2.0。

`hub.describe.methods` 是当前宿主实际支持的方法。CLI 支持全部模块更新接口；`app.updates.*` 与 `app.takeActivationNotice` 由桌面提供。类型位于 `contracts/client.d.mts`，请求结构位于 `contracts/api.schema.json`。

启动页面先订阅 `updates.changed`，再调用 `updates.list` 恢复当前任务。所有下载与安装方法迅速返回一个任务，不要求页面保持请求打开等待整个下载过程。

## 整包更新

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `app.updates.info` | `{}` | 当前 `version` 和上次安装 `lastResult` |
| `app.updates.check` | `{}` | `currentVersion` 与 `release: { version, notes }`，没有更新时为 `null` |
| `app.updates.download` | `{}` | 为刚检查到的版本建立下载任务 |
| `app.updates.install` | `{ jobId }` | 接受已校验的任务并进入 `installing`；随后退出、覆盖安装、重新启动 |

```js
const { release } = await client.request('app.updates.check');
if (release) {
  const job = await client.request('app.updates.download');
  // 订阅事件或查询 updates.get，等 job.state === 'ready'。
  await client.request('app.updates.install', { jobId: job.id });
}
```

整包安装前会停止全部模块并拒绝新请求，释放 EXE/DLL。安装器覆盖 DeskHub 的安装目录，设备绑定与用户数据位于独立数据目录。安装后恢复原来已连接的设备，不重放设备设置写入。

新进程把安装结果写入 `lastResult`，其字段为 `version`、`jobId`、`state`、`cleanupPending`。更新任务最终变为 `completed`。下载缓存与本次安装器在更新后删除；用户手动下载的安装器不在清理范围内。

下载或签名验证失败不退出程序。安装器启动失败时恢复宿主与原设备连接，任务为 `failed`。安装期间不接受取消。新前端无需实现单独的安装进程管理。

## 模块目录与独立更新

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `modules.catalog` / `modules.checkUpdates` | `{}` | 从签名目录读取 `releases`，每项包含 `release`、`installedVersions`、关联 `devices`、`compatible`、`available` |
| `modules.download` | `{ moduleId, version? }` | 创建模块下载任务；未指定版本时选择适用的最高稳定版本 |
| `modules.install` | `{ jobId, deviceId? }` | 安装已下载模块；指定 `deviceId` 时同时更新该设备实例 |
| `modules.list` | `{}` | 随应用提供的包与用户已安装的包，按指纹去重 |

`release` 包含模块 ID、版本、最低 Hub 版本、平台、协议版本、说明和签名包元数据。`available` 表示目录版本高于本地已安装版本；已安装的版本与每个设备正在使用的版本分别列出。平台或 Hub 版本不兼容时不可下载启用。

```js
const catalog = await client.request('modules.checkUpdates');
const download = await client.request('modules.download', {
  moduleId: 'flesports-og98', version: '0.1.0',
});
// 等下载任务 ready。
await client.request('modules.install', { jobId: download.id, deviceId: 'keyboard' });
// 等 completed；result.package 是安装后的完整模块包信息。
```

不传 `deviceId` 时只安装模块，不添加或连接设备。完成后可用 `result.package.packagePath` 调用 `devices.add`。同一个模块供多个设备实例使用时，可把安装后的包逐个交给 `devices.replace`，不会强迫其他实例一起更新。

安装前再次校验缓存内容，检查 ZIP 路径、展开大小、重复文件、清单声明和文件哈希；运行时握手检查模块 ID、版本与协议。更新目标设备失败时恢复原绑定与原模块；回退结果记录在错误 `details.rolledBack` 中。其他模块的进程和队列保持运行。在线安装不允许把指定设备降到更低版本。

## 任务与事件

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| `updates.list` | `{}` | 当前任务及最近结果，最多保留 100 项 |
| `updates.get` | `{ jobId }` | 单个任务的当前快照 |
| `updates.cancel` | `{ jobId }` | 取消排队、下载或待安装任务；可中止没有继续返回数据的网络请求 |

任务字段：`id`、`kind: app|module`、`subject`、`version`、`state`、`downloaded`、`total`、`createdAtUnixMs`、`error`、`result`。

```text
queued → downloading → verifying → ready → installing → completed
                    ↘ failed / cancelled
宿主中断 → interrupted
```

事件格式：

```js
client.subscribe(event => {
  if (event.type === 'updates.changed') updateTask(event.job);
});
```

相同模块不重复创建未结束的任务；不同模块可独立下载。整包安装等待其他正在执行的更新完成。页面重载后使用 `updates.list` 恢复状态。宿主重启后未完成的下载记录为 `interrupted`，清理所属缓存，重新下载即可；不做断点续传或自动重试写入。

界面展示 `error.userMessage`；`code`、`message` 和 `details` 留作排查。`diagnostics.export` 包含更新记录、设备状态和日志；更新不会弹出原始技术错误。

## 离线开发与验收

```js
const client = createMockClient(deviceFixtures, {
  updateScenario: 'success', // network-error / bad-signature / install-failure
});
```

浏览器模拟器提供整包与模块的相同接口、进度、取消和失败状态，不访问网络或文件。它用于页面开发。`tests/updates.mjs` 通过真实原生宿主、HTTP 服务、临时测试签名和模块子进程验证下载及安装；`tests/verify-upgrade.mjs` 单独执行真实 Windows 覆盖升级。

本地验收可给进程设置 `DESKHUB_UPDATE_CONFIG`，指向与 `distribution.json` 相同结构的配置文件。远端地址必须 HTTPS；仅回环地址允许 HTTP，签名校验始终启用。信任公钥属于宿主配置，不能通过前端请求修改。正式发布使用仓库默认配置。

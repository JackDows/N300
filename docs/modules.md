# 模块开发与替换

每个模块目录包含 `module.json`、`module.ps1`、`module.build.json`、协议实现和自己的测试。公共构建入口扫描这些目录，不需要在根脚本里增加型号或语言分支。

- `module.ps1 -Action Install|Build -Configuration Debug|Release`：模块自行恢复依赖、构建并验证。现有 C++ 模块复用 `modules/sdk/cmake.ps1`。
- `module.build.json.files`：分发文件名到模块内生成物的映射，支持 `{Configuration}`。根入口复制这些文件并生成 SHA-256 清单。
- `module.json`：模块 ID、版本、协议版本、入口 EXE、连接方式。C++ 适配器的握手版本由此文件编译生成。

分发结果位于 `artifacts/package/<配置>/modules/<moduleId>/<版本>/`。这个目录是完整替换单位；同时携带 EXE、DLL 和许可证，不能只换一个 DLL。本地包用清单哈希检查完整性；在线安装还要验证签名目录和 ZIP 签名，发布方法见 [发布文档](releases.md)。

## 独立运行

直接启动模块 EXE，按行发送请求。`--offline` 会强制初始化采用模拟模式：

```json
{"jsonrpc":"2.0","id":1,"method":"module.describe"}
{"jsonrpc":"2.0","id":2,"method":"session.initialize","params":{"offline":true}}
{"jsonrpc":"2.0","id":3,"method":"device.connect"}
{"jsonrpc":"2.0","id":4,"method":"capability.read","params":{"capability":"lighting.brightness"}}
{"jsonrpc":"2.0","id":5,"method":"module.shutdown"}
```

上面的能力读取适用于 OG98；N300 可换成 audio.volume，G HUB 可换成 mouse.dpiStage。N300、OG98 原有原生 CLI/DLL/C ABI 也保留在各模块的 `artifacts/package/<配置>/`，可独立开发和诊断。

## 模块协议 v1

| 方法 | 约定 |
| --- | --- |
| module.describe | 不访问硬件；返回 id、version、protocolVersion、capabilities、simulation |
| session.initialize | 接收 offline、target、config、diagnosticPath；创建会话，不连接硬件；每进程一次 |
| device.scan | 返回统一候选数组，每项含 label、modelVerified、target.resourceId |
| device.connect / disconnect / snapshot | 返回含 phase、values、target、offline 的模块快照；snapshot 是主动刷新 |
| capability.read / write / invoke | capability 标识能力；写入带 value，调用带 arguments |
| module.shutdown | 停止接收操作、取消待处理命令，退出模块 |

成功用 JSON-RPC result，失败用 error.data 的 code/message/userMessage/details。事件用 `module.event`，params 包含 type/data；`type:"snapshot"` 表示新状态。stdout 只能包含协议帧，诊断输出到 stderr。EOF 会处理完已接受的模块请求再退出。

同一设备的 I/O 在专用工作线程串行执行。N300 在该线程初始化 Windows MTA，停止时调用原有取消接口。OG98 的同步 HID 调用不能保证硬取消，宿主通过独立进程与超时负责最终隔离。G HUB 模块另有自身的 WebSocket 接收线程，关闭连接可取消等待；模块退出不会终止官方 G HUB 后台。各模块互不共享设备队列，G HUB 的依赖与接口见 [模块说明](../modules/logitech-ghub/README.md)。

## 替换流程

整包提供设备模块的最低发布基线。启动设备实例时，宿主检查 `moduleRoot/<moduleId>/`：如有高于当前绑定的稳定版本，先校验文件、复制到受管目录并完成运行时握手，再原子保存新包路径。标签、目标、配置和模拟模式保持不变；只读回硬件状态，不恢复旧写入。校验或握手失败保留原绑定、该实例报告失败，其他设备仍独立启动。独立安装的更高版本继续使用，应用附带较旧模块时不会降级。不会在会话运行中自动热替换。

先单独构建新版本，把完整目录交给 `devices.replace`：

```js
await client.request('devices.replace', {
  deviceId: 'keyboard', packagePath: 'F:/packages/flesports-og98/0.2.0',
});
```

宿主将包复制到自己管理的按版本/指纹划分的目录并校验，启动候选模块进行握手，再停止旧会话。版本不兼容、内容损坏或运行时身份不符，会在旧会话继续运行时返回失败。`replace` 要求 moduleId 相同；换设备类型用 `devices.rebind`。

在线流程通过 `modules.download` 和 `modules.install` 使用同一替换机制，支持下载进度、取消与失败恢复，见 [更新接口](updates.md)。不监听构建目录自动热换，也不自动重放设备设置。接口版本有破坏性变化时提高 protocolVersion；宿主拒绝不支持的版本。

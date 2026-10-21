# 键位、鼠标按键与宏接口

DeskHub 0.6.0 使用 OG98 / G HUB 模块 0.2.0。全部调用仍经过 `devices.read/write/invoke`；模块独立进程、队列和更新边界不变。能力由 `capabilities` 判断。已有绑定不会自动改用新模块，安装后对指定实例调用 `modules.install` 的 `deviceId` 或 `devices.replace`。

## OG98 两层键位

读取 `keyboard.keymap` / `keyboard.fnKeymap`，返回 `{value:{layer,profile,keys,matrix}}`。`keys` 包含原厂布局对应的 99 个位置，每项为 `{slot,label,hid,x,y,w,h,binding,defaultBinding}`；完整硬件矩阵有 128 个四字节槽位。布局由 `modules/flesports-og98/assets/layout.json` 同时供原生模块和界面使用。型号名称不作为物理位置数量的依据。

`binding` 保留四字节 `raw`，并提供 `type`：key、media、disabled、macro 或 special。未知的已有功能只显示，不重编码或覆盖。`defaultBinding` 是普通层出厂定义，不能用作 Fn 层默认值。

```js
const {value: map} = await client.request('devices.read', {
  deviceId:'keyboard', capability:'keyboard.keymap', timeoutMs:30000,
});
const key = map.keys.find(k => k.label === 'F12');
const changed = await client.request('devices.invoke', {
  deviceId:'keyboard', capability:'keyboard.keymap.set',
  arguments:{layer:'normal', profile:map.profile, slot:key.slot,
    action:{type:'key', modifier:0, key:104, second:0}}, // F13
});
// changed = {before,after,verified:true,layer,slot}
// 恢复刚才保存的原始绑定；Fn 层同样适用。
await client.request('devices.invoke', {
  deviceId:'keyboard', capability:'keyboard.keymap.set',
  arguments:{layer:'normal', profile:map.profile, slot:key.slot,
    action:{type:'restore', raw:changed.before.raw}},
});
```

动作：

| type | 参数与用途 |
| --- | --- |
| key | modifier 为 0 或 HID 224–231，key 为 HID 4–231，second 为 0 或 HID 4–231；最多三个 HID 键 |
| media | code 为 205 播放暂停、182 上一曲、181 下一曲、183 停止、226 静音、234 音量减、233 音量加、402 计算器、387 媒体播放器 |
| disabled | 禁用目标键 |
| default | 仅普通层，恢复该位置的原键；Fn 不接受此操作 |
| restore | 原样恢复此前保存的四字节 raw，包括特殊功能与已有宏 |

`modifier` 是 HID 用途码，**不是位掩码**。例如 Ctrl+Shift+C 为 `{modifier:224,key:225,second:6}`。`profile` 应传读取结果，用于拒绝界面读取后发生的配置切换。

写入只发送一次。保存前后比较目标所在的 64 字节数据页，其余键位必须相同；矩阵读取因没有页响应序号而执行两次相同读取校验。完整读取比单键保存慢，界面按需读取，常规状态刷新不读取键位。失败后提示重新同步，不自动重放写入。

`keyboard.options` 支持部分写入，例如 `value:{winLocked:true}` 或 `{wasdSwapped:false}`。仅开放这两个布尔项，保留其他键盘标志和原始字节。键盘宏存储、逐键灯效与其他设置编辑仍不在本版范围。

## G HUB 按键绑定

读取 `mouse.bindings` 返回 `{value:{profileId,profileName,softwareMode,buttons}}`。每个 button 包含 `slotId,number,shifted,card:{id,name,type,readOnly}`。`shifted:true` 是 G-Shift 层。只返回当前鼠标的槽位，配置里残留的其他型号槽位被排除。

```js
await client.request('devices.invoke', {
  deviceId:'mouse', capability:'mouse.bindings.set',
  arguments:{profileId,slotId,cardId},
});
// 恢复默认：arguments:{profileId,slotId,restoreDefault:true}
```

设置返回 `{verified:true,binding:{slotId,cardId}}`。默认恢复以 G HUB 返回的实际默认卡片 ID 为目标确认，不靠“已变化”判断成功。板载模式拒绝软件按键绑定，需要用户显式选择软件控制。软件宏执行依赖 G HUB 后台。

## 宏库与动作

| invoke 能力 | arguments | 返回 |
| --- | --- | --- |
| macros.list | 可选 profileId、offset（默认 0）、limit（1–100，默认 50） | profileId、offset、total、items 元数据 |
| macros.get | id；可选 profileId | 宏内容、readOnly、editable |
| macros.save | macro；建议传 profileId | 保存并回读的宏，verified:true |
| macros.remove | id；建议传 profileId | removed:true |

新建宏不传 id；修改时携带既有 id。名称不得为空，最多 192 个 UTF-8 字节，界面最多 64 字符。保存目标限当前应用下可编辑的用户宏。原厂只读卡片可绑定，不能编辑或删除。删除前检查所有软件配置，任何仍被按键引用的宏都会拒绝删除。

```js
const macro = await client.request('devices.invoke', {
  deviceId:'mouse', capability:'macros.save',
  arguments:{profileId,macro:{name:'示例',mode:'once',steps:[
    {type:'key',code:115,down:true,label:'F24'},
    {type:'delay',ms:20},
    {type:'key',code:115,down:false,label:'F24'},
  ]}},
});
```

`mode`：once 执行一次、hold 按住重复、toggle 再按停止，均使用 `steps`。sequence 使用 `press/hold/release` 三个数组，分别对应按下、按住循环、松开阶段。按住阶段必须回到进入该阶段时的按键状态；整段结束不能留下未松开的键。

动作共计 1–256 个：

- `{type:'key',code:4..231,down:boolean,label?:string}`，label 最多 80 UTF-8 字节。
- `{type:'mouse',button:1..8,down:boolean}`。
- `{type:'wheel',axis:'vertical'|'horizontal',positive:boolean}`。
- `{type:'delay',ms:0..60000}`。

原厂已有宏中的隐式默认间隔展开为延时动作后再编辑；遇到未知动作时 `editable:false`，保留原宏并允许绑定。保存前调用 G HUB 原生校验，保存后读取并比较完整动作。界面录制只在明确启动并聚焦的录制区监听键盘；Esc、失焦和离开宏页停止录制，并补齐当前录制段按下的键。没有系统级键盘钩子或后台输入采集。

## 模拟与验证

`contracts/mock-controls.mjs`、原生模拟模块提供相同的键位、选项、宏和绑定语义。`tests/features.mjs` 对两种模式执行同一套读写、恢复、范围拒绝、配置身份、板载限制与宏使用中删除保护。界面测试覆盖录制、保存、绑定、恢复和删除；实际 Windows 桌面测试同时核对原生模块结果。

实机入口显式执行：

```powershell
node tests/hardware-controls.mjs --targets=.local/hardware-targets.json --write-and-restore
# 只验证鼠标；暂时切到软件模式，结束恢复原模式和侧键绑定：
node tests/hardware-controls.mjs --mouse-only --write-and-restore
```

该入口不进入普通 Test 工作流。操作前保存基线，结束恢复并检查完整键位/按钮列表，删除自建临时宏。记录留在本次 `artifacts/validation/hardware-controls-*/`，按人工收尾约定保留精简证据。

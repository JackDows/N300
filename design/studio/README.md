# DeskHub 场景样板

这份样板用于检查桌搭的构图、设备材质和浮起交互。模型由同一个 Blender 场景生成；键盘读取工程内的 OG98 真实配列。机箱、散热器及内部装配属于概念造型，CPU、GPU 等型号标识来自本机已核对的硬件。

## 视觉约束

- 主体是设备，控制界面随选择出现。背景与装饰保持低对比度。
- 深石墨桌面、哑光外壳、中性金属，少量冰青色灯光。白色用于刻字和鼠标外壳，不以整屏色罩代替光照。
- 固定观察角度；设备从桌面到聚焦状态复用同一份几何与材质。
- 所有键帽保留实际槽位与独立对象。长键使用实际尺寸建模。
- 鼠标滚轮朝显示器，侧键位于拇指侧；白色外壳和侧键使用同一材质，滚轮保留黑色橡胶。
- 机箱侧板和内部部件独立建模，侧板围绕铰链打开；部件选择反馈附着在对应模型上。
- 交互样板只更新预览状态，不写入用户设备。

## 生成与预览

使用 Blender 5.2.2 LTS（渲染优先使用 OptiX，没有可用设备时使用 CPU）：

```powershell
npm --prefix apps/desktop ci
& 'D:\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python design/studio/build_scene.py -- --render
npm --prefix apps/desktop run dev -- --host 127.0.0.1
```

浏览器打开 `/visual.html`。`D:\Blender` 是本机完整安装位置；其他电脑可用自己的 Blender 路径运行相同命令。渲染与模型输出到 `artifacts/visual/studio-v1`，源码和配列保留在 Git。Blender 源场景、GLB 和审核图由构建生成，不依赖此前的拼贴素材。

审核遵循 `refactoring-ui` 的层级、留白和可读性要求。三维造型与光照属于场景美术工作，需额外检查真实渲染。每次交付前人工检查和清理中间产物。

模型制作按设备与材质分开：

- `build_scene.py`：桌面构图、其他设备、光照和导出。
- `keyboard_asset.py`：OG98 槽位、各排键帽高度与倾角、凹面、刻字、开放边框和分件。导出前检查刻字是否被键帽遮住。
- `mouse_asset.py`：按官方顶视轮廓及侧视高度约束建模；外壳、左右主键、滚轮和两枚侧键独立分件。侧键有自己的侧平面，不向外壳曲面投影变形。
- `screen_asset.py`：显示器边框、背壳和屏幕显示材质。屏幕图案由源码生成并打包，设备本体仍是几何模型。
- `studio_materials.py`：生成塑料、金属与织物的法线和粗糙度贴图；物理 UV 尺寸为每单元 20 mm。使用 Blender 自带的 NumPy，图像打包在 `.blend` 和 GLB 内，无外部纹理依赖。

## 独立预览包

模型生成后，在工程根目录运行：

```powershell
npm --prefix apps/desktop run build:visual
npm --prefix apps/desktop run preview:visual
```

保持预览服务器运行，在另一个终端执行：

```powershell
npm --prefix apps/desktop run open:visual
```

该入口使用工程内 `.local/visual-runtime` 的独立 Edge 配置并启用浏览器沙箱，启动时输出实际 GPU。它不使用个人浏览器的硬件加速设置，也不修改个人浏览器或系统设置。关掉预览窗口会结束启动器进程。该目录在窗口使用期间需要保留，结束本轮工作后按工程规则人工检查清理。

预览服务地址是 `http://127.0.0.1:1421/visual.html`。直接用个人浏览器打开时，其硬件加速必须可用；页面会拒绝性能严重受限的软件 WebGL，防止退回 CPU 后继续渲染。预览包位于 `artifacts/visual/preview`，模型、字体与脚本全部随包提供；运行时无需 Blender，也不调用 DeskHub 设备后台。开发入口是 `apps/desktop/visual.html`。

移动鼠标到设备上可轻微浮起并高亮，移开后平滑落回；点击设备从当前姿态进入聚焦。左右音箱分别从实际点击的位置浮起。键盘的每个模型按键可独立选中，设置卡片里的功能保存在本次预览会话。点击机箱会打开侧板；点击内部部件显示已核对的型号。点击空白或按 Esc 收回，Esc 在有选择时先取消选择。

键盘近景在宽窗口中为模型与设置并排，在小窗口中把设置放到键盘上方。面板分别显示当前功能与待应用的功能；“恢复原键”先恢复待应用值，应用后才更新本次预览的映射。

## 渲染与模块边界

- Blender 负责建模、真实尺度、配列、材质与初始镜头。导出的 GLB 保留 `device_id`、`slot_id`、`part_id` 和侧板铰链层级。
- Three.js 使用固定镜头、抗锯齿、接触阴影和局部发光。设备聚焦复用同一个对象，选择反馈克隆目标材质，不改其他按键。
- React 管理标题和上下文控件。模型里的槽位可以继续接入现有 OG98 接口；这份样板没有真实设备写入路径。
- 桌面静止时停止逐帧渲染，交互和过渡动画期间才刷新。侧板动画可中断并反向播放。
- 主机外观与内部装配是概念模型，并非对应实际机箱、散热器的精确型号。CPU、GPU、主板等名称来自此前核对结果，不代表实时检测或监测。

## 检查

```powershell
npm --prefix apps/desktop run test:visual
npm --prefix apps/desktop run review:visual
```

检查已构建的预览包时，先运行 `preview:visual`，然后在当前终端设置 `$env:DESKHUB_VISUAL_URL='http://127.0.0.1:1421'` 再执行上述检查命令。测试记录写入 `artifacts/visual/validation.json`；截图脚本生成默认窗口、最小窗口、窄屏和显示缩放的画面，供人工审查。清理仍需人工逐项执行。

实际窗口的性能验证：`npm --prefix apps/desktop run open:visual -- --benchmark`。记录位于 `artifacts/visual/performance.json`，包括 WebGL 显卡、实际尺寸和像素比、首次及重复交互的帧间隔。完成后保存实际窗口的 `visible-desktop.png`、`visible-keyboard.png`，并回到桌面，便于从全景开始检查。加载阶段预编译桌面与聚焦视图的光照变体，执行聚焦场景的离屏绘制以准备阴影、法线和驱动管线，减少首次点击的停顿。

本轮的具体发现和验证范围见 [REVIEW.md](REVIEW.md)。

## 资源

模型几何由本目录脚本生成。`Inter.ttf` 来自 [Google Fonts 的 Inter 字体](https://github.com/google/fonts/tree/main/ofl/inter)，使用随附的 [SIL Open Font License](Inter-OFL.txt)。字体同时嵌入 Blender 源文件，打开源场景时不依赖本机字体安装。

鼠标造型核对使用 [Logitech 官方产品页](https://www.logitechg.com/en-us/shop/p/pro-x-superlight-2-se) 的顶视、左侧视和斜视图片。参考页为黑色型号，样板外壳与侧键的白色以用户确认的实物为准。参考图不作为运行时贴图或构建依赖；轮廓参数随源码保留。

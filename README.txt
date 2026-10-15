N300 Desk

用于 Edifier N300 的非官方 Windows BLE 控制程序。
已实现首版和离线验证；实机连接、AUX 播放与 BLE 控制并行仍待验证。
完整功能与使用方法见 docs/user-guide.txt，协议依据见 docs/reverse-engineering.txt。

VS Code 通用工程入口
双击 N300.code-workspace，或用 VS Code 打开当前项目根目录。
整个 Reverse 工作区也可以打开 ../../Reverse.code-workspace；普通父文件夹
不会自动加载子项目的 launch.json。按推荐安装工程所用的编辑器扩展。

“运行和调试”下拉框固定提供六个动作，选中后按 F5：
  安装依赖          准备项目所需的环境、工具和依赖。
  构建 Debug        生成用于开发诊断的 Debug 产物。
  构建 Release      生成用于分发使用的 Release 产物。
  运行 Debug        构建并运行 Debug 产物。
  运行 Release      构建并运行 Release 产物。
  运行离线测试版    构建并运行使用模拟数据的版本。

入口名称与项目语言无关。launch.json/tasks.json 只调用 scripts/project.ps1
的 Install、Build、Run、Test 接口，以及 Debug/Release、Offline 参数。
换项目或语言时，保留这些动作和名称，由项目内部实现相应的依赖、构建、
运行方式；不能把某种语言、设备型号、具体测试功能写进公共动作名称。
安装失败会阻止后续构建，构建失败会阻止运行。

Ctrl+Shift+B 执行默认的构建 Release；“终端 → 运行任务”同时提供
install、build-debug、build-release、run-debug、run-release、run-offline、test。
本项目中的 Python 解释器选择和测试发现属于语言设置，不改变通用工作流。
配置、脚本与依赖锁定随 Git 提交，所有路径从当前项目目录定位。

本项目的构建区别
Debug 保留控制台、未优化的 Python 字节码，运行时开启详细日志。
Release 使用 GUI 启动程序与优化后的字节码，不额外显示控制台。
两者分别输出到 artifacts/dist/Debug 和 artifacts/dist/Release，不互相覆盖。
离线测试版运行 Debug 产物并启用示例数据，不扫描或控制真实音响。

直接运行现有程序
  双击“启动 N300 控制台.cmd”。
  双击“离线预览.cmd”可以查看示例界面，不操作蓝牙。
  可执行文件：artifacts/dist/Release/N300Desk/N300Desk.exe
  请将 N300Desk 目录及 _internal 一起保留。

另一台电脑：从 Git 源码构建
基础环境：Windows x64、Python 3.12（包含 tkinter）、Git、PowerShell 5.1 或 7。
应用构建不需要 REA、Node.js、JDK、JADX、官方 APK 或现有 artifacts 目录。
Python 依赖从 requirements-dev.lock.txt 安装，包含固定版本的直接和间接依赖。

1. 克隆本仓库或复制完整源码目录，进入项目根目录。
   若尚未配置远程，可使用 git bundle 迁移仓库，见下文。
2. 安装项目依赖与开发包：
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
   如果 python 不在 PATH，可明确指定解释器：
   .\scripts\setup.ps1 -Python 'C:\Python312\python.exe'
3. 编译并验证：
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
   脚本先运行离线测试，再生成 EXE，最后验证独立 EXE 能创建界面、加载
   设置资源和 Windows 蓝牙后端；构建与验证不会扫描或控制真实音响。
4. 将 artifacts/dist/Release/N300Desk 整个目录复制到运行机器，打开 N300Desk.exe。
   打包后的程序自带 Python 运行库，运行机器不需要安装 Python。

命令行使用同一套通用动作（项目根目录）
  .\scripts\project.ps1 -Action Install
  .\scripts\project.ps1 -Action Build -Configuration Debug
  .\scripts\project.ps1 -Action Build -Configuration Release
  .\scripts\project.ps1 -Action Run -Configuration Debug
  .\scripts\project.ps1 -Action Run -Configuration Release
  .\scripts\project.ps1 -Action Run -Configuration Debug -Offline
  .\scripts\project.ps1 -Action Test
VS Code 使用 tasks.json 的依赖关系自动先安装、后构建、再运行。
命令行需要按对应顺序调用，底层 setup/build/run/test 脚本仍可单独使用。

脚本根据自身位置定位项目，项目可以放在任意目录，不要求 F 盘或 Reverse。
setup.ps1 创建当前项目的 .venv，并安装可编辑包，不写全局 Python 环境。
不要跨机器复制 .venv；在目标机器重新执行 setup.ps1。

工程层级
  N300.code-workspace         可携带的 VS Code 项目入口
  .vscode/                   固定启动项、任务、解释器设置和扩展推荐
  src/n300_desk/              应用包：界面、BLE 控制、协议、设置资源
  tests/                     离线协议和模拟 GATT 集成测试
  scripts/                   project.ps1 通用接口及各动作的项目实现
  packaging/                 PyInstaller 打包配置
  docs/                      使用说明、逆向结论、界面预览
  research/scripts/          资料下载、静态分析、配置提取、人工实测辅助脚本
  research/sources.json      原始资料来源、版本及校验值
  research/inputs/           APK、PDF 等原始资料（本地，不提交）
  research/evidence/         反编译和分析输出（本地，不提交）
  artifacts/dist/            可分发程序（生成物，不提交）
  artifacts/build/           打包中间文件（生成物，不提交）
  artifacts/validation/      测试、构建和启动检查结果（生成物，不提交）
  .local/                    开发日志和临时文件（本地，不提交）
  .venv/                     可重建虚拟环境（本地，不提交）
  pyproject.toml             包定义、运行依赖、入口和资源声明
  requirements-dev.lock.txt  固定版本的完整开发依赖

Git 管理与迁移
只提交本项目源码、测试、构建配置、依赖锁定和文档。
原始下载、反编译输出、日志、缓存、EXE、虚拟环境由 .gitignore 排除。
可在本机用 git bundle create n300-desk.bundle --all 导出提交历史，
另一台机器执行 git clone n300-desk.bundle edifier-n300，再执行上述安装和构建。
bundle 不包含被忽略的资料和程序；应用源码构建不需要这些文件。
如果需要继续逆向，按 research/README.txt 下载资料或额外复制研究目录。

修改依赖
运行依赖定义在 pyproject.toml；新增/升级依赖时同步更新锁定文件中的固定
版本，在新虚拟环境重新安装、执行 pip check 和 build.ps1 后再提交。
pyproject.toml 的资源声明保证 settings-catalog.json 随安装包和 EXE 一起提供。

验证边界
离线测试验证软件协议行为，模拟回复不能证明真实 N300 接受命令。
涉及真实蓝牙的 research/scripts/probe_*.py 仅在准备实测时手动运行。

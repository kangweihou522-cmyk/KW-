# Windows 11 本地安装与更新

PaperDesk 是 PaperQuay 派生的独立版本。阅读、笔记、批注和默认离线英中翻译不要求 ChatGPT/Codex 登录，也不启动 Ollama。ChatGPT 网页可以单独使用；自动报告和问答使用可选的官方 Codex 授权，可能要求手机号验证。Plus/普通账户不附带免费 API，不配置付费 API 或购买额度。

## 安装位置

默认根目录 `D:\PaperDesk`；`app` 保存可替换程序，`data` 保存数据库、配置及笔记，`library` 保存管理的文献，`models` 保存可选 Ollama 模型及 `translation` 下的独立翻译语言包，`backups` 保存备份，`tools` 保存快捷启动等脚本。程序启动还会将 Chromium 配置和缓存放在这个根目录。

如果没有 D 盘，程序报出明确错误，不自动改存 C 盘。可在安装脚本使用 `-Root "E:\My Papers\PaperDesk"`，或设置用户环境变量 `PAPERDESK_HOME` 为绝对目录。不要指定整个盘符根目录。

## 从源码首次安装

1. 将完整源码解压到本地一个普通目录。源码目录不能与安装目标 `D:\PaperDesk\app` 重叠。
2. 安装官方 [Node.js 24 LTS](https://nodejs.org/)；源码压缩包安装不需要 Git。无需购买任何服务。
3. 双击 `scripts\windows\Setup-PaperDesk.cmd`。它在本机运行 `npm ci`、构建 Windows 程序、复制到 D 盘并创建桌面快捷方式。首次安装需要网络下载锁定依赖与 Electron；下载和构建失败时会停止，不会转用云端服务。
4. 安装脚本不会覆盖已有程序。之后更新按下面的校验更新流程执行。

也可从 PowerShell 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Setup-PaperDesk.ps1 -BuildFromSource
```

交付的 Windows ZIP 包含 `win-unpacked` 程序目录和 `scripts/windows` 辅助脚本。解压后，Windows 上无需 Node.js 即可运行打包程序；使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Setup-PaperDesk.ps1 -AppDirectory "D:\Downloads\PaperDesk\win-unpacked"
```

这一步只接受包含 `PaperDesk.exe` 的独立版目录。不会连接或安装上游 PaperQuay 的发行版。辅助脚本也包含在程序的 `resources\windows-tools` 目录中。本次交付使用 ZIP；未交付已验证的 NSIS 安装器。

## 本地 AI 首次准备

1. 从 [Ollama 官方网站](https://ollama.com/)自行安装 Ollama。工作站不自动下载执行第三方安装器。
2. 双击桌面 `PaperDesk - Local Model`。默认下载 `qwen3:4b`。脚本设置本地服务只监听 `127.0.0.1:11434`，模型位置为 `D:\PaperDesk\models`。
3. 如果 Ollama 安装后已经启动，请先从托盘退出并停止它的后台服务，再运行本地模型快捷方式，确保服务器读取新的模型目录。脚本会明确提示这个条件。
4. 第一次模型下载需要网络和数 GB 磁盘，之后推理使用本机硬件，无 API 账单。此脚本拒绝名称中显式标为 cloud 的模型；请选择本地下载模型。不要把 Ollama 改为云模型转发服务。

32GB 内存和 RTX 3060 可先使用 4B 本地模型。具体显存与长文长度影响速度和模型大小，不能承诺与云端大模型相同的理解质量。模型不可用时仍可阅读、批注和编辑笔记。

扫描件 OCR 另需本机 Python、PyMuPDF 和 Tesseract；见 [LOCAL_OCR.md](LOCAL_OCR.md)。普通文本 PDF 无需这个可选组件。

## 快捷方式

- `PaperDesk`：启动程序；键盘 `Ctrl+Alt+L`。可启动已安装的 Ollama 本地服务，不下载模型。
- `PaperDesk - Update`：人工选择本版本安装包并校验更新；键盘 `Ctrl+Alt+U`。
- `PaperDesk - Backup`：关闭工作站后备份数据库、管理的文献、笔记及解析缓存（可能包含批注历史）。
- `PaperDesk - Restore`：选择备份恢复，恢复前先备份当前状态。
- `PaperDesk - Local Model`：首次下载或显式刷新本地模型。

快捷键是否被其他软件占用，需在你的 Windows 上确认，可在 `.lnk` 属性中修改。部分系统会禁止 PowerShell 脚本执行；快捷方式仅为当前已审阅脚本调用设置进程级策略，不修改系统策略。组织策略的限制需要遵从组织管理员设置。

## 更新与数据保留

更新包由[本仓库 GitHub Releases](https://github.com/kangweihou522-cmyk/KW-/releases)提供。`Update` 快捷方式要求选择本独立版的 **PaperDesk Windows `.zip` 更新包及对应 SHA256**，不自动安装上游版本。已有安装直接校验更新，不要重复首次安装；更新后标题栏显示版本号。正确启动入口为 `D:\PaperDesk\tools\Start-PaperDesk.ps1`，实际程序为 `D:\PaperDesk\app\PaperDesk.exe`。

校验不符会停止。匹配后先检查 ZIP 每个条目，拒绝绝对路径、`..`、备用数据流、重复路径和符号链接，再解压到根目录下独立临时文件夹；只有恰好一个 `PaperDesk.exe` 且包含 `resources/app.asar` 和辅助脚本目录时才继续。随后备份资料，把旧程序移到 `backups/app-before-update-*`，复制新程序，保留旧版供恢复。更新失败会尝试回滚旧程序和辅助脚本，并显示备份位置；不执行 ZIP 内脚本来安装。程序目录与文献数据库分开，保留数据不代表永远无须备份。

新备份格式 v2 包含 `data`、`library`、`notes` 和 `cache`，以保留解析结果、批注及阅读历史；不复制可重新下载的 `models`。恢复兼容旧 v1 备份，但旧备份不含根目录 `cache`，恢复时保留现有该目录并给出提示。

备份只包含根目录内管理的资料。若选择“保留原路径”导入位于别处的 PDF，必须另行备份那些原始文件。恢复到不同盘符或目录后，要在文献设置里核对附件路径。备份、恢复和更新前关闭程序；从源码开发运行的 Electron 也应退出。

## 当前验证范围

Windows 路径选择和更新隔离已经通过跨平台 Node 测试；PowerShell 脚本按 Windows PowerShell 5.1 语法编写并保存 UTF-8 BOM。当前开发机是 Linux，尚未在你的 Windows 电脑执行安装、快捷键和恢复操作，因此不将这些步骤标为已在 Windows 实测。

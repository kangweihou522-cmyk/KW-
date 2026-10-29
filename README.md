# PaperDesk 本地文献工作站

基于 PaperQuay 的独立修改版，针对 Windows 11、D 盘部署和本地文献阅读。默认使用独立的离线英中翻译，首次下载语言包后无需账号或在线配额。ChatGPT/Codex 连接和 Ollama 均为可选功能。文献、笔记、批注、解析缓存和可选模型默认保存在 `D:\PaperDesk`。不配置按量计费 API，不购买额外额度。

## 安装和启动

完整 Windows 压缩包解压到下载目录，双击根目录的 `安装到D盘.cmd`。程序复制到 `D:\PaperDesk\app`，资料保存在根目录内独立文件夹。不要在压缩软件内直接运行。安装不会覆盖已有 PaperDesk，后续走校验更新流程。

- 启动：桌面 PaperDesk，键盘 **Ctrl+Alt+L**。
- 更新：桌面 PaperDesk - Update，键盘 **Ctrl+Alt+U**。选择本独立版本安装器及可信来源 SHA256，先备份再安装，不更新回上游。
- 离线翻译：在 PDF 右侧翻译栏下载一次英中语言包，不需要安装 Python 或 Ollama。程序自带专用运行组件，语言包独立保存在 `models\translation`，之后更新程序可继续复用。
- 可选本地大模型：从 [Ollama 官网](https://ollama.com/)自行安装；已有模型继续保留。默认阅读和离线划词翻译不启动它。
- 扫描件：额外准备本机 Python、PyMuPDF 和 Tesseract；见 [本地 OCR](docs/LOCAL_OCR.md)。文本 PDF 无需这些组件。

完整步骤和数据恢复：[Windows 说明](docs/WINDOWS.md)。当前开发机无法直接写入你电脑的 D 盘，Windows 安装和快捷键需在本机执行核实。

## 文献阅读流程

1. 拖入 PDF，确认或编辑标题、作者、年份、期刊、DOI。本地模式不自动联网补全文献信息。
2. 分类、标签、收藏；PDF 高亮、批注、阅读位置与自由笔记复用成熟上游功能。
3. 关联 PDF、TXT、Markdown、CSV、XLSX 补充文件，区分附件保管与实际分析范围。
4. 文库“概览生成”打开文献助手。已有报告直接读取本地笔记。自动生成是可选功能，需要先通过官方 Codex 授权；网页 ChatGPT 能登录不代表这一授权能通过，服务方可能要求手机号验证。授权成功且账户有可用额度时，可以一键生成 200–300 字梗概及七部分报告：**背景与问题、试验方法设计、数据分析处理、主要结果与证据、讨论整合、主要结论、证据评价及局限**。
5. 报告自动保存为可编辑的本地笔记。同一文献复用同一份报告，以后阅读编辑不需要再次请求 ChatGPT；重新生成需明确操作。关键判断要求页码/图表/文件名，材料不足标为未报告；仍需人工核查。
6. 设置内导入导出 EndNote XML/RIS；不直接改 `.enl`，不承诺实时双向同步或无损迁移批注。
7. 导入已有年度期刊指标 JSON/CSV，保留来源、年度、学科、影响因子、JCR/中科院分区，缺失保持未知。完整权威最新指标没有免费内置，不能离线获取新出版数据。

示例和支持范围见 [数据交换](docs/REFERENCE_EXCHANGE.md)。内置解析以文字为主，保留版式的双语 PDF 输出尚未在本独立版本验证。图表、公式和复杂科学判断请核查原文。

## ChatGPT 接入和划词翻译

PaperDesk 不要求登录 Codex。顶部“ChatGPT 网页”可打开正常网页，继续使用自己的 Google 等登录方式聊天、写作和分析；这一入口不会自动上传或读取本地文献。自动报告和问答目前采用官方 Codex 授权，不需要另装 Codex 桌面客户端，但服务方可能要求手机号。工作站不能取消这项验证，设备码也不保证免验证。具体差异见 [账户连接说明](docs/CHATGPT_CONNECTION.md)。备用手动网页回填保留，但不等同于自动连接已经完成。

Plus/普通账户不附带工作站可直接调用的免费无限 API。本版通过 OpenAI 官方 Codex 通道使用账户的套餐内额度；权限与限额由服务端决定，免费账户不保证长期可用。服务端无法确认套餐内额度或额度已满时停止，不购买额度、不凭付费信用余额继续，不调用付费 API。取消 Plus 不影响已保存的文献、报告、笔记和批注；新的在线请求取决于当时账户权限。

默认离线划词翻译：下载一次英中语言包后，划选结束自动打开右侧译文栏，分句更新译文并缓存，取消旧选区请求。翻译在本机 CPU 上运行，不发送选中文字，不需要 ChatGPT、Codex、API 密钥或 Ollama；目前只支持英语 → 中文，不承诺零延迟或科研质量等同 ChatGPT。首次下载需要网络。详见 [离线翻译](docs/OFFLINE_TRANSLATION.md)。

在线渠道仍可显式选择，首次开启一次后不再逐次确认。可选 DeepL API Free 需要自己的免费密钥，有月度额度，仅调用官方免费端点并使用系统安全存储；不会转向付费 Pro。MyMemory 仅为低配额备用。离线翻译的启用不会替用户开启在线文字发送。

高亮操作：先点“高亮”或按 H，再连续划选；选择颜色后继续标记。Esc 返回选择，T 添加文本批注，Ctrl+S 保存为独立批注版 PDF；原始文献保留。

后端模型接口仍限制为本机地址；官方账户连接由独立 Codex 进程管理，划词翻译仅有明确的固定服务端点，渲染器不加载远程资源。图像、复杂公式和扫描页的可靠理解不在当前文字提取范围内，报告会说明限制。Windows 授权回调及真实科研质量需本机验收。

## 源码开发

Node.js 24，使用现有仓库，无须另建 Git worktree：

```sh
npm ci
npm run build
npm test
npm run dev
```

Windows 源码安装双击 `scripts/windows/Setup-PaperDesk.cmd`；手工打包 `npm run package:windows`，会按固定校验值准备自带的 Windows Python/翻译组件。开发环境的离线翻译使用 Python 3.12 虚拟环境安装 `scripts/translation/requirements.txt`，并将 `PAPERDESK_TRANSLATION_PYTHON` 指向该环境解释器。首次安装下载依赖与 Electron，保留 TLS、官方校验。可用绝对路径环境变量 `PAPERDESK_HOME` 指定测试目录。

## 来源和验证

基于 [PaperQuay](https://github.com/WangQrkkk/PaperQuay) commit `1d65fdbfe0eb7ef33c57cf8b9d87b6afdb5f06bf`，AGPL-3.0-only。保留原许可证，独立品牌不代表上游官方。修改见 [UPSTREAM.md](UPSTREAM.md)，原文档在 `docs/UPSTREAM_README*.md`。

验证记录：[VALIDATION.md](docs/VALIDATION.md)。Windows 包由 Linux 跨平台构建，不等同于已在你的 Windows 硬件验收；模型接口以本机模拟服务验证，真实模型质量需安装后核查。

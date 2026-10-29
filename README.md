# PaperDesk 本地文献工作站

基于 PaperQuay 的独立修改版，针对 Windows 11、D 盘部署和无需 Plus 的本地文献阅读。默认采用 ChatGPT 账户浏览器授权接入，Ollama 为可选功能。文献、笔记、批注、解析缓存和可选模型默认保存在 `D:\PaperDesk`。不配置按量计费 API，不购买额外额度。

## 安装和启动

完整 Windows 压缩包解压到下载目录，双击根目录的 `安装到D盘.cmd`。程序复制到 `D:\PaperDesk\app`，资料保存在根目录内独立文件夹。不要在压缩软件内直接运行。安装不会覆盖已有 PaperDesk，后续走校验更新流程。

- 启动：桌面 PaperDesk，键盘 **Ctrl+Alt+L**。
- 更新：桌面 PaperDesk - Update，键盘 **Ctrl+Alt+U**。选择本独立版本安装器及可信来源 SHA256，先备份再安装，不更新回上游。
- 本地模型：从 [Ollama 官网](https://ollama.com/)自行安装，再运行 PaperDesk - Local Model 下载 `qwen3:4b`。首次联网下载数 GB，之后推理在本机。已运行的 Ollama 需先退出才能应用 D 盘模型目录。
- 扫描件：额外准备本机 Python、PyMuPDF 和 Tesseract；见 [本地 OCR](docs/LOCAL_OCR.md)。文本 PDF 无需这些组件。

完整步骤和数据恢复：[Windows 说明](docs/WINDOWS.md)。当前开发机无法直接写入你电脑的 D 盘，Windows 安装和快捷键需在本机执行核实。

## 文献阅读流程

1. 拖入 PDF，确认或编辑标题、作者、年份、期刊、DOI。本地模式不自动联网补全文献信息。
2. 分类、标签、收藏；PDF 高亮、批注、阅读位置与自由笔记复用成熟上游功能。
3. 关联 PDF、TXT、Markdown、CSV、XLSX 补充文件，区分附件保管与实际分析范围。
4. 文库“概览生成”打开工作台，点击“浏览器授权连接 ChatGPT”，完成官方 Codex 网页授权。无需安装或登录 Codex 桌面客户端。之后一键读取论文和补充材料文字，生成 200–300 字梗概及七部分报告：**背景与问题、试验方法设计、数据分析处理、主要结果与证据、讨论整合、主要结论、证据评价及局限**。
5. 报告自动保存为可编辑的本地笔记。同一文献复用同一份报告，以后阅读编辑不需要再次请求 ChatGPT；重新生成需明确操作。关键判断要求页码/图表/文件名，材料不足标为未报告；仍需人工核查。
6. 设置内导入导出 EndNote XML/RIS；不直接改 `.enl`，不承诺实时双向同步或无损迁移批注。
7. 导入已有年度期刊指标 JSON/CSV，保留来源、年度、学科、影响因子、JCR/中科院分区，缺失保持未知。完整权威最新指标没有免费内置，不能离线获取新出版数据。

示例和支持范围见 [数据交换](docs/REFERENCE_EXCHANGE.md)。内置解析以文字为主，保留版式的双语 PDF 输出尚未在本独立版本验证。图表、公式和复杂科学判断请核查原文。

## ChatGPT 接入和划词翻译

在工作站的文献助手中点击“浏览器授权连接 ChatGPT”，只需在系统浏览器完成官方授权，不要求登录 Codex 桌面客户端。之后直接在工作站生成报告或提问，自动读取已登记论文及补充材料的可提取文字，并将报告保存在本地。备用手动网页回填仍可使用。

Plus/普通账户不附带工作站可直接调用的免费无限 API。本版通过 OpenAI 官方 Codex 通道使用账户的套餐内额度；权限与限额由服务端决定，免费账户不保证长期可用。服务端无法确认套餐内额度或额度已满时停止，不购买额度、不凭付费信用余额继续，不调用付费 API。取消 Plus 不影响已保存的文献、报告、笔记和批注；新的在线请求取决于当时账户权限。

在右侧翻译栏首次开启划词自动翻译后，选中文字就会自动显示译文；先显示进度并流式更新，实际速度取决于服务，无法保证零延迟。仅选中文字发送给所选渠道，译文缓存在本地，旧选区请求会取消。可选 DeepL API Free 需要自己的免费密钥，有月度额度，仅调用官方免费端点并使用系统安全存储；不会转向付费 Pro。MyMemory 仅为低配额备用。不要提交无权上传或需保密的材料。

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

Windows 源码安装双击 `scripts/windows/Setup-PaperDesk.cmd`；手工打包 `npm run package:windows`。首次安装下载依赖与 Electron，保留 TLS、官方校验。可用绝对路径环境变量 `PAPERDESK_HOME` 指定测试目录。

## 来源和验证

基于 [PaperQuay](https://github.com/WangQrkkk/PaperQuay) commit `1d65fdbfe0eb7ef33c57cf8b9d87b6afdb5f06bf`，AGPL-3.0-only。保留原许可证，独立品牌不代表上游官方。修改见 [UPSTREAM.md](UPSTREAM.md)，原文档在 `docs/UPSTREAM_README*.md`。

验证记录：[VALIDATION.md](docs/VALIDATION.md)。Windows 包由 Linux 跨平台构建，不等同于已在你的 Windows 硬件验收；模型接口以本机模拟服务验证，真实模型质量需安装后核查。

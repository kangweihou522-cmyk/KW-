# PaperDesk 本地文献工作站

基于 PaperQuay 的独立修改版，针对 Windows 11、D 盘部署和无需 Plus 的本地文献阅读。文献、笔记、批注、解析缓存和模型默认保存在 `D:\PaperDesk`。不配置按量计费 API，不购买额外额度。

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
4. 本地模型进行划词/全文文本翻译、问答和七部分读书报告：**背景与问题、试验方法设计、数据分析处理、主要结果与证据、讨论整合、主要结论、证据评价及局限**。
5. 将报告保存为可编辑的本地笔记。关键判断要求页码/图表/文件名，材料不足标为未报告；仍需人工核查。
6. 设置内导入导出 EndNote XML/RIS；不直接改 `.enl`，不承诺实时双向同步或无损迁移批注。
7. 导入已有年度期刊指标 JSON/CSV，保留来源、年度、学科、影响因子、JCR/中科院分区，缺失保持未知。完整权威最新指标没有免费内置，不能离线获取新出版数据。

示例和支持范围见 [数据交换](docs/REFERENCE_EXCHANGE.md)。内置解析以文字为主，保留版式的双语 PDF 输出尚未在本独立版本验证。图表、公式和复杂科学判断请核查原文。

## ChatGPT 和取消 Plus

可选网页辅助：复制提问材料，在浏览器主动附上 PDF/补充材料，粘贴回答后保存为本地笔记。普通账户也能使用此流程，具体网页额度由账户决定。打开网页不会自动上传文献。

本版未实现 ChatGPT 自动账户调用、Codex OAuth 或付费 OpenAI API。取消 Plus 不影响本地资料或准备好的本地模型。无模型时仍可阅读、标记和编辑笔记；AI 功能明确报未准备，不伪造完成或转收费接口。

32GB 内存、RTX3060 建议先用 4B 量化模型。长文分段提取证据后汇总，文本、译文和报告缓存复用。小模型复杂理解质量不保证与较强云端模型相同。

后端和渲染器阻止远程 HTTP 请求，模型只接受本机回环地址。本版不自动联网查询期刊网站、Zotero 云和 WebDAV；可导入本地 Zotero 库。知云作为外部阅读器保留使用，未接其专有接口。

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

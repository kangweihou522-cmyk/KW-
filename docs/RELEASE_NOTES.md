# PaperDesk 0.2.0

独立本地文献阅读工作站，基于 AGPL-3.0-only 的 PaperQuay 修改。

下载 `PaperDesk-0.2.0-Windows.zip`，完整解压后双击“安装到D盘.cmd”，默认安装到 `D:\PaperDesk`。提供启动、校验更新、备份恢复快捷方式；启动键 Ctrl+Alt+L，更新键 Ctrl+Alt+U。

本地翻译与七部分报告需自行安装免费 Ollama 并下载 qwen3:4b。第一次模型下载需要网络与磁盘空间；后续推理使用本机硬件，不使用付费 API。扫描件另需本机 Python/PyMuPDF/Tesseract。ChatGPT 是用户主动网页提交和回填的可选辅助，取消 Plus 不影响本地功能。

包含文献库、PDF 批注、自由笔记、自动本地解析与报告、补充材料、EndNote XML/RIS 交换、年度期刊指标导入。未内置权威最新 SCI/JCR/中科院全量数据，缺失指标保持未知。

公开仓库的标准 GitHub runner 生成此下载；仓库变为私有时自动发布任务不会运行。源代码 ZIP 与校验文件同时提供，保留 AGPL 许可证和原作者声明。

已在 Linux 完成构建、217 项测试、英文 OCR 和桌面工作流验证，报告链路使用本机模拟模型。Windows 安装、快捷键和真实本地模型推理仍需在 Windows 本机验收。详细范围见压缩包内 docs/VALIDATION.md。

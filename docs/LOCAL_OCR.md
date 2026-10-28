# 本地扫描件 OCR

普通可选中文字的 PDF 使用内置 PDF.js，无需 Python。扫描件及混合扫描页使用本机 OCR，不调用云服务。

Windows 首次准备：

1. 安装 Python 3.11 或更新版本并启用 PATH；在源码目录执行 `python -m pip install -r scripts/ocr/requirements.txt`。
2. 通过 [Tesseract 官方项目](https://github.com/tesseract-ocr/tesseract#installing-tesseract)列出的 Windows 安装来源安装 Tesseract。请核验安装来源及发布方提供的校验信息；工作站不自动下载执行第三方安装器。
3. 将安装目录加入 PATH，或设置用户环境变量 `PAPERDESK_TESSERACT` 为 `tesseract.exe` 的完整路径。
4. 英文默认使用 `eng` 语言包；中文扫描件需在 Tesseract 本地数据目录安装官方 `chi_sim.traineddata`，使用 `chi_sim+eng`。安装过程需联网下载，OCR 运行可离线。
5. 如 Python 不在 PATH，设置 `PAPERDESK_PYTHON` 为 `python.exe` 的完整路径。

检查：`tesseract --list-langs`，以及 `python scripts/ocr/ocr_pdf.py --pdf "D:\PaperDesk\library\example.pdf"`。输出为带页码的 JSON 文本；中间页面图片存于临时目录，用完删除。

OCR 不会可靠理解图表、手写内容或复杂公式。报告应核对原 PDF；没有识别结果时程序报错，不会生成伪造报告。每页最多处理 120 秒，整篇任务默认上限 10 分钟。

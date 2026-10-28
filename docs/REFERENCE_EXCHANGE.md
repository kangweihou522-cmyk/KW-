# 本地文献交换与期刊指标

设置 → 文库 → 文献交换，或者文献详情中的年度期刊指标“导入 / 管理”。

## EndNote

在 EndNote 导出 EndNote XML 或 RIS，保留原文献库。将文件内容粘贴进导入窗口，或通过本地文件选择导入；可指定原库 `.Data/PDF` 目录来解析 `internal-pdf://` 附件引用。程序复制能定位的本地 PDF，不修改原 `.enl`，不下载远程附件。缺失附件显示警告；按 DOI（或标题和年份）去重。导出可生成 XML/RIS，供 EndNote 再导入；原 PDF 内全部批注的无损往返没有保证。

## 年度期刊指标

可输入 JSON 数组或 CSV。下方为格式示例，Example Journal 为虚构期刊，未知指标用 null/空白，不代表真实数据：

```json
[
  {
    "journal": "Example Journal",
    "issn": null,
    "year": 2025,
    "source": "用户已有数据表，版本与获取日期另行注明",
    "category": "示例学科",
    "impactFactor": null,
    "jcrQuartile": null,
    "casPartition": null
  }
]
```

CSV 表头：`journal,issn,year,source,category,impactFactor,jcrQuartile,casPartition`。JCR 使用 Q1–Q4，中科院分区使用 1–4，影响因子为非负数；缺失留空。年度和来源必填，支持同一期刊多个年度/学科/来源，不互相覆盖。指标保存于本地 data/journal-metrics.json，并由本地备份一起保护。

本模块不含官方 JCR 或中科院数据库，也不把 SJR 当成 JCR 或由 AI 猜指标。SCI 收录与两种分区是不同概念；当前未内置自动核实 SCI 收录资格的数据库，可在笔记中记录核实来源。

## 补充材料

文献详情添加补充材料，复制到同一文献的 supplements 子目录。PDF/TXT/Markdown/CSV 可参与报告分析，CSV 用行号引用，PDF 用文件名和页码。XLSX 当前可以归档和使用本机表格软件打开，但不自动当作已分析；报告明确注明未覆盖，建议先在本地导出 CSV 后添加。大文件/无法读取文件及 OCR 失败均需检查报告的范围说明。主 PDF 不会被附录替换。

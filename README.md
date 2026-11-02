# PaperDesk 本地文献工作站

基于PaperQuay的独立修改版，面向Windows 11、本地文库和D盘部署。文献、附件、报告、笔记、批注和翻译缓存保存在本机；已有内容可离线阅读与编辑。0.5.0支持快速英中翻译和Hy-MT2专用离线翻译，ChatGPT套餐、免费模型报告及在线翻译均为可选功能。

## 安装与更新

从[本项目发行版](https://github.com/kangweihou522-cmyk/KW-/releases)下载Windows ZIP及同版SHA256。首次安装解压后运行“安装到D盘.cmd”，默认 `D:\PaperDesk`；其他位置可显式设置 `PAPERDESK_HOME`。资料位于程序目录外。

已有安装：保存并退出PaperDesk，点击桌面 **PaperDesk - Update**（Ctrl+Alt+U），自动检查、下载、校验、备份并安装新版，保留文献、附件、笔记、批注、模型和缓存。已是最新版时不重复下载。PowerShell也可直接运行 `tools\Update-PaperDesk.ps1`。0.5.0及更早版本先按[更新说明](docs/UPDATES.md)升级一次更新入口。不要重复执行首次安装脚本。

**更新约定：以后不再要求已安装用户手动下载ZIP、寻找文件路径或填写SHA256；统一使用桌面快捷方式或PowerShell自动更新。**

详见[Windows说明](docs/WINDOWS.md)。程序无法替你直接操作个人电脑的D盘。

## 阅读与整理

- PDF默认单栏放大阅读，控制集中在顶部。页码、缩放、高亮和保存常用；进度点开才显示，其他批注工具收在菜单中。可切换双栏对照。
- 右侧为实时翻译、笔记、文献概览。划选后自动显示译文，原文可折叠；侧栏可调宽或收起。
- 先点高亮或按H，再连续划选。T添加文本批注，Esc返回选择，Ctrl+S保存独立批注版PDF；原PDF保留。
- 我的文献概览包含团队简介、摘要和可自定义栏目。无需AI即可编辑保存；支持草稿、版本恢复和冲突保护。
- 文献报告支持200–300字梗概、七部分报告和自定义部分，标题/内容均可逐部分编辑。已保存报告从本地读取；主动再次生成才使用模型，并保留旧版本与恢复副本。
- 复用现有分类、标签、引用定位和笔记编辑器；支持补充材料、EndNote XML/RIS与年度期刊指标导入，详见[数据交换](docs/REFERENCE_EXCHANGE.md)。

## 翻译与报告渠道

默认的快速离线英中包约68MiB。可在右侧改选 **Hy-MT2-1.8B Q4_K_M**，首次下载约1.13GB，随后本机翻译；自带CPU/Vulkan组件，无需安装Python或Ollama。科研术语表可本地编辑。两个引擎及旧模型同时保留，详见[离线翻译说明](docs/OFFLINE_TRANSLATION.md)。

自动报告优先使用 **Continue with ChatGPT** 官方开源本地应用授权，运行时无需Codex或API密钥。授权后读取账户实际可用模型，单独测试完整推理。账户资格、地区、手机号、套餐额度由OpenAI决定，网页已登录不代表已授权工作站。

可选 **OpenRouter免费模型** 报告，只允许免费路由及零标价`:free`模型，不自动换收费模型；自动备用开关默认关闭。在线划词还可选择DeepL API Free、百度或低配额MyMemory。在线渠道会收到明确提交的文字，需你主动启用；密钥通过系统安全存储加密。申请与使用见[账户与报告说明](docs/CHATGPT_CONNECTION.md)。

本地存储、普通阅读、笔记与报告编辑不依赖任何账户。Ollama仍为可选本机模型服务。扫描页OCR额外依赖见[本地OCR](docs/LOCAL_OCR.md)；图像、复杂公式和无法提取的材料不会声称已完整分析。

## 开发与验证

Node.js 24：`npm ci`、`npm run build`、`npm test`。桌面运行 `npm run dev`。Windows打包 `npm run package:windows`，按固定SHA256准备离线组件；公开仓库使用标准免费runner验证真实翻译、实际桌面与打包程序。

验证记录见[VALIDATION.md](docs/VALIDATION.md)。Windows runner结果不代替你的RTX3060实测或真实科研审读，也不代表你的个人账户已通过授权。

基于[PaperQuay](https://github.com/WangQrkkk/PaperQuay) commit `1d65fdbfe0eb7ef33c57cf8b9d87b6afdb5f06bf`，AGPL-3.0-only。保留原许可证与上游资料，独立品牌不代表上游官方。来源见[UPSTREAM.md](UPSTREAM.md)。

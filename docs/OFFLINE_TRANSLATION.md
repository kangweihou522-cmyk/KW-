# 离线划词翻译

使用 Argos 的英语 → 中文专用机器翻译模型，通过 CTranslate2 CPU int8 推理，SentencePiece 分词，pySBD 分句。它不运行 Ollama，不需要 ChatGPT、Codex、API 密钥或海外手机号，也没有在线翻译配额。不是通用大模型，不能代替文献分析或自动生成报告。

Windows 更新包自带独立 Python 和翻译运行组件，不改动系统 Python。打开 PDF 右侧“翻译”，选择“离线专用翻译”，点击“下载并启用英中翻译”。英中语言包约 68 MB，首次下载需要网络；校验与安装成功后，划选结束自动展开右侧译文栏，按句更新并将结果缓存到本地。

语言包保存在 `D:\PaperDesk\models\translation\argos-en-zh-1.9`，位于可替换的 `app` 之外。更新程序保留已有包；不重新下载 Ollama 模型。译文缓存位于 `data\.selection-translations`，再次阅读可以复用。离线翻译不要求在线发送同意；切换到在线渠道仍需要显式开启。

当前只支持英语 → 中文。输入最多 40000 字符，长句按完整分词序列拆块，避免引擎默认输入长度造成静默截断。PDF 换行做基本整理，段落分隔保留；内置有限的源文触发科研术语校正，不保证覆盖全部领域。复杂公式、术语、数字和统计结论仍需人工核对。速度取决于句长和 CPU，不承诺零延迟或等同 ChatGPT 的科研翻译质量。

安装只接受固定来源、固定版本及 SHA256 的语言包。先校验下载，再检查 ZIP 路径和所需组件，最后替换独立语言包目录；失败保留原有模型。运行中分句检查取消标记，旧请求不能覆盖新选区。翻译进程不含网络、账户登录或命令工具。

开发与来源：

- [Argos Translate](https://github.com/argosopentech/argos-translate) 与[官方语言包索引](https://github.com/argosopentech/argospm-index)。原始 OPUS 模型为 CC BY 4.0；原包不改动地发布，安装保留原始 README。作者 Jörg Tiedemann、Santhosh Thottingal 及 EAMT 2020 论文署名与许可链接见 `packaging/MODEL-EN-ZH-NOTICE.txt` 和运行目录 `MODEL-LICENSE.txt`。
- [CTranslate2](https://github.com/OpenNMT/CTranslate2)、[SentencePiece](https://github.com/google/sentencepiece)、[pySBD](https://github.com/nipunsadvilkar/pySBD)。运行包包含各组件随发行物提供的许可证，固定工件来源与哈希见 `packaging/offline-translation-lock.json`。
- Linux 开发先创建 Python 3.12 虚拟环境，安装 `scripts/translation/requirements.txt`，设置 `PAPERDESK_TRANSLATION_PYTHON` 为其绝对解释器路径。Windows 包由官方 Python Software Foundation NuGet 包与 PyPI Windows wheels 组装，各文件在解包前按锁定 SHA256 校验。

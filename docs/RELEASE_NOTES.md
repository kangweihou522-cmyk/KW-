# PaperDesk 0.5.1：桌面与PowerShell自动更新

保存并退出PaperDesk，点击桌面 **PaperDesk - Update**（Ctrl+Alt+U），自动检查最新版、下载、校验、备份并安装。PowerShell直接运行同一个更新脚本即可，不再要求手动下载ZIP、填写文件路径或复制SHA256。

- 已是最新版时不重复下载，禁止降级，只接受本项目的正式发行渠道。
- 自动校验文件大小、SHA256清单及GitHub资产摘要，再验证ZIP路径和完整结构。
- 保留文献、附件、笔记、批注、设置与翻译模型；安装前备份，更新中失败回滚旧程序与工具。
- 更新任务互斥，下载临时文件自动清理；桌面快捷方式名称与按键保持一致。
- 保留0.5.0的阅读界面、个人概览、报告版本、Hy-MT2翻译及官方ChatGPT授权功能。

## 今后的固定PowerShell命令

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\PaperDesk\tools\Update-PaperDesk.ps1" -Root "D:\PaperDesk"
```

其他安装位置替换两处路径。不要重复运行首次安装脚本。

## 旧版本迁移

0.5.0及更早版本需要先升级一次旧的更新脚本。一次性PowerShell迁移代码在本页下方提供，自动完成，不需要手动下载更新包。以后直接使用原桌面快捷方式或上面的命令。

完整说明见[自动更新](https://github.com/kangweihou522-cmyk/KW-/blob/main/docs/UPDATES.md)。

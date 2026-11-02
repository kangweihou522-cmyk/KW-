# PaperDesk自动更新

以后已安装用户统一使用桌面 **PaperDesk - Update** 或PowerShell更新，不再要求手动下载ZIP、选文件、填写SHA256或重新安装。

## 日常更新

先保存笔记、PDF批注并退出PaperDesk，然后：

- 双击桌面 **PaperDesk - Update**，或按Ctrl+Alt+U。
- 或在PowerShell执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\PaperDesk\tools\Update-PaperDesk.ps1" -Root "D:\PaperDesk"
```

如果安装在其他目录，替换两处安装路径。

工具会自动检查本项目的正式发行版，有新版才下载；随后核对文件大小、SHA256清单和GitHub资产摘要，验证包结构，备份资料，再替换程序和更新辅助脚本。程序、资料分开保管，文献、附件、笔记、批注、账号设置与模型保留。已是最新版不重复下载，不降级，不安装其他仓库的程序。

更新失败保留或恢复旧程序，可以重新点击同一个更新入口。下载临时文件自动清理，无需自己管理压缩包。不要在PaperDesk仍运行时更新，不会强制结束程序或跳过未保存内容。

## 0.5.0及更早版本的一次性迁移

旧桌面快捷方式调用的是旧的本地脚本，不会自行取得新逻辑。首次使用[0.5.1发布页](https://github.com/kangweihou522-cmyk/KW-/releases/tag/paperdesk-v0.5.1)给出的一次性PowerShell代码，自动升级更新入口并立即更新程序；不需要手动下载更新包。

完成后仍然使用原来的桌面快捷方式或上面的一条固定命令。今后不再重复运行迁移代码。

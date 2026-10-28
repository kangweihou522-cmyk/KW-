import { SettingsField } from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

interface ReaderPreferencesBackupSectionProps { active: boolean; l: ReaderPreferencesLocalizer; }

export function ReaderPreferencesBackupSection({ active, l }: ReaderPreferencesBackupSectionProps) {
  if (!active) return null;
  return <SettingsField label={l('本地备份与恢复', 'Local backup & restore')} description={l('通过安装时创建的桌面快捷方式操作。备份保存在工作站目录内，不上传到云端。', 'Use the desktop shortcuts created by setup. Backups stay in the workstation folder and are not uploaded.')}>
    <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-[var(--pq-text-muted)]">
      <li>{l('先保存笔记并关闭工作站，再双击桌面的“PaperDesk - Backup”。', 'Save your notes, close the workstation, then open the “PaperDesk - Backup” desktop shortcut.')}</li>
      <li>{l('备份默认位于工作站根目录的 backups 文件夹。请定期另存到你自己的移动硬盘。', 'Backups default to the backups folder inside your workstation root. Periodically copy them to your own external drive.')}</li>
      <li>{l('恢复前关闭工作站，打开“PaperDesk - Restore”，选择并核验本地备份。恢复会替换工作站数据，请先保留当前版本的备份。', 'Close the workstation before opening “PaperDesk - Restore”. Select and verify your local backup. Restore replaces workstation data; keep a current backup first.')}</li>
    </ol>
    <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-900">{l('程序更新与文献数据分开。使用“保留原路径”导入的文件可能在工作站目录外，请单独备份这些原文件；EndNote 原库也需要由你单独备份。', 'Program updates are separate from library data. Keep-path files may live outside the workstation folder and need their own backups; back up the original EndNote library separately too.')}</p>
  </SettingsField>;
}

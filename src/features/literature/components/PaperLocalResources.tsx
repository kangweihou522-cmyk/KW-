import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { invoke } from '../../../platform/electron/core';
import { selectChatAttachmentPaths } from '../../../services/desktop';
import { addPaperSupplements, removePaperSupplement } from '../../../services/referenceExchange';
import type { LiteratureAttachment, LiteraturePaper } from '../../../types/library';

export default function PaperLocalResources({ paper }: { paper: LiteraturePaper }) {
  const l = useLocaleText();
  const [supplements, setSupplements] = useState<LiteratureAttachment[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSupplements(paper.attachments.filter(attachment => attachment.kind === 'supplement')); }, [paper.id, paper.attachments]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{l('补充材料', 'Supplementary materials')}</h3><button type="button" disabled={busy} aria-label={l('添加补充材料', 'Add supplementary materials')} title={l('添加补充材料', 'Add supplementary materials')} onClick={() => void run(async () => { const paths = await selectChatAttachmentPaths('file'); if (!paths.length) return; const updated = await addPaperSupplements(paper.id, paths); setSupplements(updated.attachments.filter(attachment => attachment.kind === 'supplement')); })} className="pq-icon-button h-7 w-7 text-[var(--pq-accent)]"><Plus className="h-4 w-4" /></button></div>
    {supplements.length ? <ul className="space-y-1">{supplements.map(attachment => <li key={attachment.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--pq-border)] px-2 py-1.5"><button type="button" disabled={busy} className="min-w-0 flex-1 truncate text-left text-xs hover:text-[var(--pq-accent)]" title={l(`打开 ${attachment.fileName}`, `Open ${attachment.fileName}`)} aria-label={l(`打开 ${attachment.fileName}`, `Open ${attachment.fileName}`)} onClick={() => void run(async () => { await invoke('open_library_attachment', { paperId: paper.id, attachmentId: attachment.id }); })}>{attachment.fileName}</button><button type="button" disabled={busy} title={l('打开所在文件夹', 'Show in folder')} aria-label={l(`打开所在文件夹：${attachment.fileName}`, `Show in folder: ${attachment.fileName}`)} onClick={() => void run(async () => { await invoke('open_library_attachment', { paperId: paper.id, attachmentId: attachment.id, reveal: true }); })} className="pq-icon-button h-7 w-7 shrink-0"><FolderOpen className="h-3.5 w-3.5" /></button><button type="button" disabled={busy} title={l('移除补充材料（保留本地文件）', 'Remove supplementary material (keep local files)')} aria-label={l(`移除补充材料：${attachment.fileName}`, `Remove supplementary material: ${attachment.fileName}`)} onClick={() => void run(async () => { const updated = await removePaperSupplement(paper.id, attachment.id); setSupplements(updated.attachments.filter(item => item.kind === 'supplement')); })} className="pq-icon-button h-7 w-7 shrink-0 text-[var(--pq-text-muted)] hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul> : <p className="text-xs text-[var(--pq-text-muted)]">{l('尚未关联补充文件', 'No supplementary files linked')}</p>}
    <details className="text-[11px] leading-6 text-[var(--pq-text-muted)]"><summary className="cursor-pointer">{l('材料范围', 'Material coverage')}</summary>{l('报告读取关联的 PDF、TXT、Markdown、CSV 并标注来源。XLSX 仅保存和外部打开；图表需对照原文件。', 'Reports read linked PDF, TXT, Markdown and CSV with sources. XLSX is stored and opened externally; check figures in the original files.')}</details>
    {error && <p role="alert" className="break-words text-xs text-rose-600">{error}</p>}
  </section>;
}

import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, ListPlus } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { invoke } from '../../../platform/electron/core';
import { selectChatAttachmentPaths } from '../../../services/desktop';
import { addPaperSupplements, getJournalMetrics, type JournalMetric } from '../../../services/referenceExchange';
import type { LiteratureAttachment, LiteraturePaper } from '../../../types/library';
import { LIBRARY_DATA_CHANGED_EVENT } from '../libraryEvents';
import ReferenceExchangeDialog from './ReferenceExchangeDialog';

export default function PaperLocalResources({ paper }: { paper: LiteraturePaper }) {
  const l = useLocaleText();
  const [supplements, setSupplements] = useState<LiteratureAttachment[]>([]);
  const [metrics, setMetrics] = useState<JournalMetric[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadMetrics = useCallback(async () => {
    if (!paper.publication?.trim()) { setMetrics([]); return; }
    try { setMetrics(await getJournalMetrics(paper.publication)); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }, [paper.publication]);

  useEffect(() => {
    setSupplements(paper.attachments.filter((attachment) => attachment.kind === 'supplement'));
    setStatus('');
  }, [paper.id, paper.attachments]);
  useEffect(() => {
    void loadMetrics();
    const changed = () => { void loadMetrics(); };
    window.addEventListener(LIBRARY_DATA_CHANGED_EVENT, changed);
    return () => window.removeEventListener(LIBRARY_DATA_CHANGED_EVENT, changed);
  }, [loadMetrics]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await action(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <>
    <section className="pq-card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{l('补充材料', 'Supplementary materials')}</h3><button type="button" disabled={busy} onClick={() => void run(async () => {
        const paths = await selectChatAttachmentPaths('file');
        if (!paths.length) return;
        const updated = await addPaperSupplements(paper.id, paths);
        setSupplements(updated.attachments.filter((attachment) => attachment.kind === 'supplement'));
        setStatus(l('补充材料已复制到本地文献目录并关联。', 'Supplements copied into the local library and linked to this paper.'));
      })} className="pq-button px-2.5 py-1.5 text-xs"><FilePlus2 className="mr-1.5 h-3.5 w-3.5" />{l('添加', 'Add')}</button></div>
      <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('文件与主论文关联保存。生成报告时会读取已关联的 PDF、TXT、Markdown 和 CSV，并标明来源；XLSX 当前仅保管和外部打开，不会自动分析。图表请核对原文件。', 'Files are stored with this paper. Reports include linked PDF, TXT, Markdown and CSV text with source labels. XLSX is stored and opened externally, not automatically analyzed. Check figures against the original files.')}</p>
      {supplements.length ? <ul className="space-y-2">{supplements.map((attachment) => <li key={attachment.id} className="rounded-lg border border-[var(--pq-border)] px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs" title={attachment.storedPath}>{attachment.fileName}</span><button type="button" disabled={busy} title={l('在本机默认程序中打开', 'Open in the local default application')} onClick={() => void run(async () => { await invoke('open_library_attachment', { paperId: paper.id, attachmentId: attachment.id }); })} className="pq-icon-button h-7 w-7 shrink-0"><FolderOpen className="h-3.5 w-3.5" /></button></div></li>)}</ul> : <p className="text-xs text-[var(--pq-text-faint)]">{l('尚未关联补充文件。', 'No supplementary files linked.')}</p>}
    </section>
    <button type="button" className="pq-button px-3 py-2 text-xs" disabled={busy} onClick={() => void run(async () => { await invoke('library_reveal_pdf', { paperId: paper.id }); })}><FolderOpen className="mr-2 h-4 w-4" />{l('打开 PDF 所在文件夹', 'Show PDF in folder')}</button>
    <section className="pq-card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{l('年度期刊指标', 'Annual journal metrics')}</h3><button type="button" onClick={() => setDialogOpen(true)} className="pq-button px-2.5 py-1.5 text-xs"><ListPlus className="mr-1.5 h-3.5 w-3.5" />{l('导入 / 管理', 'Import / manage')}</button></div>
      {!paper.publication?.trim() ? <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('请先在文献详情中填写期刊名称，再匹配本地年度数据。', 'Set the journal name in paper details to match local annual data.')}</p> : metrics.length ? <div className="space-y-3">{metrics.map((metric, index) => <div key={`${metric.year}-${metric.source}-${metric.category}-${index}`} className="rounded-lg border border-[var(--pq-border)] p-3 text-xs leading-6"><div className="font-semibold">{metric.year} · {metric.category || l('未记录学科', 'Category unrecorded')}</div><dl className="mt-1 grid grid-cols-2 gap-x-2"><dt>IF</dt><dd>{metric.impactFactor ?? l('未知', 'Unknown')}</dd><dt>{l('JCR 分区', 'JCR quartile')}</dt><dd>{metric.jcrQuartile || l('未知', 'Unknown')}</dd><dt>{l('中科院分区', 'CAS partition')}</dt><dd>{metric.casPartition ?? l('未知', 'Unknown')}</dd></dl><p className="mt-1 break-words text-[var(--pq-text-muted)]">{l('来源：', 'Source: ')}{metric.source}</p></div>)}</div> : <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('本地尚无该期刊的年度数据。可导入已有合法来源的数据；影响因子和分区保持未知，不由模型推测。', 'No annual data is stored for this journal. Import data you are entitled to use; unknown metrics are not inferred by AI.')}</p>}
    </section>
    {status ? <p role="status" className="whitespace-pre-wrap text-xs leading-6 text-[var(--pq-text-muted)]">{status}</p> : null}
    <ReferenceExchangeDialog open={dialogOpen} onClose={() => setDialogOpen(false)} paperIds={[paper.id]} initialTab="metrics" />
  </>;
}

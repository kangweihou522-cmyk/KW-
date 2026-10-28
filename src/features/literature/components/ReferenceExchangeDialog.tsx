import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FolderOpen, Upload, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { selectDirectory } from '../../../services/desktop';
import { exportReferences, importJournalMetrics, importReferences, type ReferenceFormat } from '../../../services/referenceExchange';

interface Props { open: boolean; onClose: () => void; paperIds?: string[]; initialTab?: 'references' | 'metrics'; }

function downloadText(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReferenceExchangeDialog({ open, onClose, paperIds, initialTab = 'references' }: Props) {
  const l = useLocaleText();
  const [tab, setTab] = useState<'references' | 'metrics'>('references');
  const [format, setFormat] = useState<ReferenceFormat>('endnote-xml');
  const [metricFormat, setMetricFormat] = useState<'json' | 'csv'>('json');
  const [content, setContent] = useState('');
  const [metricContent, setMetricContent] = useState('');
  const [attachmentBaseDir, setAttachmentBaseDir] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => { if (open) { setTab(initialTab); setStatus(''); setWarnings([]); } }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, busy]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus(''); setWarnings([]); setFailed(false);
    try { await action(); } catch (error) {
      setFailed(true); setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function readFile(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error(l('文件超过 10 MB，请分批导入。', 'The file exceeds 10 MB. Import smaller batches.'));
      const text = await file.text();
      if (tab === 'references') { setContent(text); setFormat(/\.ris$/i.test(file.name) ? 'ris' : 'endnote-xml'); }
      else { setMetricContent(text); setMetricFormat(/\.csv$/i.test(file.name) ? 'csv' : 'json'); }
      setStatus(l('已读取本地文件，请确认格式和内容后导入。', 'Local file loaded. Confirm its format and content before importing.'));
    });
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="reference-exchange-title" className="pq-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--pq-border)] p-5">
          <div><h2 id="reference-exchange-title" className="text-lg font-semibold">{l('本地文献交换与期刊指标', 'Local reference exchange & journal metrics')}</h2><p className="mt-1 text-xs leading-6 text-[var(--pq-text-muted)]">{l('全程处理本机文件；不修改 EndNote 原库，不购买数据或调用付费服务。', 'Uses local files; does not modify the EndNote library or purchase data or services.')}</p></div>
          <button type="button" aria-label={l('关闭', 'Close')} onClick={onClose} disabled={busy} className="pq-icon-button h-9 w-9"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          <div className="mb-4 flex gap-2">{(['references', 'metrics'] as const).map((item) => <button key={item} type="button" disabled={busy} onClick={() => { setTab(item); setStatus(''); setWarnings([]); }} className={tab === item ? 'pq-button-primary px-4 py-2 text-sm' : 'pq-button px-4 py-2 text-sm'}>{item === 'references' ? l('EndNote / RIS', 'EndNote / RIS') : l('年度期刊指标', 'Annual journal metrics')}</button>)}</div>
          <label className="pq-button inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"><Upload className="h-4 w-4" />{l('读取本地文件', 'Read a local file')}<input type="file" disabled={busy} accept={tab === 'references' ? '.xml,.ris' : '.json,.csv'} className="sr-only" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
          {tab === 'references' ? <div className="mt-4 space-y-3">
            <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('先在 EndNote 中导出 XML 或 RIS。附件为相对 internal-pdf 引用时，可选择对应的 .Data/PDF 文件夹。元数据可独立导入；缺失附件会列出提示，不会自动下载。', 'Export XML or RIS from EndNote first. For internal-pdf attachments, optionally select the matching .Data/PDF folder. Missing attachments are reported without downloading files.')}</p>
            <label className="block text-sm">{l('交换格式', 'Exchange format')}<select aria-label={l('交换格式', 'Exchange format')} value={format} onChange={(event) => setFormat(event.target.value as ReferenceFormat)} className="pq-input ml-3 px-3 py-2"><option value="endnote-xml">EndNote XML</option><option value="ris">RIS</option></select></label>
            <div className="flex gap-2"><input aria-label={l('EndNote PDF 文件夹', 'EndNote PDF folder')} value={attachmentBaseDir} onChange={(event) => setAttachmentBaseDir(event.target.value)} placeholder={l('可选：EndNote .Data/PDF 文件夹', 'Optional: EndNote .Data/PDF folder')} className="pq-input min-w-0 flex-1 px-3 py-2 text-sm" /><button type="button" disabled={busy} onClick={() => void run(async () => { const directory = await selectDirectory(l('选择 EndNote PDF 文件夹', 'Select the EndNote PDF folder')); if (directory) setAttachmentBaseDir(directory); })} className="pq-button px-3"><FolderOpen className="h-4 w-4" /></button></div>
            <textarea aria-label={l('文献交换内容', 'Reference exchange content')} value={content} onChange={(event) => setContent(event.target.value)} placeholder={l('读取文件或粘贴 XML / RIS 内容。', 'Read a file or paste XML / RIS content.')} className="pq-input min-h-52 w-full p-3 font-mono text-xs leading-6" />
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !content.trim()} onClick={() => void run(async () => { const result = await importReferences(format, content, attachmentBaseDir); setStatus(l(`导入 ${result.imported} 条，跳过重复 ${result.skipped} 条。`, `${result.imported} imported; ${result.skipped} duplicates skipped.`)); setWarnings(result.warnings); })} className="pq-button-primary px-4 py-2 text-sm">{l('导入到本地文献库', 'Import into the local library')}</button><button type="button" disabled={busy} onClick={() => void run(async () => { const output = await exportReferences(format, paperIds); setContent(output); downloadText(output, `PaperDesk-references.${format === 'ris' ? 'ris' : 'xml'}`); setStatus(l('已生成交换文件。附件路径对应本机，跨电脑使用时需要重新关联。', 'Exchange file generated. Attachment paths refer to this computer and may need relinking elsewhere.')); })} className="pq-button px-4 py-2 text-sm"><Download className="mr-2 h-4 w-4" />{paperIds?.length ? l('导出选中文献', 'Export selected papers') : l('导出全部文献', 'Export all papers')}</button></div>
          </div> : <div className="mt-4 space-y-3">
            <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('导入你已有的、可合法使用的年度数据。必须填写期刊名称或 ISSN、年度和来源；学科可分别记录。IF、JCR 分区及中科院分区缺失时留空，不以其他指标替代。这里不会联网获取或推测权威数据。', 'Import annual data you are entitled to use. Journal or ISSN, year and source are required; record subject categories separately. Leave unknown metrics empty. This tool does not fetch or infer authoritative data.')}</p>
            <label className="block text-sm">{l('指标格式', 'Metric format')}<select value={metricFormat} onChange={(event) => setMetricFormat(event.target.value as 'json' | 'csv')} className="pq-input ml-3 px-3 py-2"><option value="json">JSON</option><option value="csv">CSV</option></select></label>
            <code className="block overflow-x-auto rounded-lg bg-slate-100 p-3 text-[11px] text-slate-700">journal,issn,year,source,category,impactFactor,jcrQuartile,casPartition</code>
            <p className="text-xs leading-6 text-[var(--pq-text-muted)]">{l('JSON 使用上述字段的对象数组；未知数值写 null。CSV 未知值留空。JCR 为 Q1–Q4，中科院分区为 1–4。', 'JSON: an array of objects using these fields; unknown values are null. CSV: leave unknown fields empty. JCR: Q1–Q4. CAS: 1–4.')}</p>
            <textarea aria-label={l('年度指标数据', 'Annual metric data')} value={metricContent} onChange={(event) => setMetricContent(event.target.value)} placeholder={metricFormat === 'json' ? '[{"journal":"...","year":2025,"source":"...","impactFactor":null,"jcrQuartile":null,"casPartition":null}]' : 'journal,issn,year,source,category,impactFactor,jcrQuartile,casPartition'} className="pq-input min-h-52 w-full p-3 font-mono text-xs leading-6" />
            <button type="button" disabled={busy || !metricContent.trim()} onClick={() => void run(async () => { const result = await importJournalMetrics(metricContent, metricFormat); setStatus(l(`已导入 ${result.imported} 条，本地共 ${result.total} 条年度指标。`, `${result.imported} imported; ${result.total} annual metric records stored locally.`)); })} className="pq-button-primary px-4 py-2 text-sm">{l('导入年度指标', 'Import annual metrics')}</button>
          </div>}
          {busy ? <p role="status" className="mt-4 text-xs">{l('正在处理本地文件…', 'Processing local files…')}</p> : null}
          {status ? <p role="status" className={`mt-4 whitespace-pre-wrap text-sm leading-6 ${failed ? 'text-rose-600' : 'text-emerald-700'}`}>{status}</p> : null}
          {warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-6 text-amber-700">{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul> : null}
        </div>
      </section>
    </div>, document.body,
  );
}

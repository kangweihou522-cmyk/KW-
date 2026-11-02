import { useEffect, useRef, useState } from 'react';
import { BookOpenText, Clock3, FileText, FolderOpen, Languages, Loader2, Paperclip, Sparkles } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import { invoke } from '../../../platform/electron/core';
import type { LiteraturePaper, LiteraturePaperTaskState, UpdatePaperRequest, MetadataLayout } from '../../../types/library';
import type { PdfReadingHeatmap } from '../../../types/reader';
import { loadPaperHistory, PAPER_READING_HEATMAP_UPDATED_EVENT } from '../../../utils/paperHistory';
import { formatReadingDuration } from '../../pdf/pdfReadingHeatmap';
import { isPaperPipelineActionDisabled } from '../../reader/paperTaskState';
import { PaperPersonalOverview } from '../../reader/PaperPersonalOverview';
import { paperPdfPath } from '../literatureUi';
import { LibraryPopover } from './LibraryPopover';
import LiteratureReadingTimeChart from './LiteratureReadingTimeChart';
import PaperLocalResources from './PaperLocalResources';
import { PaperMetadataEditor } from './PaperMetadataEditor';
import { PaperAiOverview } from './PaperAiOverview';

interface LiteraturePaperDetailsProps {
  selectedPaper: LiteraturePaper | null;
  metadataLayout?: MetadataLayout;
  saving: boolean;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onSavePaper: (request: UpdatePaperRequest) => Promise<boolean>;
  actionState?: LiteraturePaperTaskState | null;
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
}
function latestReadingHeatmap(paperId?: string): PdfReadingHeatmap | null {
  if (!paperId) return null;
  return Object.values(loadPaperHistory(`native-library:${paperId}`)?.pdfReadingHeatmaps ?? {})
    .filter(heatmap => heatmap.totalMs > 0).sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

export default function LiteraturePaperDetails({ selectedPaper, saving, onOpenPaper, onSavePaper, metadataLayout, actionState, onRunMineruParse, onTranslatePaper, onGenerateSummary }: LiteraturePaperDetailsProps) {
  const l = useLocaleText();
  const rootRef = useRef<HTMLElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [heatmap, setHeatmap] = useState<PdfReadingHeatmap | null>(null);
  const [menu, setMenu] = useState<{ kind: 'pipeline' | 'resources' | 'reading'; anchor: HTMLElement } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setMenu(null); setError('');
    const update = () => setHeatmap(latestReadingHeatmap(selectedPaper?.id));
    update(); window.addEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, update);
    return () => window.removeEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, update);
  }, [selectedPaper?.id]);
  const hasPdf = selectedPaper ? Boolean(paperPdfPath(selectedPaper)) : false;
  const toggle = (kind: 'pipeline' | 'resources' | 'reading', anchor: HTMLElement) => setMenu(current => current?.kind === kind ? null : { kind, anchor });
  const actions = [
    { kind: 'mineru', label: l('本地解析', 'Local parsing'), icon: Sparkles, handler: onRunMineruParse, tour: 'overview-mineru-parse' },
    { kind: 'translation', label: l('全文翻译', 'Full translation'), icon: Languages, handler: onTranslatePaper, tour: 'overview-translate-document' },
    { kind: 'overview', label: l('生成 AI 概览', 'Generate AI overview'), icon: FileText, handler: onGenerateSummary, tour: 'generate-summary' },
  ];
  return <aside ref={rootRef} onWheelCapture={handleWheelCapture} className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-l" data-paper-details>
    {selectedPaper && <header className="pq-toolbar flex shrink-0 flex-wrap items-center gap-1 px-3 py-2">
      <button type="button" title={l('打开阅读', 'Open reader')} aria-label={l('打开阅读', 'Open reader')} disabled={!hasPdf} onClick={() => onOpenPaper(selectedPaper)} className="pq-icon-button h-8 w-8 text-[var(--pq-accent)]"><BookOpenText className="h-4 w-4" /></button>
      <button type="button" title={l('文档处理', 'Document processing')} aria-label={l('文档处理', 'Document processing')} aria-expanded={menu?.kind === 'pipeline'} onClick={event => toggle('pipeline', event.currentTarget)} className="pq-icon-button h-8 w-8"><FileText className="h-4 w-4" /></button>
      <button type="button" title={l('打开 PDF 所在文件夹', 'Show PDF in folder')} aria-label={l('打开 PDF 所在文件夹', 'Show PDF in folder')} disabled={!hasPdf} onClick={() => { setError(''); void invoke('library_reveal_pdf', { paperId: selectedPaper.id }).catch(e => setError(String(e))); }} className="pq-icon-button h-8 w-8"><FolderOpen className="h-4 w-4" /></button>
      <button type="button" title={l('补充材料', 'Supplementary materials')} aria-label={l('补充材料', 'Supplementary materials')} aria-expanded={menu?.kind === 'resources'} onClick={event => toggle('resources', event.currentTarget)} className="pq-icon-button h-8 w-8"><Paperclip className="h-4 w-4" /></button>
      <PaperMetadataEditor metadataLayout={metadataLayout} paper={selectedPaper} saving={saving} onSave={onSavePaper} />
      <button type="button" title={l('查看阅读时间', 'View reading time')} aria-label={l('查看阅读时间', 'View reading time')} aria-expanded={menu?.kind === 'reading'} onClick={event => toggle('reading', event.currentTarget)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] text-[var(--pq-text-muted)] hover:bg-[var(--pq-accent-soft)]"><Clock3 className="h-3.5 w-3.5" />{formatReadingDuration(heatmap?.totalMs ?? 0)}</button>
      {menu && <LibraryPopover anchor={menu.anchor} label={menu.kind === 'pipeline' ? l('文档处理', 'Document processing') : menu.kind === 'reading' ? l('阅读时间', 'Reading time') : l('补充材料', 'Supplementary materials')} onClose={() => setMenu(null)} width={320}>
        {menu.kind === 'pipeline' ? <div className="space-y-1">{actions.map(action => <button key={action.kind} type="button" data-tour={action.tour} disabled={isPaperPipelineActionDisabled({ hasPdf, hasHandler: !!action.handler, actionState })} onClick={() => { action.handler?.(selectedPaper); setMenu(null); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs hover:bg-[var(--pq-accent-soft)] disabled:opacity-40"><action.icon className="h-4 w-4 text-[var(--pq-accent)]" />{action.label}</button>)}</div> : menu.kind === 'reading' ? <LiteratureReadingTimeChart heatmap={heatmap} /> : <PaperLocalResources key={selectedPaper.id} paper={selectedPaper} />}
      </LibraryPopover>}
    </header>}
    <div data-wheel-scroll-target className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3">
      {selectedPaper ? <div className="space-y-3">
        {error && <p role="alert" className="break-words text-xs text-rose-600">{error}</p>}
        {actionState && actionState.status !== 'success' && <div role={actionState.status === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${actionState.status === 'error' ? 'border-rose-200 text-rose-600' : 'border-[var(--pq-accent-border)] text-[var(--pq-accent)]'}`}>{actionState.status === 'running' && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}<span className="break-words">{actionState.message || actionState.label}</span></div>}
        <PaperPersonalOverview key={`personal:${selectedPaper.id}`} paperId={selectedPaper.id} />
        <PaperAiOverview key={`ai:${selectedPaper.id}`} paper={selectedPaper} />
      </div> : <div className="pq-card border-dashed p-8 text-center text-sm text-[var(--pq-text-muted)]">{l('选择一篇文献查看概览。', 'Select a paper to view its overview.')}</div>}
    </div>
  </aside>;
}

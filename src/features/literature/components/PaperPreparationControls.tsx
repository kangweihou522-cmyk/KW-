import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Languages, Loader2, Pause, Play, Square, WandSparkles, X } from 'lucide-react';
import { invoke } from '../../../platform/electron/core';
import { listen } from '../../../platform/electron/event';
import type { LiteraturePaper } from '../../../types/library';
import { useReaderPreferences } from '../../reader/ReaderPreferencesContext';
import { emitLibraryDataChanged } from '../libraryEvents';
type Preparation = { paperId: string; status: string; running: boolean; paused: boolean; stage: string; steps: Record<string, { status: string; message?: string }>; completed: number; total: number; cached: number; message?: string; warnings?: string[] };
type Translations = { units: Array<{ id: string; pageIndex: number; text: string; translation: string }> };
const labels: Record<string, string> = { parse: '解析', metadata: '书目', overview: 'AI 概览', translation: '翻译' };

export function PaperPreparationControls({ paper }: { paper: LiteraturePaper }) {
  const preferences = useReaderPreferences();
  const [state, setState] = useState<Preparation | null>(null);
  const [error, setError] = useState(''); const [starting, setStarting] = useState(false);
  const [translations, setTranslations] = useState<Translations | null>(null);
  const previous = useRef('');
  const start = async (mode = 'all') => {
    setStarting(true); setError('');
    try { setState(await invoke<Preparation>('paper_prepare_start', { paperId: paper.id, mode, modelOptions: preferences?.summaryModelPreset, source: preferences?.settings.translationSourceLanguage, target: preferences?.settings.translationTargetLanguage })); preferences?.updateSetting('selectionTranslationProvider', 'offline-quality'); }
    catch (error) { setError(String(error)); } finally { setStarting(false); }
  };
  useEffect(() => {
    let disposed = false; let unlisten: (() => void) | undefined;
    const apply = (next: Preparation | null) => {
      if (disposed || !next || next.paperId !== paper.id) return;
      setState(next);
      const signature = [next.steps.metadata?.status, next.steps.overview?.status, next.running].join(':');
      if (signature !== previous.current) { previous.current = signature; emitLibraryDataChanged(); }
    };
    void listen<Preparation>('paperdesk:preparation-progress', event => apply(event.payload)).then(dispose => { if (disposed) dispose(); else unlisten = dispose; });
    void invoke<Preparation | null>('paper_prepare_status', { paperId: paper.id }).then(apply).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, [paper.id]);
  useEffect(() => {
    const request = (event: Event) => { const detail = (event as CustomEvent<{ paperId: string; mode: string }>).detail; if (detail.paperId === paper.id) void start(detail.mode); };
    window.addEventListener('paperdesk:prepare-paper', request); return () => window.removeEventListener('paperdesk:prepare-paper', request);
  });
  const control = async (action: string) => { try { setState(await invoke<Preparation>('paper_prepare_control', { paperId: paper.id, action })); } catch (error) { setError(String(error)); } };
  const showTranslations = async () => { try { const saved = await invoke<Translations | null>('paper_translation_get', { paperId: paper.id }); if (saved) setTranslations(saved); else setError('尚无完整译文，请先完成全文翻译。已完成句段仍可用于划词缓存。'); } catch (error) { setError(String(error)); } };
  return <div className="space-y-2" data-paper-preparation>
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-label="一键处理文献" disabled={starting || state?.running} onClick={() => void start()} className="pq-button-primary gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50">{state?.running || starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}一键处理</button>
      <button type="button" title="查看全文译文" aria-label="查看全文译文" className="pq-icon-button h-7 w-7" onClick={() => void showTranslations()}><Languages className="h-3.5 w-3.5" /></button>
      {state?.running && <><button type="button" title={state.paused ? '继续处理' : '暂停处理'} aria-label={state.paused ? '继续处理' : '暂停处理'} className="pq-icon-button h-7 w-7" onClick={() => void control(state.paused ? 'resume' : 'pause')}>{state.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</button><button type="button" title="停止处理，保留结果" aria-label="停止处理，保留结果" className="pq-icon-button h-7 w-7" onClick={() => void control('stop')}><Square className="h-3.5 w-3.5" /></button></>}
      {state?.stage === 'translation' && state.total > 0 && <span role="status" className="text-[11px] text-[var(--pq-text-muted)]">{state.completed}/{state.total} 段 · 缓存 {state.cached}</span>}
    </div>
    {state && <details open={state.running || state.status === 'partial' || state.status === 'error'} className="text-[11px] leading-5 text-[var(--pq-text-muted)]"><summary className="cursor-pointer">{state.running ? state.paused ? '已暂停；当前步骤完成后等待' : `正在${labels[state.stage] || '处理'}` : state.status === 'done' ? '处理完成' : '结果已保留，可再次点击继续'}</summary><div className="mt-1 space-y-1">{Object.entries(state.steps).map(([key, step]) => <div key={key} className={`flex gap-1.5 ${step.status === 'error' ? 'text-rose-600' : ''}`}>{step.status === 'done' && <Check className="mt-1 h-3 w-3 shrink-0" />}<span>{labels[key]}：{step.message || (step.status === 'running' ? '处理中' : step.status)}</span></div>)}{state.message && <p>{state.message}</p>}{state.warnings?.map(message => <p key={message}>{message}</p>)}</div></details>}
    {error && <p role="alert" className="text-xs leading-5 text-rose-600">{error}</p>}
    {translations && createPortal(<div className="pq-saas-scope fixed inset-0 z-[180] flex items-center justify-center bg-black/35 p-6"><section role="dialog" aria-modal="true" aria-label="全文译文" className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-[var(--pq-surface-1)] text-[var(--pq-text)] shadow-xl"><header className="flex items-center justify-between border-b border-[var(--pq-border)] px-5 py-3"><h2 className="text-sm font-semibold">全文译文 · {paper.title}</h2><button type="button" aria-label="关闭全文译文" className="pq-icon-button h-7 w-7" onClick={() => setTranslations(null)}><X className="h-4 w-4" /></button></header><div className="min-h-0 overflow-y-auto p-5">{translations.units.map(unit => <article key={unit.id} className="mb-5 space-y-2"><span className="rounded bg-[var(--pq-accent-soft)] px-2 py-0.5 text-[10px] text-[var(--pq-accent)]">第 {unit.pageIndex + 1} 页</span><p className="whitespace-pre-wrap text-xs leading-6 text-[var(--pq-text-muted)]">{unit.text}</p><p className="whitespace-pre-wrap text-sm leading-7">{unit.translation}</p></article>)}</div></section></div>, document.body)}
  </div>;
}

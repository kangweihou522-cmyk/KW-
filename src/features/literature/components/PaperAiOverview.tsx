import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { LiteraturePaper } from '../../../types/library';
import type { Note } from '../../../types/notes';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { getChatGptReport, saveChatGptReport, syncChatGptOverview } from '../../../services/readingWorkflow';
import { joinEditableReport, splitEditableReport, type EditableReportSection } from '../../reader/reportEditorSections';
import { useChatGptDraft, writeChatGptDraft } from '../../reader/chatGptReportCache';
import { overviewSectionLabel, parseOverviewSections } from '../overviewSections';

export function PaperAiOverview({ paper }: { paper: LiteraturePaper }) {
  const l = useLocaleText();
  const draft = useChatGptDraft(paper.id);
  const [editing, setEditing] = useState(false);
  const [emptyDraft, setEmptyDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const base = useRef('');
  const view = parseOverviewSections(paper.aiSummary || '');
  const editable = emptyDraft ? [] : splitEditableReport(draft);
  const sections = editing ? editable : view;
  const index = Math.max(0, Math.min(active, sections.length - 1));
  const section = sections[index];
  useEffect(() => { setActive(0); }, [paper.id]);
  useEffect(() => { if (draft.trim()) setEmptyDraft(false); }, [draft]);
  function change(next: EditableReportSection[], selectedIndex = index) {
    try { setEmptyDraft(next.length === 0); writeChatGptDraft(paper.id, joinEditableReport(next)); setActive(selectedIndex); setSaved(false); setError(''); }
    catch (e) { setError(String(e)); }
  }
  async function begin(add = false) {
    if (editing) { if (add) change([...editable, { title: l('自定义栏目', 'Custom section'), level: 2, content: '' }], editable.length); return; }
    setBusy(true); setError('');
    try {
      setPrevious(await getChatGptReport(paper.id));
      base.current = paper.aiSummary || '';
      const text = draft || base.current || `## ${l('概览', 'Overview')}\n\n`;
      const next = splitEditableReport(text);
      if (add) next.push({ title: l('自定义栏目', 'Custom section'), level: 2, content: '' });
      setEmptyDraft(false); writeChatGptDraft(paper.id, joinEditableReport(next));
      setActive(add ? next.length - 1 : Math.min(active, next.length - 1)); setEditing(true); setSaved(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (editable.some(item => item.level && !item.title.trim())) { setError(l('请填写栏目标题和内容。', 'Enter a section title and content.')); return; }
    if ((paper.aiSummary || '') !== base.current) { setError(l('已保存内容有更新，当前草稿已保留。请打开报告对比最新版本后保存。', 'Saved content changed. Your draft is retained. Compare the latest report before saving.')); return; }
    setBusy(true); setError('');
    try {
      const note = await saveChatGptReport(paper.id, paper.title, draft, previous);
      setPrevious(note);
      await syncChatGptOverview(paper.id, draft);
      setEditing(false); setSaved(true);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const openReport = () => window.dispatchEvent(new CustomEvent('paperdesk:open-chatgpt-report', { detail: { paperId: paper.id, title: paper.title } }));
  return <section className="pq-card space-y-3 p-4" data-ai-overview>
    <header className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{l('AI 概览', 'AI overview')}</h3><div className="flex items-center gap-0.5">{saved && <span role="status" title={l('已保存', 'Saved')} className="text-[var(--pq-accent)]"><Check className="h-3.5 w-3.5" /><span className="sr-only">{l('已保存', 'Saved')}</span></span>}{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}<button type="button" disabled={busy} title={l('编辑概览栏目', 'Edit overview sections')} aria-label={l('编辑概览栏目', 'Edit overview sections')} className="pq-icon-button h-7 w-7" onClick={() => void begin()}><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={busy} title={l('添加 AI 概览栏目', 'Add AI overview section')} aria-label={l('添加 AI 概览栏目', 'Add AI overview section')} className="pq-icon-button h-7 w-7 text-[var(--pq-accent)]" onClick={() => void begin(true)}><Plus className="h-4 w-4" /></button><button type="button" title={l('完整报告与历史版本', 'Full report and history')} aria-label={l('完整报告与历史版本', 'Full report and history')} className="pq-icon-button h-7 w-7" onClick={openReport}><FileText className="h-3.5 w-3.5" /></button></div></header>
    {error && <p role="alert" className="break-words text-xs leading-5 text-rose-600">{error}</p>}
    {sections.length > 0 && <div role="tablist" aria-label={l('AI 概览栏目', 'AI overview sections')} className="flex flex-wrap gap-1.5">{sections.map((item, position) => <button key={position} type="button" role="tab" aria-selected={index === position} onClick={() => setActive(position)} className={index === position ? 'rounded-full border border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--pq-accent)]' : 'rounded-full border border-[var(--pq-border)] px-3 py-1.5 text-xs text-[var(--pq-text-muted)] hover:bg-[var(--pq-accent-soft)]'}>{overviewSectionLabel(item.title, item.level, l)}</button>)}</div>}
    {section ? <div role="tabpanel" className="space-y-3 rounded-xl border border-[var(--pq-border)] p-3">
      {editing ? <><div className="flex items-center gap-1"><input disabled={busy} aria-label={l('AI 概览栏目标题', 'AI overview section title')} className="pq-input min-w-0 flex-1 px-2 py-1.5 text-sm font-semibold" value={section.title} onChange={event => change(editable.map((item, position) => position === index ? { ...item, title: event.target.value, level: item.level || 2 } : item))} /><button type="button" title={l('栏目向前移动', 'Move section earlier')} aria-label={l('栏目向前移动', 'Move section earlier')} disabled={busy || index === 0} className="pq-icon-button h-7 w-7" onClick={() => { const next = [...editable]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next, index - 1); }}><ArrowLeft className="h-3.5 w-3.5" /></button><button type="button" title={l('栏目向后移动', 'Move section later')} aria-label={l('栏目向后移动', 'Move section later')} disabled={busy || index >= editable.length - 1} className="pq-icon-button h-7 w-7" onClick={() => { const next = [...editable]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; change(next, index + 1); }}><ArrowRight className="h-3.5 w-3.5" /></button><button type="button" disabled={busy} title={l('删除 AI 概览栏目', 'Delete AI overview section')} aria-label={l('删除 AI 概览栏目', 'Delete AI overview section')} className="pq-icon-button h-7 w-7 text-[var(--pq-text-muted)] hover:text-rose-600" onClick={() => change(editable.filter((_, position) => position !== index), Math.max(0, index - 1))}><Trash2 className="h-3.5 w-3.5" /></button></div><textarea aria-label={l('AI 概览栏目内容', 'AI overview section content')} disabled={busy} className="pq-input min-h-48 w-full resize-y p-3 text-sm leading-7" value={section.content} onChange={event => change(editable.map((item, position) => position === index ? { ...item, content: event.target.value } : item))} /></> : <><h4 className="text-sm font-semibold text-[var(--pq-accent)]">{overviewSectionLabel(section.title, section.level, l)}</h4><div className="pq-overview-markdown break-words text-sm leading-7 text-[var(--pq-text-muted)]"><ReactMarkdown>{section.content || l('尚未填写', 'Not filled in')}</ReactMarkdown></div></>}
    </div> : <button type="button" className="w-full rounded-xl border border-dashed border-[var(--pq-border)] p-4 text-left text-xs leading-6 text-[var(--pq-text-muted)]" onClick={() => void begin(true)}>{l('添加栏目即可手工整理，也可从上方生成概览。', 'Add sections to write your overview, or generate one from the toolbar.')}</button>}
    {editing && <div className="flex items-center justify-between gap-2"><button type="button" disabled={busy} className="pq-button inline-flex gap-1 px-2.5 py-1.5 text-xs" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />{l('收起编辑', 'Close editor')}</button><button type="button" disabled={busy} className="pq-button-primary inline-flex gap-1 px-3 py-1.5 text-xs" onClick={() => void save()}><Save className="h-3.5 w-3.5" />{l('保存', 'Save')}</button></div>}
  </section>;
}

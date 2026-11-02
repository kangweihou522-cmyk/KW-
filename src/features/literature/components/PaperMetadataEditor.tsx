import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { LiteraturePaper, UpdatePaperRequest, MetadataLayout } from '../../../types/library';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { lookupLiteratureMetadata } from '../../../services/metadata';
import { paperPdfPath } from '../literatureUi';
import { invoke } from '../../../platform/electron/core';
import { useReaderPreferences } from '../../reader/ReaderPreferencesContext';
import { LibraryPopover } from './LibraryPopover';

function factor(value: string): number | null { return value.trim() ? Number(value) : null; }
export function PaperImpactFactor({ paper, saving, onSave }: { paper: LiteraturePaper; saving: boolean; onSave: (request: UpdatePaperRequest) => Promise<boolean> }) {
  const l = useLocaleText();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return <span onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <button type="button" title={l('编辑影响因子', 'Edit impact factor')} aria-label={l('编辑影响因子', 'Edit impact factor')} className="inline-flex items-center gap-1 rounded bg-[var(--pq-accent-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--pq-accent)]" onClick={event => { setValue(paper.impactFactor?.toString() || ''); setError(''); setAnchor(event.currentTarget); }}>IF {paper.impactFactor ?? '—'}<Pencil className="h-3 w-3" /></button>
    {anchor && <LibraryPopover anchor={anchor} label={l('编辑影响因子', 'Edit impact factor')} onClose={() => setAnchor(null)} width={250}><form className="space-y-3" onSubmit={async event => { event.preventDefault(); const next = factor(value); if (next !== null && (!Number.isFinite(next) || next < 0)) { setError(l('请输入非负数', 'Enter a non-negative number')); return; } if (await onSave({ paperId: paper.id, impactFactor: next })) setAnchor(null); }}><label className="block text-xs font-medium">{l('影响因子（手工记录）', 'Impact factor (manual)')}<input aria-label={l('影响因子', 'Impact factor')} type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} className="pq-input mt-2 w-full p-2 text-sm" /></label><p className="text-[11px] text-[var(--pq-text-muted)]">{l('清空表示未知；不会自动推测。', 'Leave empty for unknown.')}</p>{error && <p role="alert" className="text-xs text-rose-600">{error}</p>}<button type="submit" disabled={saving} className="pq-button-primary px-3 py-1.5 text-xs">{l('保存', 'Save')}</button></form></LibraryPopover>}
  </span>;
}

export function PaperMetadataEditor({ paper, saving, onSave, metadataLayout }: { paper: LiteraturePaper; saving: boolean; onSave: (request: UpdatePaperRequest) => Promise<boolean>; metadataLayout?: MetadataLayout }) {
  const l = useLocaleText();
  const preferences = useReaderPreferences();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<MetadataLayout>({ hiddenFields: [], customFields: [] });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false); const [newLabel, setNewLabel] = useState('');
  const [filling, setFilling] = useState(false); const [status, setStatus] = useState('');
  const [error, setError] = useState(''); const dialog = useRef<HTMLDivElement>(null);
  const fields = [
    ['title', l('标题', 'Title')], ['authors', l('作者（用分号分隔）', 'Authors (separate with semicolons)')],
    ['publication', l('期刊', 'Journal')], ['year', l('年份', 'Year')], ['volume', l('卷', 'Volume')], ['issue', l('期', 'Issue')], ['pages', l('页码 / 文章编号', 'Pages / article number')], ['publishedDate', l('出版日期', 'Publication date')], ['doi', 'DOI'], ['impactFactor', l('影响因子', 'Impact factor')], ['url', 'URL'],
    ['abstractText', l('原文摘要', 'Original abstract')], ['keywords', l('关键词（用分号分隔）', 'Keywords (separate with semicolons)')], ['userNote', l('用户笔记', 'User note')], ['citation', l('引用信息', 'Citation')],
  ];
  const hidden = new Set(layout.hiddenFields);
  function hide(key: string) { setLayout(current => ({ ...current, hiddenFields: [...new Set([...current.hiddenFields, key])] })); }
  const labelFor = (key: string) => fields.find(field => field[0] === key)?.[1] || layout.customFields.find(field => field.id === key)?.label || key;
  function begin() {
    setDraft(Object.fromEntries(fields.map(([key]) => [key, key === 'authors' ? paper.authors.map(author => author.name).join('; ') : key === 'keywords' ? paper.keywords.join('; ') : String(paper[key as keyof LiteraturePaper] ?? '')])));
    setLayout(structuredClone(metadataLayout || { hiddenFields: [], customFields: [] })); setCustom({ ...paper.customFields });
    setAdding(false); setNewLabel(''); setError(''); setStatus(''); setOpen(true);
  }
  async function fill() {
    setFilling(true); setError(''); setStatus(l('正在按 DOI / 标题核对正式记录…', 'Checking the DOI / title against the registry…'));
    try {
      const result = await lookupLiteratureMetadata({ doi: draft.doi, title: draft.title, path: paperPdfPath(paper) });
      if (!result?.verified) { setStatus(l('未找到可靠匹配，请补充或核对 DOI；当前内容已保留。', 'No reliable match. Check the DOI; current content is retained.')); return; }
      setDraft(current => {
        const next = { ...current };
        for (const key of ['title', 'year', 'publication', 'volume', 'issue', 'pages', 'publishedDate', 'doi'] as const) if (result[key]) next[key] = result[key]!;
        if (result.authors.length) next.authors = result.authors.join('; ');
        return next;
      });
      setStatus(l('已核对正式记录，点击保存生效。', 'Registry matched. Save to apply.'));
    } catch (e) { setError(String(e)); setStatus(''); } finally { setFilling(false); }
  }
  async function analyzeLocal() {
    setFilling(true); setError(''); setStatus(l('正在用本地模型核对首页文字…', 'Checking the first page with the local model…'));
    try {
      const result = await invoke<Record<string, string | string[]>>('paper_metadata_local', { paperId: paper.id, modelOptions: preferences?.summaryModelPreset });
      setDraft(current => { const next = { ...current }; for (const [key, value] of Object.entries(result)) if (Array.isArray(value) ? value.length : value) next[key] = Array.isArray(value) ? value.join('; ') : value; return next; });
      setStatus(l('已导入能在首页找到依据的候选信息，请核对后保存。', 'Imported candidates supported by first-page text. Review and save.'));
    } catch (error) { setError(String(error)); setStatus(''); } finally { setFilling(false); }
  }
  async function save() {
    const value = factor(draft.impactFactor);
    if (!draft.title.trim() || (value !== null && (!Number.isFinite(value) || value < 0))) { setError(l('请填写标题，影响因子须为非负数。', 'A title and non-negative impact factor are required.')); return; }
    const request: UpdatePaperRequest = { paperId: paper.id, metadataLayout: layout, customFields: custom };
    for (const [key] of fields) {
      if (hidden.has(key)) continue;
      Object.assign(request, { [key]: key === 'authors' ? draft[key].split(/[;；]/).map(part => part.trim()).filter(Boolean) : key === 'keywords' ? draft[key].split(/[;；,，]/).map(part => part.trim()).filter(Boolean) : key === 'impactFactor' ? value : draft[key].trim() || null });
    }
    if (await onSave(request)) setOpen(false); else setError(l('保存失败，请检查文库提示。', 'Save failed. Check the library message.'));
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement; dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);
  return <span onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button type="button" title={l('编辑文献信息', 'Edit paper metadata')} aria-label={l('编辑文献信息', 'Edit paper metadata')} className="pq-icon-button h-8 w-8 text-[var(--pq-text-muted)]" onClick={begin}><Pencil className="h-4 w-4" /></button>
    {open && createPortal(<div className="pq-saas-scope fixed inset-0 z-[170] flex items-center justify-center bg-black/35 p-5 text-[var(--pq-text)]" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation(); if (event.key === 'Escape' && !saving && !filling) setOpen(false);
      if (event.key === 'Tab') { const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'); if (nodes?.length) { const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }
    }}><div ref={dialog} role="dialog" aria-modal="true" aria-label={l('编辑文献信息', 'Edit paper metadata')} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] shadow-xl">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--pq-border)] px-5 py-3"><h2 className="font-semibold">{l('编辑文献信息', 'Edit paper metadata')}</h2><div className="flex items-center gap-2"><button type="button" disabled={filling || saving || !paperPdfPath(paper)} className="pq-button px-2.5 py-1.5 text-xs" onClick={() => void analyzeLocal()}>{l('本地分析', 'Local analysis')}</button><button type="button" disabled={filling || saving} className="pq-button px-2.5 py-1.5 text-xs" onClick={() => void fill()}>{filling ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}{l('自动补全', 'Auto-fill')}</button><button type="button" disabled={saving || filling} aria-label={l('关闭', 'Close')} className="pq-icon-button h-8 w-8" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div></header>
      <form className="min-h-0 overflow-y-auto p-5" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="mb-4 space-y-2"><div className="flex flex-wrap gap-2"><button type="button" className="pq-button px-2.5 py-1.5 text-xs" onClick={() => setAdding(!adding)}><Plus className="mr-1 h-3.5 w-3.5" />{l('添加项目', 'Add field')}</button>{layout.hiddenFields.length > 0 && <select aria-label={l('恢复项目', 'Restore field')} className="pq-input max-w-52 px-2 text-xs" value="" onChange={event => { const restored = event.target.value; setLayout(current => ({ ...current, hiddenFields: current.hiddenFields.filter(key => key !== restored) })); }}><option value="">{l('恢复已移除项目', 'Restore removed field')}</option>{layout.hiddenFields.map(key => <option key={key} value={key}>{labelFor(key)}</option>)}</select>}</div><p className="text-[11px] leading-5 text-[var(--pq-text-muted)]">{l('项目全库共用，内容按文献保存。移除项目会隐藏显示，原值保留，可恢复。', 'Fields are shared across the library; values belong to each paper. Removing a field hides it and retains its values.')}</p>
        {adding && <div className="flex gap-2"><input aria-label={l('新增项目名称', 'New field name')} className="pq-input min-w-0 flex-1 p-2 text-xs" placeholder={l('例如：中文标题', 'For example: Chinese title')} value={newLabel} onChange={event => setNewLabel(event.target.value)} /><button type="button" disabled={!newLabel.trim()} className="pq-button px-3 py-1.5 text-xs" onClick={() => { const id = `custom_${crypto.randomUUID()}`; setLayout(current => ({ ...current, customFields: [...current.customFields, { id, label: newLabel.trim() }] })); setNewLabel(''); setAdding(false); }}>{l('添加', 'Add')}</button></div>}
        {status && <p role="status" className="text-xs leading-5 text-[var(--pq-accent)]">{status}</p>}</div>
        <div className="grid grid-cols-2 gap-3">{fields.filter(([key]) => !hidden.has(key)).map(([key, label]) => <label key={key} className={`block text-xs font-medium ${['title', 'authors', 'publication', 'url', 'abstractText', 'keywords', 'userNote', 'citation'].includes(key) ? 'col-span-2' : ''}`}><span className="flex items-center justify-between gap-2">{label}{key !== 'title' && <button type="button" title={l(`移除项目：${label}`, `Remove field: ${label}`)} aria-label={l(`移除项目：${label}`, `Remove field: ${label}`)} className="pq-icon-button h-6 w-6 text-[var(--pq-text-faint)]" onClick={() => hide(key)}><Trash2 className="h-3 w-3" /></button>}</span>{['abstractText', 'userNote', 'citation'].includes(key) ? <textarea disabled={filling || saving} aria-label={label} className="pq-input mt-1 min-h-24 w-full resize-y p-2 text-sm" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /> : <input disabled={filling || saving} aria-label={label} className="pq-input mt-1 w-full p-2 text-sm" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />}</label>)}
        {layout.customFields.filter(field => !hidden.has(field.id)).map(field => <div key={field.id} className="col-span-2 space-y-1"><div className="flex items-center gap-2"><input aria-label={l('自定义项目名称', 'Custom field name')} value={field.label} className="pq-input min-w-0 flex-1 px-2 py-1 text-xs font-medium" onChange={event => setLayout(current => ({ ...current, customFields: current.customFields.map(item => item.id === field.id ? { ...item, label: event.target.value } : item) }))} /><button type="button" title={l(`移除项目：${field.label}`, `Remove field: ${field.label}`)} aria-label={l(`移除项目：${field.label}`, `Remove field: ${field.label}`)} className="pq-icon-button h-6 w-6" onClick={() => hide(field.id)}><Trash2 className="h-3 w-3" /></button></div><textarea aria-label={field.label} className="pq-input min-h-16 w-full resize-y p-2 text-sm" value={custom[field.id] || ''} onChange={event => setCustom(current => ({ ...current, [field.id]: event.target.value }))} /></div>)}
        </div>{error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" disabled={saving || filling} className="pq-button px-3 py-2 text-xs" onClick={() => setOpen(false)}>{l('取消', 'Cancel')}</button><button type="submit" disabled={saving || filling} className="pq-button-primary px-4 py-2 text-xs">{saving ? l('保存中…', 'Saving…') : l('保存修改', 'Save changes')}</button></div>
      </form>
    </div></div>, document.body)}
  </span>;
}

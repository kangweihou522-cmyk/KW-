import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import type { LiteraturePaper, UpdatePaperRequest } from '../../../types/library';
import { useLocaleText } from '../../../i18n/uiLanguage';
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

export function PaperMetadataEditor({ paper, saving, onSave }: { paper: LiteraturePaper; saving: boolean; onSave: (request: UpdatePaperRequest) => Promise<boolean> }) {
  const l = useLocaleText();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fields = [
    ['title', l('标题', 'Title')], ['authors', l('作者（用分号分隔）', 'Authors (separate with semicolons)')],
    ['publication', l('期刊', 'Journal')], ['year', l('年份', 'Year')], ['volume', l('卷', 'Volume')], ['issue', l('期', 'Issue')], ['pages', l('页码 / 文章编号', 'Pages / article number')], ['publishedDate', l('出版日期', 'Publication date')], ['doi', 'DOI'], ['impactFactor', l('影响因子', 'Impact factor')], ['url', 'URL'],
    ['abstractText', l('原文摘要', 'Original abstract')], ['keywords', l('关键词（用分号分隔）', 'Keywords (separate with semicolons)')], ['userNote', l('用户笔记', 'User note')], ['citation', l('引用信息', 'Citation')],
  ];
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);
  return <span onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button ref={trigger} type="button" title={l('编辑文献信息', 'Edit paper metadata')} aria-label={l('编辑文献信息', 'Edit paper metadata')} className="pq-icon-button h-8 w-8 text-[var(--pq-text-muted)]" onClick={() => { setDraft(Object.fromEntries(fields.map(([key]) => [key, key === 'authors' ? paper.authors.map(author => author.name).join('; ') : key === 'keywords' ? paper.keywords.join('; ') : String(paper[key as keyof LiteraturePaper] ?? '')]))); setError(''); setOpen(true); }}><Pencil className="h-4 w-4" /></button>
    {open && createPortal(<div className="pq-saas-scope fixed inset-0 z-[170] flex items-center justify-center bg-black/35 p-5 text-[var(--pq-text)]" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !saving) setOpen(false); if (event.key === 'Tab') { const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea'); if (nodes?.length) { const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } } }}><div ref={dialog} role="dialog" aria-modal="true" aria-label={l('编辑文献信息', 'Edit paper metadata')} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] shadow-xl"><header className="flex items-center justify-between border-b border-[var(--pq-border)] px-5 py-3"><h2 className="font-semibold">{l('编辑文献信息', 'Edit paper metadata')}</h2><button type="button" disabled={saving} aria-label={l('关闭', 'Close')} className="pq-icon-button h-8 w-8" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></header><form className="min-h-0 overflow-y-auto p-5" onSubmit={async event => { event.preventDefault(); const value = factor(draft.impactFactor); if (!draft.title.trim() || (value !== null && (!Number.isFinite(value) || value < 0))) { setError(l('请填写标题，影响因子须为非负数。', 'A title and a non-negative impact factor are required.')); return; } const request: UpdatePaperRequest = { paperId: paper.id }; for (const [key] of fields) { Object.assign(request, { [key]: key === 'authors' || key === 'keywords' ? draft[key].split(/[;；,，]/).map(part => part.trim()).filter(Boolean) : key === 'impactFactor' ? value : draft[key].trim() || null }); } if (await onSave(request)) setOpen(false); else setError(l('保存失败，请检查文库提示并重试。', 'Save failed. Check the library message and try again.')); }}><div className="grid grid-cols-2 gap-3">{fields.map(([key, label]) => <label key={key} className={`block text-xs font-medium ${['title', 'authors', 'publication', 'url', 'abstractText', 'keywords', 'userNote', 'citation'].includes(key) ? 'col-span-2' : ''}`}>{label}{['abstractText', 'userNote', 'citation'].includes(key) ? <textarea className="pq-input mt-1 min-h-24 w-full resize-y p-2 text-sm" value={draft[key]} onChange={e => setDraft(current => ({ ...current, [key]: e.target.value }))} /> : <input className="pq-input mt-1 w-full p-2 text-sm" value={draft[key]} onChange={e => setDraft(current => ({ ...current, [key]: e.target.value }))} />}</label>)}</div>{error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" disabled={saving} className="pq-button px-3 py-2 text-xs" onClick={() => setOpen(false)}>{l('取消', 'Cancel')}</button><button type="submit" disabled={saving} className="pq-button-primary px-4 py-2 text-xs">{saving ? l('保存中…', 'Saving…') : l('保存修改', 'Save changes')}</button></div></form></div></div>, document.body)}
  </span>;
}

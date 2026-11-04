import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Loader2, Search, X } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LiteratureCategory, LiteraturePaper, UpdatePaperCategoriesRequest } from '../../../types/library';
import { categoryPath, flattenCategories } from '../literatureUi';

export function PaperCategoryDialog({ paper, categories, onSave, onClose }: {
  paper: LiteraturePaper; categories: LiteratureCategory[];
  onSave: (request: UpdatePaperCategoriesRequest) => Promise<void>; onClose: () => void;
}) {
  const l = useLocaleText();
  const [selected, setSelected] = useState(() => new Set(paper.categoryIds));
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const choices = flattenCategories(categories).filter(category => !category.isSystem).map(category => ({ ...category, path: categoryPath(category.id, categories) }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await onSave({ paperId: paper.id, addCategoryIds: [...selected].filter(id => !paper.categoryIds.includes(id)), removeCategoryIds: paper.categoryIds.filter(id => !selected.has(id)) });
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="pq-saas-scope fixed inset-0 z-[10010] flex items-center justify-center bg-black/30 p-5" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={l('管理文献分类', 'Manage paper categories')} className="pq-card flex max-h-[85vh] w-full max-w-lg flex-col p-5 shadow-xl" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
        const last = controls[controls.length - 1];
        const target = event.shiftKey ? last : controls[0];
        if (event.shiftKey && document.activeElement === controls[0] || !event.shiftKey && document.activeElement === last) { event.preventDefault(); target?.focus(); }
      }
    }}>
      <header className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><FolderOpen className="h-4 w-4 text-[var(--pq-accent)]" />{l('管理分类（可多选）', 'Categories (multiple selection)')}</h2><button type="button" disabled={busy} aria-label={l('关闭分类管理', 'Close category manager')} className="pq-icon-button h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></button></header>
      <p className="mt-2 line-clamp-2 text-sm leading-6" title={paper.title}>{paper.title}</p>
      <p className="my-3 text-xs leading-5 text-[var(--pq-text-muted)]">{l('可同时放入多个分类。取消勾选只从该分类移除，PDF、笔记和译文会保留。', 'A paper can belong to multiple categories. Unchecking removes only that membership; its PDF, notes and translations are kept.')}</p>
      <label className="relative block shrink-0"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--pq-text-muted)]" /><input disabled={busy} aria-label={l('搜索分类', 'Search categories')} placeholder={l('搜索分类', 'Search categories')} className="pq-input h-10 w-full pl-9 pr-3 text-sm" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="my-3 min-h-0 space-y-1 overflow-y-auto">
        {choices.filter(category => category.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(category => <label key={category.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--pq-accent-soft)]"><input type="checkbox" disabled={busy} checked={selected.has(category.id)} className="accent-teal-600" onChange={event => { const checked = event.currentTarget.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(category.id); else next.delete(category.id); return next; }); }} /><span className="min-w-0 break-words">{category.path}</span></label>)}
        {!choices.length && <p className="py-4 text-sm text-[var(--pq-text-muted)]">{l('请先在左侧新建分类。', 'Create a category in the left sidebar first.')}</p>}
      </div>
      {!selected.size && <p className="mb-3 text-xs text-[var(--pq-text-muted)]">{l('未选择分类，保存后可在“未分类”中找到此文献。', 'With no category selected, this paper will appear under Uncategorized.')}</p>}
      {error && <p role="alert" className="mb-3 break-words text-xs leading-5 text-rose-600">{error}</p>}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--pq-border)] pt-3"><span className="text-xs text-[var(--pq-text-muted)]">{l(`已选择 ${selected.size} 个分类`, `${selected.size} categories selected`)}</span><div className="flex gap-2"><button type="button" disabled={busy} className="pq-button px-3 py-2 text-xs" onClick={onClose}>{l('取消', 'Cancel')}</button><button type="button" disabled={busy} className="pq-button-primary gap-1.5 px-3 py-2 text-xs" onClick={() => void save()}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{l('保存分类', 'Save categories')}</button></div></footer>
    </div>
  </div>, document.body);
}

import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { LiteraturePaper, LiteratureTag, UpdatePaperRequest } from '../../../types/library';
import { invoke } from '../../../platform/electron/core';
import { useLocaleText } from '../../../i18n/uiLanguage';
import { LibraryPopover } from './LibraryPopover';

export function PaperTags({ paper, saving, onSave }: { paper: LiteraturePaper; saving: boolean; onSave: (request: UpdatePaperRequest) => Promise<boolean> }) {
  const l = useLocaleText();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!anchor) return;
    let active = true;
    void invoke<LiteratureTag[]>('library_list_tags').then(tags => { if (active) setAvailable(tags.map(tag => tag.name)); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [anchor]);
  const choices = Array.from(new Map([...available, ...selected].map(name => [name.toLocaleLowerCase(), name])).values());
  const search = query.trim();
  const exists = choices.find(name => name.toLocaleLowerCase() === search.toLocaleLowerCase());
  const contains = (name: string) => selected.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase());
  const toggle = (name: string) => setSelected(current => contains(name) ? current.filter(value => value.toLocaleLowerCase() !== name.toLocaleLowerCase()) : [...current, name]);
  const create = () => { if (search) { if (!contains(exists || search)) setSelected(current => [...current, exists || search]); setQuery(''); } };
  return <div className="mt-2 flex flex-wrap items-center gap-1.5" data-paper-tags onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    {paper.tags.map((tag, index) => <span key={tag.id} className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${['bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-200', 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200', 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200'][index % 3]}`}><span className="break-all">{tag.name}</span><button type="button" disabled={saving} title={l(`移除标签：${tag.name}`, `Remove tag: ${tag.name}`)} aria-label={l(`移除标签：${tag.name}`, `Remove tag: ${tag.name}`)} className="rounded p-0.5 hover:bg-black/5 disabled:opacity-50" onClick={() => void onSave({ paperId: paper.id, tags: paper.tags.filter(value => value.id !== tag.id).map(value => value.name) })}><X className="h-3 w-3" /></button></span>)}
    <button type="button" disabled={saving} aria-expanded={!!anchor} className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--pq-accent-border)] px-2 py-1 text-[11px] text-[var(--pq-accent)] hover:bg-[var(--pq-accent-soft)]" onClick={event => { setSelected(paper.tags.map(tag => tag.name)); setQuery(''); setError(''); setAnchor(anchor ? null : event.currentTarget); }}><Plus className="h-3 w-3" />{l('添加标签', 'Add tags')}</button>
    {anchor && <LibraryPopover anchor={anchor} label={l('添加标签', 'Add tags')} onClose={() => setAnchor(null)}>
      <div className="mb-3 flex items-center justify-between text-sm font-semibold"><span>{l('添加标签', 'Add tags')}</span><span className="text-xs font-normal text-[var(--pq-text-muted)]">{l('可多选', 'Multiple selection')}</span></div>
      <form onSubmit={e => { e.preventDefault(); create(); }}><label className="relative block"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--pq-text-muted)]" /><input aria-label={l('搜索或新建标签', 'Search or create a tag')} className="pq-input h-9 w-full pl-8 pr-2 text-xs" placeholder={l('搜索或新建标签', 'Search or create a tag')} value={query} onChange={event => setQuery(event.target.value)} /></label></form>
      <div className="my-2 max-h-56 space-y-0.5 overflow-y-auto">{choices.filter(name => name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((name, index) => <label key={name.toLocaleLowerCase()} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-[var(--pq-accent-soft)]"><input type="checkbox" className="accent-teal-600" checked={contains(name)} onChange={() => toggle(name)} /><span className={`h-2 w-2 shrink-0 rounded-full ${['bg-teal-400', 'bg-sky-400', 'bg-amber-400', 'bg-violet-400'][index % 4]}`} /><span className="break-all">{name}</span></label>)}{!choices.length && <p className="px-2 py-3 text-xs text-[var(--pq-text-muted)]">{l('输入名称即可新建标签', 'Enter a name to create a tag')}</p>}</div>
      {error && <p role="alert" className="my-2 break-words text-xs text-rose-600">{error}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--pq-border)] pt-3"><button type="button" disabled={!search || !!exists} className="inline-flex items-center gap-1 text-xs text-[var(--pq-accent)] disabled:opacity-40" onClick={create}><Plus className="h-3.5 w-3.5" />{search && !exists ? l(`新建“${search}”`, `Create “${search}”`) : l('新建标签', 'New tag')}</button><button type="button" className="pq-button-primary shrink-0 px-3 py-2 text-xs" disabled={saving} onClick={async () => { if (await onSave({ paperId: paper.id, tags: selected })) setAnchor(null); }}>{l(`应用（${selected.length}）`, `Apply (${selected.length})`)}</button></div>
    </LibraryPopover>}
  </div>;
}

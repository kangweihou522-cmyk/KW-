import { useMemo, useState } from 'react';
import { FilePlus2, PanelRightClose, Plus, Search, Trash2 } from 'lucide-react';
import type { Note, NoteAnchor, NoteAnchorInsertRequest, UpdateNoteRequest } from '../../types/notes';
import type { LiteraturePaper } from '../../types/library';
import type { SelectedExcerpt } from '../../types/reader';
import { NoteEditor } from './NoteEditor';
interface NotesSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  papers?: LiteraturePaper[];
  documentTitle?: string;
  loading: boolean;
  saving: boolean;
  error: string;
  selectedExcerpt: SelectedExcerpt | null;
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  externalUpdateNote?: Note | null;
  noteEditorSourceId?: string;
  onExternalUpdateApply?: (note: Note) => void;
  onAddSelectionToNote: () => void;
  onCreateStandaloneNote: () => void;
  onSelectNote: (note: Note) => void;
  onUpdateNote: (noteId: string, patch: UpdateNoteRequest, options?: { sourceId?: string }) => Note | void | Promise<Note | void>;
  onDeleteNote: (noteId: string) => void;
  onJumpToNoteAnchor: (note: Note, anchor: NoteAnchor) => void;
  onPaperClick?: (paperId: string) => void;
  onCollapse?: () => void;
}


export function NotesSidebar(props: NotesSidebarProps) {
  const [search, setSearch] = useState('');
  const activeNote = props.notes.find(note => note.id === props.activeNoteId) ?? props.notes[0] ?? null;
  const filtered = useMemo(() => props.notes.filter(note => [note.title, note.contentText, ...note.tags].join(' ').toLowerCase().includes(search.trim().toLowerCase())), [props.notes, search]);
  return <div className="flex h-full min-h-0 flex-col bg-[var(--pq-surface-1)]" data-reader-notes>
    <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[var(--pq-text-faint)]"><Search className="h-3.5 w-3.5" /><input aria-label="搜索笔记" placeholder="搜索笔记" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent p-1 text-xs outline-none" /></label>
      {props.selectedExcerpt?.text.trim() && <button type="button" aria-label="加入当前笔记" title="加入当前笔记" className="pq-icon-button h-7 w-7" onClick={props.onAddSelectionToNote}><FilePlus2 className="h-3.5 w-3.5" /></button>}
      <button type="button" aria-label="新建笔记" title="新建笔记" className="pq-icon-button h-7 w-7 text-[var(--pq-accent)]" onClick={props.onCreateStandaloneNote}><Plus className="h-4 w-4" /></button>
      {activeNote && <button type="button" aria-label="删除当前笔记" title="删除当前笔记" className="pq-icon-button h-7 w-7" onClick={() => props.onDeleteNote(activeNote.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
      {props.onCollapse && <button type="button" aria-label="收起侧边栏" title="收起侧边栏" className="pq-icon-button h-7 w-7" onClick={props.onCollapse}><PanelRightClose className="h-3.5 w-3.5" /></button>}
    </div>
    {props.error && <p role="alert" className="px-3 py-1 text-xs text-rose-600">{props.error}</p>}
    {(props.notes.length > 1 || search) && <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-2">{filtered.map(note => <button type="button" key={note.id} aria-pressed={activeNote?.id === note.id} className={`max-w-full truncate rounded-full border border-[var(--pq-border)] px-2.5 py-1 text-xs ${activeNote?.id === note.id ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]' : 'text-[var(--pq-text-muted)]'}`} onClick={() => props.onSelectNote(note)}>{note.title || '未命名笔记'}</button>)}{!filtered.length && <span className="text-xs text-[var(--pq-text-faint)]">没有匹配的笔记</span>}</div>}
    <div className="flex min-h-0 flex-1 px-2 pb-2"><NoteEditor key={activeNote?.id || 'empty'} note={activeNote} saving={props.saving} onUpdate={props.onUpdateNote} notes={props.notes} papers={props.papers} pendingAnchorInsert={props.pendingAnchorInsert} onPendingAnchorInsertHandled={props.onPendingAnchorInsertHandled} editorSourceId={props.noteEditorSourceId} externalUpdateNote={props.externalUpdateNote} onExternalUpdateApply={props.onExternalUpdateApply} onJumpToNoteAnchor={props.onJumpToNoteAnchor} onPaperClick={props.onPaperClick} compact previewWhenSaved /></div>
  </div>;
}

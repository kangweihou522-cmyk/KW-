import { useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { LibraryPopover } from '../literature/components/LibraryPopover';
import { invoke } from '../../platform/electron/core';
type Section = { id: string; title: string; content: string };
type Draft = { sourceId: string; baseVersion: number; content: Section[]; updatedAt: number };
interface Document { version: number; content: Section[] | null; updatedAt: number | null; drafts?: Draft[]; }
interface Version { version: number; content: Section[]; updatedAt: number; }
const eventName = 'paperdesk:personal-overview-updated';
const defaults = (): Section[] => [{ id: 'overview', title: '文献概览', content: '' }, { id: 'team', title: '团队简介', content: '' }, { id: 'abstract', title: '摘要', content: '' }];
function valid(value: unknown): value is Section[] { return Array.isArray(value) && value.every(s => typeof s.id === 'string' && typeof s.title === 'string' && typeof s.content === 'string'); }
export function PaperPersonalOverview({ paperId, editable = false }: { paperId: string; editable?: boolean }) {
  const [sections, setSections] = useState<Section[]>(defaults); const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(editable); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [dirty, setDirty] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]); const [history, setHistory] = useState<Version[]>([]); const [preview, setPreview] = useState<Version | null>(null);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
  const sourceId = useRef(crypto.randomUUID()); const dirtyRef = useRef(false); const loadedPaper = useRef(paperId);
  useEffect(() => {
    let active = true; loadedPaper.current = paperId; setLoaded(false); setSections(defaults()); setHistoryAnchor(null); dirtyRef.current = false; setDirty(false); setHistory([]); setPreview(null); setError(''); setStatus(''); setEditing(editable);
    async function load() {
      try {
        const current = await invoke<Document>('paper_document_get', { paperId });
        if (!active) return;
        if (dirtyRef.current) { setStatus('其他窗口已更新概览。你的草稿保留，保存前请重新加载并核对。'); return; }
        setVersion(current.version); setSections(valid(current.content) ? current.content : defaults()); setDrafts((current.drafts || []).filter(d => valid(d.content)));
        // Earlier builds used browser storage. Offer migration/recovery without overwriting database content.
        let legacy: string | null = null; try { legacy = localStorage.getItem(`paperdesk:personal-overview:v1:${paperId}`); } catch { /* Browser cache is optional. */ }
        if (!current.version && legacy) { const value = JSON.parse(legacy); if (valid(value)) setDrafts(d => [...d, { sourceId: 'legacy', baseVersion: 0, content: value, updatedAt: 0 }]); }
        setLoaded(true);
      } catch (e) { if (active) setError(String(e)); }
    }
    void load();
    const update = (event: Event) => { if ((event as CustomEvent).detail?.paperId === paperId) void load(); };
    window.addEventListener(eventName, update);
    return () => { active = false; window.removeEventListener(eventName, update); };
  }, [paperId, editable]);
  useEffect(() => {
    if (!dirty || !loaded || loadedPaper.current !== paperId) return;
    const timer = window.setTimeout(() => { void invoke('paper_document_draft', { paperId, sourceId: sourceId.current, baseVersion: version, content: sections }).then(() => setStatus('草稿已保存在本地数据库，点击保存发布此版本。')).catch(e => setError(String(e))); }, 350);
    return () => clearTimeout(timer);
  }, [sections, dirty, loaded, paperId, version]);
  function change(next: Section[]) {
    dirtyRef.current = true; setDirty(true); setSections(next); setStatus('有未保存修改');
    try { localStorage.setItem(`paperdesk:personal-overview:v1:${paperId}`, JSON.stringify(next)); }
    catch { setError('草稿缓存不可用，请及时点击保存。'); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await invoke<Document>('paper_document_save', { paperId, content: sections, expectedVersion: version, sourceId: sourceId.current });
      setVersion(result.version); dirtyRef.current = false; setDirty(false); setStatus('已保存'); setHistory([]); setPreview(null);
      try { localStorage.removeItem(`paperdesk:personal-overview:v1:${paperId}`); } catch { /* Database save remains successful. */ }
      window.dispatchEvent(new CustomEvent(eventName, { detail: { paperId } }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="pq-card space-y-3 p-4" data-personal-overview>
    <header className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">我的文献概览</h3><div className="flex items-center gap-0.5">
      <span role="status" title={status || (loaded ? version ? `本地版本 ${version}` : '尚未填写' : '正在读取…')} className="text-[var(--pq-accent)]">{!loaded || busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : dirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500 block" /> : version > 0 ? <Check className="h-3.5 w-3.5" /> : null}<span className="sr-only">{status || (loaded ? version ? `本地版本 ${version}` : '尚未填写' : '正在读取本地内容…')}</span></span>
      <button type="button" disabled={!loaded || busy} className="pq-icon-button h-7 w-7" title={editing ? '预览概览' : '编辑我的文献概览'} aria-label={editing ? '预览概览' : '编辑我的文献概览'} onClick={() => setEditing(!editing)}>{editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}</button>
      <button type="button" disabled={!loaded || busy} className="pq-icon-button h-7 w-7 text-[var(--pq-accent)]" title="添加概览栏目" aria-label="添加概览栏目" onClick={() => { change([...sections, { id: crypto.randomUUID(), title: '自定义栏目', content: '' }]); setEditing(true); }}><Plus className="h-4 w-4" /></button>
      <button type="button" className="pq-icon-button h-7 w-7" title="概览历史版本与恢复" aria-label="概览历史版本与恢复" onClick={e => { setHistoryAnchor(historyAnchor ? null : e.currentTarget); void invoke<Version[]>('paper_document_history', { paperId }).then(setHistory).catch(e => setError(String(e))); }}><History className="h-3.5 w-3.5" /></button>
    </div></header>
    {error && <p role="alert" className="break-words text-xs text-rose-600">{error}</p>}
    {status.startsWith('其他窗口') && <p className="text-xs leading-5 text-amber-700">{status}</p>}
    {!!drafts.length && <details className="rounded-lg border border-[var(--pq-border)] p-2 text-xs"><summary className="cursor-pointer">可恢复草稿（{drafts.length}）</summary>{drafts.map(d => <button key={d.sourceId} type="button" className="pq-button mt-2 block p-2" onClick={() => { setVersion(d.baseVersion); change(d.content); setEditing(true); }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '旧版概览'} · 载入草稿</button>)}</details>}
    {sections.map(section => <div key={section.id} className="space-y-2 rounded-lg border-l-2 border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)]/40 px-3 py-2.5">
      {editing ? <div className="flex items-center gap-1"><input disabled={!loaded || busy} aria-label="栏目标题" className="pq-input min-w-0 flex-1 px-2 py-1.5 text-sm font-medium" value={section.title} onChange={e => change(sections.map(s => s.id === section.id ? { ...s, title: e.target.value } : s))} /><button type="button" disabled={!loaded || busy} className="pq-icon-button h-7 w-7 text-[var(--pq-text-muted)] hover:text-rose-600" title={`删除栏目：${section.title}`} aria-label={`删除栏目：${section.title}`} onClick={() => change(sections.filter(s => s.id !== section.id))}><Trash2 className="h-3.5 w-3.5" /></button></div> : <h4 className="text-sm font-medium">{section.title}</h4>}
      {editing ? <textarea disabled={!loaded || busy} aria-label={section.title || '栏目内容'} className="pq-input min-h-24 w-full resize-y p-2 text-sm leading-7" placeholder="整理你的理解…" value={section.content} onChange={e => change(sections.map(s => s.id === section.id ? { ...s, content: e.target.value } : s))} /> : <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--pq-text-muted)]">{section.content || '尚未填写'}</p>}
    </div>)}
    {editing && <div className="flex items-center justify-between gap-2"><button type="button" disabled={!loaded || busy} className="inline-flex items-center gap-1 text-xs text-[var(--pq-accent)]" onClick={() => change([...sections, { id: crypto.randomUUID(), title: '自定义栏目', content: '' }])}><Plus className="h-3.5 w-3.5" />添加栏目</button><button type="button" className="pq-button-primary inline-flex gap-1 px-3 py-1.5 text-xs" disabled={!loaded || busy || !dirty} onClick={() => void save()}><Save className="h-3.5 w-3.5" />{busy ? '保存中…' : '保存'}</button></div>}
    {historyAnchor && <LibraryPopover anchor={historyAnchor} label="概览历史版本与恢复" width={320} onClose={() => setHistoryAnchor(null)}><h4 className="mb-2 text-sm font-semibold">历史版本与恢复</h4>{!history.length && <p className="text-xs text-[var(--pq-text-muted)]">暂无历史版本</p>}{history.map(v => <button type="button" key={v.version} className="pq-button my-1 block w-full p-2 text-xs" onClick={() => setPreview(v)}>版本 {v.version} · {new Date(v.updatedAt).toLocaleString()}</button>)}{preview && <div className="mt-2 space-y-2"><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6">{preview.content.map(s => `${s.title}\n${s.content}`).join('\n\n')}</pre><button type="button" className="pq-button p-2 text-xs" onClick={() => { change(preview.content); setEditing(true); setHistoryAnchor(null); }}>载入此版本</button></div>}</LibraryPopover>}
    {dirty && <button type="button" className="text-[11px] text-[var(--pq-text-muted)] underline" onClick={() => void invoke<Document>('paper_document_get', { paperId }).then(current => { setVersion(current.version); setStatus('已读取最新版本号，请对照正文后保存。'); setPreview({ version: current.version, content: valid(current.content) ? current.content : defaults(), updatedAt: current.updatedAt || 0 }); }).catch(e => setError(String(e)))}>比较最新版本</button>}
    {dirty && preview && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--pq-border)] p-3 text-xs leading-6">{preview.content.map(s => `${s.title}\n${s.content}`).join('\n\n')}</pre>}
  </section>;
}

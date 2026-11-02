import { useEffect, useRef, useState } from 'react';
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
  const sourceId = useRef(crypto.randomUUID()); const dirtyRef = useRef(false); const loadedPaper = useRef(paperId);
  useEffect(() => {
    let active = true; loadedPaper.current = paperId; setLoaded(false); dirtyRef.current = false; setDirty(false); setHistory([]); setPreview(null); setError(''); setStatus(''); setEditing(editable);
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
      setVersion(result.version); dirtyRef.current = false; setDirty(false); setStatus(`已保存本地版本 ${result.version}`); setHistory([]); setPreview(null);
      try { localStorage.removeItem(`paperdesk:personal-overview:v1:${paperId}`); } catch { /* Database save remains successful. */ }
      window.dispatchEvent(new CustomEvent(eventName, { detail: { paperId } }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">我的文献概览</h3><div className="flex gap-2"><button type="button" className="pq-button p-2 text-xs" onClick={() => setEditing(!editing)}>{editing ? '预览' : '编辑'}</button>{editing && <button type="button" className="pq-button p-2 text-xs" disabled={!loaded || busy || !dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>}</div></div>
    {error && <p role="alert" className="break-words text-xs text-rose-600">{error}</p>}
    <p role="status" className="text-xs text-slate-500">{status || (loaded ? version ? `本地版本 ${version}` : '尚未填写，可直接编辑，无需AI' : '正在读取本地内容…')}</p>
    {!!drafts.length && <details className="rounded-lg border p-2 text-xs"><summary className="cursor-pointer">发现可恢复草稿（{drafts.length}）</summary>{drafts.map(d => <button key={d.sourceId} type="button" className="pq-button mt-2 block p-2" onClick={() => { setVersion(d.baseVersion); change(d.content); setEditing(true); }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '旧版概览'} · 载入草稿</button>)}</details>}
    {sections.map(section => <div key={section.id} className="space-y-2 border-t border-slate-100 pt-3 dark:border-white/10">
      {editing ? <div className="flex gap-2"><input disabled={!loaded} aria-label="栏目标题" className="pq-input min-w-0 flex-1 p-2 font-medium" value={section.title} onChange={e => change(sections.map(s => s.id === section.id ? { ...s, title: e.target.value } : s))} /><button type="button" disabled={!loaded} className="text-xs text-slate-500" onClick={() => change(sections.filter(s => s.id !== section.id))}>删除</button></div> : <h4 className="text-sm font-medium">{section.title}</h4>}
      {editing ? <textarea disabled={!loaded} aria-label={section.title || '栏目内容'} className="pq-input min-h-36 w-full resize-y p-3 text-sm leading-7" placeholder="在这里整理你的理解…" value={section.content} onChange={e => change(sections.map(s => s.id === section.id ? { ...s, content: e.target.value } : s))} /> : <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-500">{section.content || '尚未填写'}</p>}
    </div>)}
    {editing && <button type="button" disabled={!loaded} className="pq-button w-full p-2 text-sm" onClick={() => change([...sections, { id: crypto.randomUUID(), title: '自定义栏目', content: '' }])}>＋ 添加栏目</button>}
    <details className="rounded-lg border p-2 text-xs" onToggle={e => { if (e.currentTarget.open) void invoke<Version[]>('paper_document_history', { paperId }).then(setHistory).catch(e => setError(String(e))); }}><summary className="cursor-pointer">历史版本与恢复</summary>{history.map(v => <button type="button" key={v.version} className="pq-button m-1 p-2" onClick={() => setPreview(v)}>版本 {v.version} · {new Date(v.updatedAt).toLocaleString()}</button>)}{preview && <div className="mt-2 space-y-2"><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{preview.content.map(s => `${s.title}\n${s.content}`).join('\n\n')}</pre><button type="button" className="pq-button p-2" onClick={() => { change(preview.content); setEditing(true); }}>载入此版本（点击保存后生效）</button></div>}</details>
    {dirty && <button type="button" className="text-xs underline" onClick={() => void invoke<Document>('paper_document_get', { paperId }).then(current => { setVersion(current.version); setStatus('已读取最新版本号，当前草稿保留。请核对下方最新正文后保存，避免覆盖其他人的修改。'); setPreview({ version: current.version, content: valid(current.content) ? current.content : defaults(), updatedAt: current.updatedAt || 0 }); }).catch(e => setError(String(e)))}>读取最新版本以比较</button>}
    {dirty && preview && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">最新保存内容：\n{preview.content.map(s => `${s.title}\n${s.content}`).join('\n\n')}</pre>}
  </section>;
}

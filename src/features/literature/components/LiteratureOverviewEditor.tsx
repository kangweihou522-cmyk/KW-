import { useMemo, useState } from 'react';
import { invoke } from '../../../platform/electron/core';
import type { LiteraturePaper } from '../../../types/library';
import { editableOverviewParts, replaceOverviewPart } from '../overviewEditing';

interface Version { id: string; createdAt: string; reason: string; overview: string; }
export default function LiteratureOverviewEditor({ paperId, initialOverview, onClose }: { paperId: string; initialOverview: string; onClose: () => void }) {
  const key = `paperdesk:overview-draft:${paperId}`;
  const [initial] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (typeof saved?.content === 'string' && typeof saved?.base === 'string') return saved as { base: string; content: string }; } catch { /* Keep the saved library version accessible. */ }
    return { base: initialOverview, content: initialOverview };
  });
  const [base, setBase] = useState(initial.base); const [content, setContent] = useState(initial.content);
  const [selectedPart, setSelectedPart] = useState('all');
  const [status, setStatus] = useState(''); const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]); const [versionId, setVersionId] = useState('');
  const parts = useMemo(() => editableOverviewParts(content), [content]);
  const part = parts.find(item => item.id === selectedPart);
  const dirty = content !== base;
  function change(next: string) {
    setContent(next);
    try { localStorage.setItem(key, JSON.stringify({ base, content: next })); setStatus('草稿已在本机保留，点击保存写入文库。'); }
    catch { setStatus('草稿自动保留失败，请点击保存或先复制当前内容。'); }
  }
  async function run(action: () => Promise<void>) {
    setSaving(true); setStatus('');
    try { await action(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  function saved(paper: LiteraturePaper) {
    setBase(paper.aiSummary || ''); setContent(paper.aiSummary || ''); localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent('paperquay:native-summary-updated', { detail: { paperId, aiSummary: paper.aiSummary } }));
    setStatus('概览已保存到本地，之前的已保存内容保留在历史版本中。');
  }
  return <div className="mt-3 space-y-3 rounded-xl border border-teal-200 bg-teal-50/30 p-3 text-xs">
    <p className="leading-5">无需登录或 AI，可手工编写全部内容。修改保存到当前文献；保留旧概览与报告，后续打开不调用模型。</p>
    {base !== initialOverview ? <p className="text-amber-700">草稿基于较早版本。保存会检查冲突，不会覆盖其他窗口的新内容；可复制后加载最新版本。</p> : null}
    {parts.length ? <label className="flex items-center gap-2">编辑范围<select aria-label="概览编辑部分" className="pq-input min-w-0 flex-1 p-2" value={part ? selectedPart : 'all'} onChange={event => setSelectedPart(event.target.value)}><option value="all">全文（保留所有部分）</option>{parts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
    <textarea aria-label="文献概览编辑器" className="pq-input min-h-64 w-full resize-y p-3 text-sm leading-7" disabled={saving} value={part ? content.slice(part.start, part.end) : content}
      onChange={event => change(part ? replaceOverviewPart(content, selectedPart, event.target.value) : event.target.value)} placeholder="直接填写概览。可用 ## 背景、## 方法、## 结果 等标题组织内容。" />
    <div className="flex flex-wrap gap-2">
      <button type="button" className="pq-button px-3 py-2" disabled={saving} onClick={() => void run(async () => { saved(await invoke<LiteraturePaper>('reading_overview_save', { paperId, content, expectedOverview: base })); })}>{saving ? '保存中…' : '保存概览'}</button>
      <button type="button" className="pq-button px-3 py-2" disabled={saving} onClick={onClose}>{dirty ? '收起（保留草稿）' : '完成编辑'}</button>
      <button type="button" className="pq-button px-3 py-2" disabled={saving} onClick={() => void run(async () => { setVersions(await invoke<Version[]>('reading_history_list', { paperId })); })}>历史版本</button>
      <button type="button" className="pq-button px-3 py-2" disabled={saving} onClick={() => {
        try {
          if (dirty) localStorage.setItem(`${key}:backup:${Date.now()}`, JSON.stringify({ base, content }));
          setBase(initialOverview); setContent(initialOverview); localStorage.removeItem(key); setSelectedPart('all'); setStatus('已加载最新概览，原草稿已另存本机。');
        } catch { setStatus('无法另存草稿，当前内容仍保留，请先复制。'); }
      }}>加载最新概览（另存草稿）</button>
    </div>
    {versions.length ? <div className="space-y-2"><select aria-label="概览历史版本" className="pq-input w-full p-2" value={versionId} onChange={event => setVersionId(event.target.value)}><option value="">选择历史版本预览</option>{versions.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.reason}</option>)}</select>
      {versionId ? <><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 leading-6">{versions.find(item => item.id === versionId)?.overview}</pre><button type="button" className="pq-button px-3 py-2" disabled={saving || dirty} onClick={() => void run(async () => { const result = await invoke<{ paper: LiteraturePaper }>('reading_history_restore', { paperId, id: versionId, target: 'overview', expectedOverview: base }); saved(result.paper); })}>恢复此概览版本</button>{dirty ? <p>请先保存当前草稿，再恢复历史版本。</p> : null}</> : null}
    </div> : null}
    {status ? <p role="status" className="break-words leading-5">{status}</p> : null}
  </div>;
}

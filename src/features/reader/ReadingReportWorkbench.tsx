import { useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { emitNoteChanged } from '../../app/appEvents';
import { getChatGptReport, saveReadingReport } from '../../services/readingWorkflow';
import type { Note } from '../../types/notes';

interface Version { id: string; createdAt: string; reason: string; reportText: string; }
interface Draft { text: string; base: Note | null; }
const noteText = (note: Note | null) => note?.contentText || note?.content || '';

/** Mount with a paperId key: drafts and optimistic-save versions belong to one paper. */
export function ReadingReportWorkbench({ paperId, title, report, loaded, generating, onSaved }: {
  paperId: string; title: string; report: Note | null; loaded: boolean; generating: boolean; onSaved: (note: Note) => void;
}) {
  const key = `paperdesk:reading-report-draft:${paperId}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (typeof saved?.text === 'string' && (saved.base === null || saved.base?.paperId === paperId)) return saved;
    } catch { /* The durable report can still be loaded. */ }
    return { text: noteText(report), base: report };
  });
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [versions, setVersions] = useState<Version[]>([]), [versionId, setVersionId] = useState('');
  const dirty = draft.text !== noteText(draft.base);

  useEffect(() => {
    if (!loaded) return;
    setDraft(previous => previous.text !== noteText(previous.base) ? previous : { text: noteText(report), base: report });
  }, [loaded, report]);

  function edit(text: string) {
    const next = { ...draft, text }; setDraft(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setStatus('草稿已在本机保留，保存后写入文献笔记。'); }
    catch { setStatus('草稿自动保留失败，请先复制内容或保存报告。'); }
  }
  function accepted(note: Note) {
    setDraft({ text: noteText(note), base: note }); onSaved(note);
    try { localStorage.removeItem(key); } catch { /* A stale draft remains recoverable. */ }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await action(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const selected = versions.find(version => version.id === versionId);
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold">报告工作台</h3>
    <p className="text-xs leading-6 text-slate-500">可直接手工编写和修改，无需连接模型。保存前保留历史版本；其他窗口更新后，保存会提示冲突。</p>
    {report?.updatedAt !== draft.base?.updatedAt && dirty ? <p className="text-xs text-amber-700">已有新的本地报告。当前编辑草稿仍保留，可另存草稿并加载最新报告。</p> : null}
    <textarea aria-label="读书报告编辑器" value={draft.text} onChange={event => edit(event.target.value)} disabled={busy}
      className="pq-input min-h-72 w-full resize-y p-3 text-sm leading-7" placeholder="在此编写报告，或生成报告后继续修改。" />
    <div className="flex flex-wrap gap-2 text-xs">
      <button className="pq-button px-3 py-2" type="button" disabled={!loaded || !draft.text.trim() || busy || generating} onClick={() => void run(async () => {
        accepted(await saveReadingReport(paperId, title, draft.text, draft.base)); setStatus('报告已保存到本地。');
      })}>{busy ? '处理中…' : '保存报告'}</button>
      <button className="pq-button px-3 py-2" type="button" disabled={!loaded || busy || generating} onClick={() => void run(async () => {
        if (dirty) localStorage.setItem(`${key}:backup:${Date.now()}`, JSON.stringify(draft));
        const latest = await getChatGptReport(paperId);
        setDraft({ text: noteText(latest), base: latest });
        if (latest) onSaved(latest);
        try { localStorage.removeItem(key); } catch { /* Keep the backup. */ }
        setStatus(dirty ? '原草稿已另存本机，已加载最新报告。' : '已加载最新报告。');
      })}>加载最新报告（另存草稿）</button>
      <button className="pq-button px-3 py-2" type="button" disabled={busy} onClick={() => void run(async () => {
        setVersions(await invoke<Version[]>('reading_history_list', { paperId })); setStatus('已读取历史版本。');
      })}>历史版本</button>
    </div>
    {versions.length ? <div className="space-y-2 text-xs">
      <select aria-label="报告历史版本" className="pq-input w-full p-2" value={versionId} onChange={event => setVersionId(event.target.value)}>
        <option value="">选择历史报告预览</option>
        {versions.filter(version => version.reportText).map(version => <option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.reason}</option>)}
      </select>
      {selected ? <><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 leading-6">{selected.reportText}</pre>
        <button type="button" className="pq-button px-3 py-2" disabled={dirty || busy || generating} onClick={() => void run(async () => {
          const result = await invoke<{ note: Note }>('reading_history_restore', { paperId, id: selected.id, target: 'report', expectedReportUpdatedAt: draft.base?.updatedAt ?? null, expectedReportContent: draft.base?.content ?? null });
          accepted(result.note);
          emitNoteChanged({ action: draft.base ? 'updated' : 'created', noteId: result.note.id, note: result.note, updatedAt: result.note.updatedAt });
          setStatus('已恢复报告，恢复前的内容已保留在历史版本。');
        })}>恢复此报告版本</button>{dirty ? <p>请先保存当前草稿，再恢复历史版本。</p> : null}</> : null}
    </div> : null}
    {status ? <p role="status" className="break-words text-xs leading-6">{status}</p> : null}
  </section>;
}

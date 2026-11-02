import { splitEditableReport, joinEditableReport } from './reportEditorSections';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '../../platform/electron/core';
import { listen } from '../../platform/electron/event';
import { emitNoteChanged } from '../../app/appEvents';
import { ChatGptConnection } from './ChatGptConnection';
import { getChatGptReport, saveChatGptReport, syncChatGptOverview } from '../../services/readingWorkflow';
import { useChatGptDraft, writeChatGptDraft } from './chatGptReportCache';
import type { Note } from '../../types/notes';
import { buildChatGptReadingPrompt } from './readingReport';
import { openExternalUrl } from '../../services/desktop';
import { useTabsStore } from '../../stores/useTabsStore';
const body = (note: Note) => (note.contentText || note.content).replace(/^来源：[^\n]*\n\n/, '');
interface FreeStatus { configured: boolean; model: string; fallbackEnabled: boolean; }
interface Version { id: string; savedAt: number; note: Note; }
export function ChatGptAssist({ paperId = '', paperTitle, onOpenNote }: { paperId?: string; paperTitle?: string; onOpenNote?: () => void }) {
  const draft = useChatGptDraft(paperId);
  const [sectionEditing, setSectionEditing] = useState(true);
  const [report, setReport] = useState<Note | null>(null); const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [manualStatus, setManualStatus] = useState('');
  const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState('chatgpt'); const [key, setKey] = useState('');
  const [free, setFree] = useState<FreeStatus | null>(null); const [models, setModels] = useState<{id: string; label: string}[]>([]);
  const [versions, setVersions] = useState<Version[]>([]); const [preview, setPreview] = useState<Version | null>(null);
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState('');
  useEffect(() => {
    const failed = (event: Event) => { if ((event as CustomEvent).detail?.paperId === paperId) setError('报告草稿仅保留在浏览器缓存，数据库写入失败，请及时点击保存报告。'); };
    window.addEventListener('paperdesk:report-draft-error', failed); return () => window.removeEventListener('paperdesk:report-draft-error', failed);
  }, [paperId]);
  useEffect(() => {
    let active = true; setLoaded(false); setReport(null); setStatus(''); setError(''); setVersions([]); setPreview(null); setEditing(false);
    void getChatGptReport(paperId).then(note => { if (active) { setReport(note); setLoaded(true); if (!note && !draft) void invoke<string>('report_existing_overview', {paperId}).then(text => { if (active && text && !localStorage.getItem(`paperdesk:chatgpt-draft:${paperId}`)) writeChatGptDraft(paperId,text); }).catch(e=>setError(String(e))); } }).catch(e => { if (active) setError(String(e)); });
    void invoke<FreeStatus>('report_provider_status').then(result => { if (active) setFree(result); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [paperId]);
  useEffect(() => {
    let disposed = false; let stop: (() => void) | undefined;
    void listen<{paperId: string; stage: string}>('paperdesk:report-progress', ({payload}) => { if (payload.paperId === paperId) setStatus(payload.stage); }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, [paperId]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  async function changed(note: Note) {
    setReport(note); emitNoteChanged({ action: 'updated', noteId: note.id, note, updatedAt: note.updatedAt });
    try { await syncChatGptOverview(paperId, body(note)); }
    catch { setStatus('报告已保存；文库AI概览同步失败，可稍后重试。'); return; }
    setStatus('已保存到本地，历史版本保留。阅读和编辑无需请求模型。');
  }
  return <section className="space-y-4 text-sm">
    <div className="flex items-center justify-between"><h3 className="font-semibold">文献概览与读书报告</h3><span className="text-xs text-slate-500">{report ? '本地已有报告' : '可直接手工填写'}</span></div>
    <details className="rounded-xl border p-3"><summary className="cursor-pointer">报告渠道与账户设置</summary><div className="mt-3 space-y-3">
      <ChatGptConnection />
      <div className="space-y-2 rounded-xl border p-3 text-xs"><strong>免费模型备用 · OpenRouter</strong><p className="leading-6 text-slate-500">只使用免费路由或当前标价为零的 :free 模型，额度以服务端为准。不会充值或回退收费模型；启用后会将论文提取文字发送至所选服务。</p>
        <input aria-label="OpenRouter 免费模型密钥" type="password" autoComplete="off" className="pq-input w-full p-2" value={key} onChange={e => setKey(e.target.value)} placeholder={free?.configured ? '已保存密钥；留空保留' : '填入自己的 OpenRouter API Key'} />
        <div className="flex flex-wrap gap-2"><button type="button" className="pq-button p-2" disabled={busy || !key} onClick={() => void run(async () => { setFree(await invoke<FreeStatus>('report_provider_configure', { key })); setKey(''); })}>安全保存密钥</button><button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { setFree(await invoke<FreeStatus>('report_provider_configure', { key: '', fallbackEnabled: false })); })}>移除密钥</button><button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { setModels(await invoke('report_provider_models')); })}>刷新免费模型</button></div>
        {models.length > 0 && <select aria-label="免费报告模型" className="pq-input w-full p-2" value={free?.model || 'openrouter/free'} onChange={e => void run(async () => { setFree(await invoke<FreeStatus>('report_provider_configure', { model: e.target.value })); })}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        <label className="flex items-start gap-2"><input type="checkbox" disabled={!free?.configured || busy} checked={free?.fallbackEnabled || false} onChange={e => void run(async () => { setFree(await invoke<FreeStatus>('report_provider_configure', { fallbackEnabled: e.target.checked })); })} />ChatGPT失败时，允许自动使用免费模型备用</label>
      </div>
    </div></details>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="报告生成渠道" className="pq-input p-2 text-xs" value={provider} onChange={e => setProvider(e.target.value)}><option value="chatgpt">ChatGPT 套餐</option><option value="openrouter-free">OpenRouter 免费模型</option></select>
      <button type="button" className="pq-button p-2" disabled={busy || !loaded || !paperId} onClick={() => void run(async () => {
        setStatus('正在读取文献及补充材料…');
        const result = await invoke<{note: Note; warnings: string[]; overviewSynced?: boolean; provider?: string}>('chatgpt_generate_report', { paperId, force: !!report, provider });
        setReport(result.note); emitNoteChanged({ action: 'updated', noteId: result.note.id, note: result.note, updatedAt: result.note.updatedAt });
        if (result.overviewSynced !== false) window.dispatchEvent(new CustomEvent('paperquay:native-summary-updated', { detail: {paperId, aiSummary: body(result.note)} }));
        setStatus(`新报告已保存本地，之前版本和未保存草稿均保留。${result.warnings.length ? ' 材料限制：' + result.warnings.join('；') : ''}`);
      })}>{busy ? '处理中…' : report ? '生成新版本' : '生成并保存报告'}</button>
      <button type="button" className="pq-button p-2" disabled={busy || !loaded} onClick={() => { if (!draft && report) writeChatGptDraft(paperId, body(report)); setEditing(true); }}>手工编辑</button>
      {report && <button type="button" className="pq-button p-2" onClick={() => { onOpenNote?.(); useTabsStore.getState().openNoteTab(report.id, report.title); }}>在笔记中打开</button>}
    </div>
    <p className="text-xs leading-6 text-slate-500">生成内容包括200–300字梗概和七部分读书报告。只分析可提取文字，并标明文件、物理页码和材料限制；图像、复杂公式和结论需对照原文。</p>
    {error && <p role="alert" className="break-words text-xs text-rose-600">{error}</p>}{status && <p role="status" className="text-xs leading-6 text-emerald-700">{status}</p>}
    {(editing || !report || draft) && <div className="space-y-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sectionEditing} onChange={e => setSectionEditing(e.target.checked)} />分部分编辑（标题、内容均可修改）</label>
      {sectionEditing ? splitEditableReport(draft).map((section,index,all) => <div key={index} className="space-y-2 rounded-xl border p-3">
        <div className="flex gap-2"><input aria-label={`报告第${index+1}部分标题`} className="pq-input min-w-0 flex-1 p-2 text-xs font-medium" value={section.title} onChange={e => { const next = [...all]; next[index] = {...section,title:e.target.value,level:section.level||2}; writeChatGptDraft(paperId,joinEditableReport(next)); }}/><button type="button" className="text-xs text-slate-500" onClick={() => writeChatGptDraft(paperId,joinEditableReport(all.filter((_,i)=>i!==index)))}>删除本部分</button></div>
        <textarea aria-label={`报告：${section.title}`} className="pq-input min-h-36 w-full resize-y p-2 text-sm leading-7" value={section.content} onChange={e=>{const next=[...all];next[index]={...section,content:e.target.value};try{writeChatGptDraft(paperId,joinEditableReport(next));}catch{setError('草稿保存失败，请复制内容后重试。');}}}/>
      </div>) : <label className="block text-xs font-medium">本地草稿 · 自动保留<textarea aria-label="读书报告本地草稿" className="pq-input mt-2 min-h-72 w-full resize-y p-3 text-sm leading-7" value={draft} onChange={e => { try { writeChatGptDraft(paperId, e.target.value); } catch { setError('草稿保存失败，请复制内容后重试。'); } }} placeholder="无须连接AI，可以直接填写梗概与读书报告。" /></label>}
      <button type="button" className="pq-button p-2 text-xs" onClick={()=>writeChatGptDraft(paperId,`${draft}${draft ? '\n\n' : ''}## 自定义部分\n\n`)}>＋ 添加报告部分</button>
      <div className="flex flex-wrap gap-2"><button type="button" className="pq-button p-2" disabled={busy || !loaded || !draft.trim()} onClick={() => void run(async () => { await changed(await saveChatGptReport(paperId, paperTitle || '文献', draft, report)); setEditing(false); })}>保存报告</button><button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { setReport(await getChatGptReport(paperId)); setStatus('本地版本已重新加载，当前草稿未覆盖。'); })}>重新加载本地版本</button>{report && <button type="button" className="pq-button p-2" disabled={busy} onClick={() => { writeChatGptDraft(paperId, body(report)); setEditing(true); }}>将已保存正文载入草稿</button>}</div>
    </div>}
    {report && <details open={!editing} className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">已保存报告 · {new Date(report.updatedAt).toLocaleString()}</summary><div className="prose prose-sm mt-4 max-w-none break-words dark:prose-invert"><ReactMarkdown>{report.contentText || report.content}</ReactMarkdown></div></details>}
    {report && <details className="space-y-2 rounded-xl border p-3" onToggle={e => { if (e.currentTarget.open) void run(async () => { setVersions(await invoke<Version[]>('notes_versions', { id: report.id })); }); }}><summary className="cursor-pointer">报告历史版本</summary>
      {versions.map(v => <button key={v.id} type="button" className="pq-button m-1 p-2 text-xs" onClick={() => setPreview(v)}>{new Date(v.savedAt).toLocaleString()}</button>)}
      {preview && <div className="space-y-2"><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6">{preview.note.contentText || preview.note.content}</pre><button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { const restored = await invoke<Note>('notes_restore_version', { id: report.id, versionId: preview.id, expectedUpdatedAt: report.updatedAt, expectedContent: report.content }); await changed(restored); setPreview(null); setVersions(await invoke('notes_versions', { id: report.id })); })}>恢复此版本（保留当前版本）</button></div>}
    </details>}
    <details className="rounded-xl border p-3"><summary className="cursor-pointer">文献提问 · 使用ChatGPT套餐额度</summary><div className="mt-3 flex gap-2"><input aria-label="文献问题" className="pq-input min-w-0 flex-1 p-2" value={question} onChange={e => setQuestion(e.target.value)} /><button type="button" className="pq-button p-2" disabled={busy || !question.trim()} onClick={() => void run(async () => { const result = await invoke<{text: string}>('chatgpt_ask_paper', { paperId, question }); setAnswer(result.text); })}>提问</button></div>{answer && <p className="mt-3 whitespace-pre-wrap leading-7">{answer}</p>}</details>
    <details className="rounded-xl border p-3"><summary className="cursor-pointer">手动网页回填</summary><p className="my-2 text-xs text-slate-500">仅复制提问材料，不会上传文献或自动生成报告。</p><div className="flex gap-2"><button type="button" className="pq-button p-2" onClick={() => void navigator.clipboard.writeText(buildChatGptReadingPrompt(paperTitle)).then(() => setManualStatus('提问材料已复制；请在网页自行附上PDF，将回答填入本地草稿后保存。')).catch(e => setManualStatus(String(e)))}>复制提问材料</button><button type="button" className="pq-button p-2" onClick={() => void openExternalUrl('https://chatgpt.com/').catch(e => setManualStatus(String(e)))}>打开ChatGPT网页</button></div><p className="mt-2 text-xs" role="status">{manualStatus}</p></details>
  </section>;
}

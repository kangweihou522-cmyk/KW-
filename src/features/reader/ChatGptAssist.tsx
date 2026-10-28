import { useState } from 'react';
import { Copy, Download, ExternalLink, Save } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { openExternalUrl } from '../../services/desktop';
import { createNote } from '../../services/notes';
import { useTabsStore } from '../../stores/useTabsStore';
import { buildChatGptReadingPrompt, buildReportNoteRequest } from './readingReport';

export function ChatGptAssist({ paperId, paperTitle }: { paperId?: string; paperTitle?: string }) {
  const l = useLocaleText();
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function run(action: () => Promise<void>) {
    setFailed(false);
    setStatus('');
    try { await action(); } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">{l('ChatGPT 网页辅助（普通账户也可手动使用）', 'ChatGPT web assistance (manual, any account)')}</summary>
      <p className="mt-3 text-xs leading-6 text-slate-600">{l('按需复制提问材料，在网页中自行附上论文和补充文件，再把回答粘贴回来。这里只打开网页，不会自动上传文献；工作站不购买额度、不调用付费 API。网页可用额度取决于你的账户。', 'Copy the prompt, attach your PDF and supplements on the website, and paste the answer back. Opening the website does not upload papers. No paid API or credits are purchased; website limits depend on your account.')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void run(async () => {
          if (!navigator.clipboard?.writeText) throw new Error(l('当前无法访问剪贴板，请从下方提问材料框手动复制。', 'Clipboard access is unavailable. Copy the prompt below manually.'));
          await navigator.clipboard.writeText(buildChatGptReadingPrompt(paperTitle));
          setStatus(l('提问材料已复制。请在 ChatGPT 网页自行附上 PDF。', 'Prompt copied. Attach the PDF yourself on ChatGPT.'));
        })} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5" />{l('复制提问材料', 'Copy prompt')}</button>
        <button type="button" onClick={() => void run(async () => {
          const url = URL.createObjectURL(new Blob([buildChatGptReadingPrompt(paperTitle)], { type: 'text/plain;charset=utf-8' }));
          const anchor = document.createElement('a');
          anchor.href = url; anchor.download = 'PaperDesk-ChatGPT-prompt.txt'; anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setStatus(l('已导出提问材料；正文和补充文件需你在网页中自行附上。', 'Prompt exported; attach the paper and supplements yourself on the website.'));
        })} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><Download className="h-3.5 w-3.5" />{l('导出提问材料', 'Export prompt')}</button>
        <button type="button" onClick={() => void run(async () => {
          await openExternalUrl('https://chatgpt.com/');
          setStatus(l('已请求浏览器打开 ChatGPT，没有上传任何文件。', 'Requested opening ChatGPT; no files were uploaded.'));
        })} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><ExternalLink className="h-3.5 w-3.5" />{l('打开 ChatGPT', 'Open ChatGPT')}</button>
      </div>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer">{l('查看或手动复制提问材料', 'View prompt')}</summary>
        <textarea readOnly value={buildChatGptReadingPrompt(paperTitle)} aria-label={l('ChatGPT 提问材料', 'ChatGPT prompt')} className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-white p-3 leading-6" />
      </details>
      <label className="mt-4 block text-xs font-medium text-slate-700" htmlFor={`chatgpt-reply-${paperId || 'global'}`}>{l('粘贴网页回答（保存后可继续自由编辑）', 'Paste the website answer (editable after saving)')}</label>
      <textarea id={`chatgpt-reply-${paperId || 'global'}`} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={l('在这里粘贴回答，核对原文证据后保存。', 'Paste the answer and check its source evidence.')} className="mt-2 min-h-32 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6" />
      <button type="button" disabled={!reply.trim() || saving} onClick={() => void run(async () => {
        setSaving(true);
        try {
          const note = await createNote(buildReportNoteRequest({ paperId, title: `${paperTitle || l('文献', 'Paper')} · ChatGPT`, text: reply, source: 'chatgpt-manual' }));
          setStatus(l('回答已保存到本地笔记。', 'Answer saved to a local note.'));
          setReply('');
          useTabsStore.getState().openNoteTab(note.id, note.title);
        } finally { setSaving(false); }
      })} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? l('保存中…', 'Saving…') : l('保存回答为笔记', 'Save answer as note')}</button>
      {status ? <p role="status" className={`mt-3 text-xs leading-6 ${failed ? 'text-rose-600' : 'text-emerald-700'}`}>{status}</p> : null}
    </details>
  );
}

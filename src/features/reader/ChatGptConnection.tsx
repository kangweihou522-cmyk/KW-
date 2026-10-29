import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { useLocaleText } from '../../i18n/uiLanguage';
interface Account { connected: boolean; plan?: string | null; }
export function ChatGptConnection() {
  const l = useLocaleText();
  const [account, setAccount] = useState<Account>({ connected: false });
  const [connecting, setConnecting] = useState(false); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const result = await invoke<Account>('chatgpt_status'); setAccount(result); if (result.connected) setConnecting(false); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }, []);
  useEffect(() => { void refresh(); const changed = () => void refresh(); window.addEventListener('paperdesk:chatgpt-account-changed', changed); return () => window.removeEventListener('paperdesk:chatgpt-account-changed', changed); }, [refresh]);
  useEffect(() => { if (!connecting) return; const timer = window.setInterval(() => void refresh(), 2000); const timeout = window.setTimeout(() => { setConnecting(false); setError(l('登录尚未完成，可刷新状态或重新连接。', 'Sign-in is not complete. Refresh or reconnect.')); }, 300000); return () => { clearInterval(timer); clearTimeout(timeout); }; }, [connecting, refresh, l]);
  return <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
    <div className="flex flex-wrap items-center gap-2"><strong>{account.connected ? `ChatGPT 已连接 · ${account.plan || '账户'}` : 'ChatGPT 账户连接'}</strong>
      <button type="button" className="pq-button px-2 py-1" disabled={connecting} onClick={() => void (async () => {
        try { setError(''); if (account.connected) { await invoke('chatgpt_disconnect'); setAccount({ connected: false }); window.dispatchEvent(new Event('paperdesk:chatgpt-account-changed')); }
          else { await invoke('chatgpt_connect'); setConnecting(true); } }
        catch (error) { setError(String(error)); }
      })()}>{account.connected ? l('断开连接', 'Disconnect') : connecting ? l('等待浏览器登录…', 'Waiting for browser sign-in…') : l('浏览器授权连接 ChatGPT', 'Connect ChatGPT in browser')}</button>
      <button type="button" className="pq-button px-2 py-1" onClick={() => void refresh()}>{l('刷新状态', 'Refresh')}</button>
    </div>
    <details open={!account.connected}><summary className="cursor-pointer text-slate-500">{account.connected ? '账户额度与连接说明' : '仅需浏览器授权，不用安装桌面客户端'}</summary><p className="leading-5">{l('只需在系统浏览器完成 OpenAI 官方 Codex 授权，无需安装或登录 Codex 桌面客户端。连接后可在工作站直接生成报告、问答和划词翻译，不再手动上传 PDF 或粘贴回答。只使用服务端确认可用的套餐内 Codex 额度；无法确认或额度用尽时停止，不购买或转用付费额度。账户权限由 OpenAI 决定，不承诺免费账户长期可用。', 'Sign in through official OpenAI Codex. Use reports, questions and selection translation in PaperDesk with your available Codex allowance. Account eligibility and limits apply; no paid API fallback.')}</p></details>
    {error ? <p role="status" className="text-rose-600">{error}</p> : null}
  </div>;
}

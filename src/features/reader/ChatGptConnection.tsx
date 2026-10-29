import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { useLocaleText } from '../../i18n/uiLanguage';
import { openExternalUrl } from '../../services/desktop';
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
    <p className="leading-5">{l('账户连接是可选功能。离线划词翻译和本地报告阅读无需登录。自动生成报告、问答使用官方 Codex 授权及账户可用额度；OpenAI 可能要求手机号验证，网页 ChatGPT 已登录也不保证授权成功。', 'Account connection is optional. Offline translation and saved reports require no login. Automated reports and questions use official Codex authorization; OpenAI may require additional account verification.')}</p>
    <button type="button" className="pq-button px-2 py-1" onClick={() => void openExternalUrl('https://chatgpt.com/').catch(error => setError(String(error)))}>打开 ChatGPT 网页（无需 Codex）</button>
    <details><summary className="cursor-pointer text-slate-500">网页登录、自动连接与费用说明</summary><p className="mt-2 leading-5">{l('可继续在浏览器用原有 Google 账号聊天；打开网页不会自动上传或分析本地文献。网页会话不能直接当作免费 API，Plus 也不附带免费的 API 调用。工作站无法取消服务方的手机号要求，不会复制网页登录凭据。自动连接仅使用服务端确认可用的套餐内 Codex 额度；无法确认或额度用尽时停止，不购买或转用付费额度。免费账户的可用性由 OpenAI 决定。', 'Browser chat remains available separately; it does not automatically access local papers. A website session or Plus subscription is not a free API. Only confirmed included Codex usage is used, with no paid fallback.')}</p></details>
    {error ? <p role="status" className="text-rose-600">{error}</p> : null}
  </div>;
}

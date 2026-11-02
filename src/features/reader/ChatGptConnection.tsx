import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { openExternalUrl } from '../../services/desktop';
interface Account { connected: boolean; selectedModel?: string; planEnabled?: boolean; inferenceVerified?: boolean; connecting?: boolean; error?: string; selectedId?: string; accounts?: { id: string; label: string; signedIn: boolean }[]; }
export function ChatGptConnection() {
  const [account, setAccount] = useState<Account>({ connected: false });
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    try { const result = await invoke<Account>('chatgpt_status'); setAccount(result); if (result.error) setError(result.error); }
    catch (error) { setError(String(error)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!account.connecting) return; const timer = window.setInterval(() => void refresh(), 1500); return () => clearInterval(timer); }, [account.connecting, refresh]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); await refresh(); window.dispatchEvent(new Event('paperdesk:chatgpt-account-changed')); } catch (error) { setError(String(error)); } finally { setBusy(false); } }
  async function loadModels() { const result = await invoke<{ id: string; label: string }[]>('chatgpt_models'); setModels(result); setModel(account.selectedModel || result[0]?.id || ''); }
  return <div className="space-y-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-white/10">
    <div className="flex flex-wrap items-center gap-2"><strong>ChatGPT 套餐连接</strong><span>{account.connected ? account.inferenceVerified ? '授权及推理均已验证' : '已授权 · 推理待测试' : account.connecting ? '等待浏览器授权…' : '尚未连接'}</span></div>
    {!!account.accounts?.length && <label className="block">账户 / 工作区<select aria-label="ChatGPT 账户" className="pq-input mt-1 w-full p-2" value={account.selectedId || ''} disabled={busy} onChange={e => void run(async () => { await invoke('chatgpt_select_account', { accountId: e.target.value }); setModels([]); setModel(''); })}>{account.accounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.signedIn ? '' : '（已退出）'}</option>)}</select></label>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="pq-button p-2" disabled={busy || account.connecting} onClick={() => void run(async () => { await invoke('chatgpt_connect'); })}>Continue with ChatGPT</button>
      <button type="button" className="pq-button p-2" disabled={busy || account.connecting} onClick={() => void run(async () => { await invoke('chatgpt_connect', { newAccount: true }); })}>添加账户</button>
      <button type="button" className="pq-button p-2" onClick={() => void refresh()}>刷新状态</button>
      {account.connected && <button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { const result = await invoke<{remoteRevocationConfirmed: boolean}>('chatgpt_disconnect'); setModels([]); setMessage(result.remoteRevocationConfirmed ? '已退出并撤销会话。' : '已在本机退出；远程撤销尚未确认，可在 ChatGPT 设置断开应用。'); })}>退出</button>}
    </div>
    {account.connected && <div className="space-y-2"><button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(loadModels)}>读取账户可用模型</button>
      {models.length > 0 && <select aria-label="ChatGPT 模型" className="pq-input w-full p-2" value={model} onChange={e => { setModel(e.target.value); void run(async () => { await invoke('chatgpt_set_model', { model: e.target.value }); }); }}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
      <button type="button" className="pq-button p-2" disabled={busy} onClick={() => void run(async () => { await invoke('chatgpt_test'); setMessage('官方接口完整响应成功。测试会使用少量套餐额度。'); })}>{busy ? '处理中…' : '测试实际推理'}</button></div>}
    <p className="leading-6 text-slate-500">使用官方开源本地应用授权和 ChatGPT 套餐额度，无需 Codex 或 API 密钥。浏览器已登录不等于已授权；账户资格、地区、手机号验证及额度由 OpenAI 决定。只有点击生成、提问或测试才请求模型。</p>
    <button type="button" className="underline" onClick={() => void openExternalUrl('https://chatgpt.com/settings/usage').catch(e => setError(String(e)))}>打开 ChatGPT 用量与应用权限</button>
    {message && <p role="status" className="text-emerald-700">{message}</p>}{error && <p role="alert" className="break-words text-rose-600">{error}</p>}
  </div>;
}

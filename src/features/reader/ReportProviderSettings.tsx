import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { openExternalUrl } from '../../services/desktop';
import { ChatGptConnection } from './ChatGptConnection';

export interface ReportProviderStatus { provider: 'chatgpt' | 'openrouter-free'; configured: boolean; openRouterConfigured: boolean; model: string; quota?: { remaining: number; limit: number } | null; }
export function ReportProviderSettings({ onChange }: { onChange: (status: ReportProviderStatus) => void }) {
  const [status, setStatus] = useState<ReportProviderStatus>({ provider: 'chatgpt', configured: false, openRouterConfigured: false, model: 'openrouter/free' });
  const [key, setKey] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const refresh = useCallback(async () => {
    try { const next = await invoke<ReportProviderStatus>('report_provider_status'); setStatus(next); onChange(next); }
    catch (error) { setMessage(String(error)); }
  }, [onChange]);
  useEffect(() => {
    void refresh(); window.addEventListener('paperdesk:report-provider-changed', refresh);
    window.addEventListener('paperdesk:chatgpt-account-changed', refresh);
    return () => { window.removeEventListener('paperdesk:report-provider-changed', refresh); window.removeEventListener('paperdesk:chatgpt-account-changed', refresh); };
  }, [refresh]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); await refresh(); window.dispatchEvent(new Event('paperdesk:report-provider-changed')); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" open={!status.configured}>
    <summary className="cursor-pointer font-medium">报告渠道：{status.provider === 'chatgpt' ? 'ChatGPT 套餐' : 'OpenRouter 免费模型'} · {status.configured ? '已配置' : '设置（手工编辑无需配置）'}</summary>
    <label className="my-3 flex items-center justify-between gap-2">生成渠道
      <select aria-label="报告生成渠道" className="pq-input max-w-56 p-2" value={status.provider} disabled={busy} onChange={event => void run(async () => { await invoke('report_provider_configure', { provider: event.target.value }); })}>
        <option value="chatgpt">ChatGPT 套餐（Plus / Pro 授权）</option>
        <option value="openrouter-free">免费模型（OpenRouter）</option>
      </select>
    </label>
    {status.provider === 'chatgpt' ? <ChatGptConnection /> : <div className="space-y-2">
      <p className="leading-5">使用自己的 OpenRouter 密钥，只允许零价格模型。零充值账户目前每天合计50次请求，长文可能需要多次；可用性取决于服务方。不是 ChatGPT 网页账户。</p>
      <input type="password" autoComplete="off" aria-label="OpenRouter 免费报告密钥" className="pq-input w-full p-2" value={key} onChange={event => setKey(event.target.value)} placeholder={status.openRouterConfigured ? '已通过系统安全存储保存；填写可替换' : 'sk-or-…'} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="pq-button px-2 py-1" disabled={!key.trim() || busy} onClick={() => void run(async () => { await invoke('report_provider_configure', { provider: 'openrouter-free', key }); setKey(''); setMessage('密钥已保存在本机，没有充值。'); })}>保存密钥</button>
        <button type="button" className="pq-button px-2 py-1" disabled={!status.openRouterConfigured || busy} onClick={() => void run(async () => { const result = await invoke<{ text: string }>('report_provider_test'); setMessage(`已完成一次免费请求：${result.text}`); })}>测试连接（使用1次请求）</button>
        <button type="button" className="pq-button px-2 py-1" disabled={busy} onClick={() => void run(async () => { setModels(await invoke('report_provider_models')); })}>刷新免费模型</button>
      </div>
      {models.length ? <select aria-label="免费报告模型" className="pq-input w-full p-2" disabled={busy} value={status.model} onChange={event => void run(async () => { await invoke('report_provider_configure', { provider: 'openrouter-free', model: event.target.value }); })}>
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select> : <p className="text-slate-500">默认使用免费路由，可在刷新后固定选择当前可用的免费模型。</p>}
      {status.quota ? <p>服务端报告的今日剩余请求：{status.quota.remaining} / {status.quota.limit}</p> : null}
      <details><summary className="cursor-pointer">密钥申请步骤</summary><ol className="mt-2 list-decimal space-y-1 pl-5 leading-5">
        <li>在 OpenRouter 注册自己的账户。</li><li>打开 API Keys，创建名为 PaperDesk 的密钥。</li><li>不充值，不启用自动充值，把密钥填入上方并保存。</li><li>测试连接后即可生成报告；额度耗尽时停止。</li>
      </ol><button type="button" className="pq-button mt-2 px-2 py-1" onClick={() => void openExternalUrl('https://openrouter.ai/keys')}>打开官方密钥管理</button></details>
    </div>}
    <p className="mt-2 leading-5 text-slate-500">生成时会发送当前文献及关联材料的可提取文字。保存后阅读、修改不再请求模型；图像、公式和证据需核对。</p>
    {message ? <p role="status" className="mt-2 break-words leading-5">{message}</p> : null}
  </details>;
}

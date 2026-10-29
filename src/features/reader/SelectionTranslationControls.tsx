import { useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { useReaderPreferences } from './ReaderPreferencesContext';
import { ChatGptConnection } from './ChatGptConnection';
import type { ReaderSettings } from '../../types/reader';
export function SelectionTranslationControls() {
  const preferences = useReaderPreferences(); const [key, setKey] = useState(''); const [status, setStatus] = useState(''); const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (preferences?.settings.selectionTranslationConsent) setExpanded(false); }, [preferences?.settings.selectionTranslationConsent]);
  useEffect(() => { if (preferences?.settings.selectionTranslationProvider === 'deepl-free') void invoke<{ deeplConfigured: boolean }>('selection_translation_status').then(r => setStatus(r.deeplConfigured ? '已配置 DeepL API Free 密钥' : '尚未配置 DeepL API Free 密钥')).catch(e => setStatus(String(e))); }, [preferences?.settings.selectionTranslationProvider]);
  if (!preferences) return null;
  const { settings, updateSetting } = preferences;
  return <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" open={!settings.selectionTranslationConsent || expanded} onToggle={event => { if (settings.selectionTranslationConsent) setExpanded(event.currentTarget.open); }}>
    <summary className="cursor-pointer font-medium">翻译：{{ chatgpt: 'ChatGPT 账户', 'deepl-free': 'DeepL API Free', mymemory: 'MyMemory', local: '本地模型' }[settings.selectionTranslationProvider]} · {settings.selectionTranslationConsent && settings.autoTranslateSelection ? '划选后自动显示' : '设置 / 开启'}</summary>
    <div className="mt-3 space-y-3">
    <label className="flex items-center justify-between gap-2">翻译渠道<select aria-label="划词翻译渠道" className="pq-input max-w-44 p-1" value={settings.selectionTranslationProvider} onChange={event => updateSetting('selectionTranslationProvider', event.target.value as ReaderSettings['selectionTranslationProvider'])}>
      <option value="chatgpt">ChatGPT 账户（Codex）</option><option value="deepl-free">DeepL API Free</option><option value="mymemory">MyMemory（低配额备用）</option><option value="local">可选本地模型</option>
    </select></label>
    {settings.selectionTranslationProvider === 'chatgpt' ? <ChatGptConnection /> : settings.selectionTranslationProvider === 'deepl-free' ? <div className="space-y-2"><p>使用官方 API Free 免费端点，有月度额度；需自己的免费密钥。不会转用付费 Pro。</p><input type="password" autoComplete="off" aria-label="DeepL API Free 密钥" placeholder="DeepL API Free 密钥（:fx）" value={key} onChange={e => setKey(e.target.value)} className="pq-input w-full p-2" /><button type="button" className="pq-button px-2 py-1" disabled={!key} onClick={() => void invoke('selection_translation_set_deepl_key', { key }).then(() => { setKey(''); setStatus('已通过系统安全存储保存密钥'); }).catch(error => setStatus(String(error)))}>保存免费密钥</button><p role="status">{status}</p></div> : settings.selectionTranslationProvider === 'mymemory' ? <p>备用渠道单次最多 500 UTF-8 字节，有每日配额。可改选 ChatGPT 或 DeepL API Free。</p> : <p>使用已配置的本地模型；没有云服务费用，但速度取决于本机模型。</p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={settings.selectionTranslationConsent} onChange={e => { updateSetting('selectionTranslationConsent', e.target.checked); if (e.target.checked) updateSetting('autoTranslateSelection', true); }} /><span>开启划词自动翻译。仅将选中文字发送到所选渠道；首次开启后不再逐次确认。服务可能留存文本，有账户额度限制；缓存命中不重新请求。</span></label>
    {settings.selectionTranslationConsent ? <label className="flex gap-2"><input type="checkbox" checked={settings.autoTranslateSelection} onChange={e => updateSetting('autoTranslateSelection', e.target.checked)} />划选结束后自动在此栏显示译文</label> : null}
    </div>
  </details>;
}

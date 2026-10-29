import { useEffect, useState } from 'react';
import { invoke } from '../../platform/electron/core';
import { listen } from '../../platform/electron/event';
import { useReaderPreferences } from './ReaderPreferencesContext';
import { ChatGptConnection } from './ChatGptConnection';
import type { ReaderSettings } from '../../types/reader';

interface OfflineStatus {
  installed: boolean;
  runtimeAvailable: boolean;
  ready: boolean;
  packageBytes: number | null;
  error: string;
}
interface InstallProgress { received: number; total: number; stage: 'download' | 'install' | 'ready'; }

export function SelectionTranslationControls() {
  const preferences = useReaderPreferences();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const provider = preferences?.settings.selectionTranslationProvider;

  useEffect(() => {
    let active = true;
    setStatus('');
    if (provider === 'offline') {
      void invoke<OfflineStatus>('offline_translation_status').then(result => { if (active) setOffline(result); }).catch(error => { if (active) setStatus(String(error)); });
    } else if (provider === 'deepl-free') {
      void invoke<{ deeplConfigured: boolean }>('selection_translation_status').then(result => { if (active) setStatus(result.deeplConfigured ? '已配置 DeepL API Free 密钥' : '尚未配置 DeepL API Free 密钥'); }).catch(error => { if (active) setStatus(String(error)); });
    }
    return () => { active = false; };
  }, [provider]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<InstallProgress>('paperdesk:offline-translation-install-progress', ({ payload }) => setProgress(payload)).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    if (preferences?.settings.selectionTranslationConsent || offline?.ready) setExpanded(false);
  }, [preferences?.settings.selectionTranslationConsent, offline?.ready]);

  if (!preferences) return null;
  const { settings, updateSetting } = preferences;
  const isOffline = provider === 'offline';
  const configured = isOffline ? offline?.ready === true : settings.selectionTranslationConsent;
  const names = { offline: '离线专用翻译 · 英→中', chatgpt: 'ChatGPT 账户', 'deepl-free': 'DeepL API Free', mymemory: 'MyMemory', local: '本地模型' };

  async function install() {
    setInstalling(true); setStatus('正在下载并校验英中语言包…'); setProgress(null);
    try {
      const result = await invoke<OfflineStatus>('offline_translation_install');
      setOffline(result);
      if (!result.ready) throw new Error(result.error || '语言包已保存，但离线组件未就绪，请检查完整更新包。');
      updateSetting('autoTranslateSelection', true);
      setStatus('语言包已保存在本机，后续翻译无需联网、登录或配额。');
      setExpanded(false);
      window.setTimeout(() => window.dispatchEvent(new Event('paperdesk:offline-translation-ready')), 50);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setInstalling(false); }
  }

  return <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" open={!configured || expanded} onToggle={event => { if (configured) setExpanded(event.currentTarget.open); }}>
    <summary className="cursor-pointer font-medium">翻译：{names[settings.selectionTranslationProvider]} · {configured && settings.autoTranslateSelection ? '划选后自动显示' : '设置 / 开启'}</summary>
    <div className="mt-3 space-y-3">
      <label className="flex items-center justify-between gap-2">翻译渠道
        <select aria-label="划词翻译渠道" className="pq-input max-w-44 p-1" value={settings.selectionTranslationProvider} onChange={event => updateSetting('selectionTranslationProvider', event.target.value as ReaderSettings['selectionTranslationProvider'])}>
          <option value="offline">离线专用翻译（推荐）</option>
          <option value="chatgpt">ChatGPT 账户（需 Codex 授权）</option>
          <option value="deepl-free">DeepL API Free</option>
          <option value="mymemory">MyMemory（低配额备用）</option>
          <option value="local">可选 Ollama 本地模型</option>
        </select>
      </label>
      {isOffline ? <div className="space-y-2">
        <p>英语 → 中文，使用专用机器翻译引擎。下载一次语言包后在本机运行，无需 ChatGPT、Codex、Ollama 或在线配额；选中文字不会发送到云端。科研术语、公式仍需对照原文。</p>
        {offline?.ready ? <p className="text-emerald-700">英中语言包已就绪 · 以后更新程序可继续复用</p> : <>
          <button type="button" className="pq-button px-3 py-2" disabled={installing || offline?.runtimeAvailable === false} onClick={() => void install()}>
            {installing ? '正在安装…' : `下载并启用英中翻译${offline?.packageBytes ? `（${Math.ceil(offline.packageBytes / 1048576)} MB，仅一次）` : '（仅一次）'}`}
          </button>
          {offline?.runtimeAvailable === false ? <p className="text-rose-600">离线运行组件缺失，请使用完整 Windows 更新包。</p> : null}
          {offline?.error ? <p className="text-rose-600">{offline.error}</p> : null}
        </>}
        {installing && progress ? <div role="status">{progress.stage === 'download' ? `正在下载：${Math.floor(progress.received / 1048576)} / ${Math.ceil(progress.total / 1048576)} MB` : progress.stage === 'install' ? '校验通过，正在安装语言包…' : '语言包已安装'}</div> : null}
      </div> : settings.selectionTranslationProvider === 'chatgpt' ? <ChatGptConnection /> : settings.selectionTranslationProvider === 'deepl-free' ? <div className="space-y-2">
        <p>使用官方 API Free 免费端点，有月度额度；需自己的免费密钥。不会转用付费 Pro。</p>
        <input type="password" autoComplete="off" aria-label="DeepL API Free 密钥" placeholder="DeepL API Free 密钥（:fx）" value={key} onChange={event => setKey(event.target.value)} className="pq-input w-full p-2" />
        <button type="button" className="pq-button px-2 py-1" disabled={!key} onClick={() => void invoke('selection_translation_set_deepl_key', { key }).then(() => { setKey(''); setStatus('已通过系统安全存储保存密钥'); }).catch(error => setStatus(String(error)))}>保存免费密钥</button>
      </div> : settings.selectionTranslationProvider === 'mymemory' ? <p>备用渠道单次最多 500 UTF-8 字节，有每日配额。</p> : <p>使用已配置的本地大模型，速度取决于本机模型；默认离线专用翻译不需要它。</p>}
      {!isOffline ? <label className="flex items-start gap-2"><input type="checkbox" checked={settings.selectionTranslationConsent} onChange={event => { updateSetting('selectionTranslationConsent', event.target.checked); if (event.target.checked) updateSetting('autoTranslateSelection', true); }} /><span>开启所选渠道的划词翻译。在线渠道仅发送选中文字；开启后不再逐次确认。服务可能留存文本，并有账户额度限制。</span></label> : null}
      {isOffline || settings.selectionTranslationConsent ? <label className="flex gap-2"><input type="checkbox" checked={settings.autoTranslateSelection} onChange={event => updateSetting('autoTranslateSelection', event.target.checked)} />划选结束后自动在此栏显示译文</label> : null}
      {status ? <p role="status" className="break-words leading-5">{status}</p> : null}
    </div>
  </details>;
}

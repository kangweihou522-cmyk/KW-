import { TranslationGlossary } from './TranslationGlossary';
import { BaiduTranslationControls } from './BaiduTranslationControls';
import { useEffect, useRef, useState } from 'react';
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
  installing?: boolean;
  partialBytes?: number;
  expectedBytes?: number;
  bytes?: number;
  modelDir?: string;
  recoverable?: boolean;
  errorCode?: string;
  progress?: InstallProgress | null;
}
interface InstallProgress { received: number; total: number; stage: 'connect' | 'download' | 'install' | 'verify' | 'retry' | 'start' | 'error' | 'ready'; message?: string; }

export function SelectionTranslationControls() {
  const preferences = useReaderPreferences();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const provider = preferences?.settings.selectionTranslationProvider;
  const providerRef = useRef(provider); providerRef.current = provider;

  useEffect(() => {
    let active = true;
    setStatus(''); setProgress(null); setOffline(null); setInstalling(false);
    if (provider === 'offline' || provider === 'offline-quality') {
      void invoke<OfflineStatus>(provider === 'offline-quality' ? 'quality_translation_status' : 'offline_translation_status').then(result => { if (active) { setOffline(result); setInstalling(result.installing === true); if (result.progress) setProgress(result.progress); if (provider === 'offline-quality' && !result.ready) preferences?.updateSetting('autoTranslateSelection', false); } }).catch(error => { if (active) setStatus(String(error)); });
    } else if (provider === 'deepl-free') {
      void invoke<{ deeplConfigured: boolean }>('selection_translation_status').then(result => { if (active) setStatus(result.deeplConfigured ? '已配置 DeepL API Free 密钥' : '尚未配置 DeepL API Free 密钥'); }).catch(error => { if (active) setStatus(String(error)); });
    }
    return () => { active = false; };
  }, [provider]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<InstallProgress>(provider === 'offline-quality' ? 'paperdesk:quality-translation-install-progress' : 'paperdesk:offline-translation-install-progress', ({ payload }) => setProgress(payload)).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [provider]);
  useEffect(() => {
    if (!installing || !['offline', 'offline-quality'].includes(provider || '')) return;
    let active = true;
    const timer = window.setInterval(() => {
      void invoke<OfflineStatus>(provider === 'offline-quality' ? 'quality_translation_status' : 'offline_translation_status').then(value => {
        if (!active) return;
        setOffline(value); if (value.progress) setProgress(value.progress);
        if (value.installing === false) setInstalling(false);
      }).catch(() => {});
    }, 1200);
    return () => { active = false; window.clearInterval(timer); };
  }, [provider, installing]);
  useEffect(() => {
    if (preferences?.settings.selectionTranslationConsent || offline?.ready) setExpanded(false);
  }, [preferences?.settings.selectionTranslationConsent, offline?.ready]);

  if (!preferences) return null;
  const { settings, updateSetting } = preferences;
  const isOffline = provider === 'offline' || provider === 'offline-quality';
  const configured = isOffline ? offline?.ready === true : settings.selectionTranslationConsent;
  const names = { offline: '快速离线翻译 · 英→中', 'offline-quality': '高质量离线翻译 · Hy-MT2', baidu: '百度通用翻译', chatgpt: 'ChatGPT 账户', 'deepl-free': 'DeepL API Free', mymemory: 'MyMemory', local: '本地模型' };

  async function install(repair = false) {
    const selectedProvider = provider;
    setInstalling(true); setStatus(provider === 'offline-quality' ? '正在检查已有模型和下载连接…' : '正在下载并校验英中语言包…'); setProgress(null);
    try {
      const result = await invoke<OfflineStatus>(provider === 'offline-quality' ? 'quality_translation_install' : 'offline_translation_install', { force: repair });
      if (providerRef.current !== selectedProvider) return;
      setOffline(result);
      if (!result.ready) throw new Error(result.error || '语言包已保存，但离线组件未就绪，请通过桌面 PaperDesk - Update 修复运行组件。');
      updateSetting('autoTranslateSelection', true);
      setStatus('语言包已保存在本机，后续翻译无需联网、登录或配额。');
      setExpanded(false);
      window.setTimeout(() => window.dispatchEvent(new Event('paperdesk:offline-translation-ready')), 50);
    } catch (error) { if (providerRef.current === selectedProvider) setStatus(error instanceof Error ? error.message : String(error)); }
    finally { if (providerRef.current === selectedProvider) { setInstalling(false); void invoke<OfflineStatus>(selectedProvider === 'offline-quality' ? 'quality_translation_status' : 'offline_translation_status').then(setOffline).catch(() => {}); } }
  }

  return <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" open={!configured || expanded} onToggle={event => { if (configured) setExpanded(event.currentTarget.open); }}>
    <summary className="cursor-pointer font-medium">翻译：{names[settings.selectionTranslationProvider]} · {configured && settings.autoTranslateSelection ? '划选后自动显示' : '设置 / 开启'}</summary>
    <div className="mt-3 space-y-3">
      <label className="flex items-center justify-between gap-2">翻译渠道
        <select aria-label="划词翻译渠道" className="pq-input max-w-44 p-1" disabled={installing} value={settings.selectionTranslationProvider} onChange={event => { const next = event.target.value as ReaderSettings['selectionTranslationProvider']; const wasAuto = settings.autoTranslateSelection; if (next === 'offline-quality') updateSetting('autoTranslateSelection', false); updateSetting('selectionTranslationProvider', next); if (next === 'offline-quality' && wasAuto) void invoke<OfflineStatus>('quality_translation_status').then(value => { if (providerRef.current === next && value.ready) updateSetting('autoTranslateSelection', true); }).catch(() => {}); }}>
          <option value="offline">快速离线翻译 · 英→中</option>
          <option value="offline-quality">高质量离线翻译 · Hy-MT2（预览）</option>
          <option value="baidu">百度通用翻译（可选）</option>
          <option value="chatgpt">ChatGPT 套餐（官方授权）</option>
          <option value="deepl-free">DeepL API Free</option>
          <option value="mymemory">MyMemory（低配额备用）</option>
          <option value="local">可选 Ollama 本地模型</option>
        </select>
      </label>
      {isOffline ? <div className="space-y-2">
        <p>{provider === 'offline-quality' ? 'Hy-MT2-1.8B Q4_K_M 专用翻译模型，优先使用显卡，兼容时回退CPU。首次下载约1.13GB；支持断点续传，已有完整模型会直接复用。首次加载需要时间。科研准确性需对照原文。' : '英语 → 中文，使用轻量专用机器翻译引擎。'}下载一次语言包后在本机运行，无需 ChatGPT、Codex、Ollama 或在线配额；选中文字不会发送到云端。科研术语、公式仍需对照原文。</p>
        {offline?.ready ? <div className="space-y-2"><p className="text-emerald-700">离线语言包已就绪 · 更新程序可继续复用</p>{provider === 'offline-quality' && <button type="button" className="pq-button px-2 py-1" disabled={installing} onClick={() => void install(true)}>检查并修复高质量翻译</button>}</div> : <>
          <button type="button" className="pq-button px-3 py-2" disabled={installing || offline?.runtimeAvailable === false} onClick={() => void install()}>
            {installing ? '正在检查 / 下载 / 启用…' : provider === 'offline-quality' ? offline?.installed ? '检查并重试启动（复用已有模型）' : offline?.recoverable || offline?.partialBytes ? '检查并继续（保留已有进度）' : '下载并启用 Hy-MT2 Q4（约1.13GB，首次）' : `下载并启用英中翻译${offline?.packageBytes ? `（${Math.ceil(offline.packageBytes / 1048576)} MB，仅一次）` : '（仅一次）'}`}
          </button>
          {offline?.runtimeAvailable === false ? <p className="text-rose-600">离线运行组件缺失，请点击桌面 PaperDesk - Update 更新。</p> : null}
          {offline?.error ? <p className="text-rose-600">{offline.error}</p> : null}
        </>}
        {installing && <div role="status" className="space-y-1">{progress?.stage === 'download' ? <><progress aria-label="模型下载进度" className="h-2 w-full accent-teal-600" max={Math.max(1, progress.total)} value={progress.received} /><p>正在下载：{Math.floor(progress.received / 1048576)} / {Math.ceil(progress.total / 1048576)} MB</p></> : <p>{progress?.message || (provider === 'offline-quality' ? '正在连接或检查已有模型，请稍候…' : '正在准备语言包…')}</p>}</div>}
        {provider === 'offline-quality' && installing && ['connect', 'download', 'retry'].includes(progress?.stage || '') && <button type="button" className="pq-button px-2 py-1" onClick={() => void invoke('quality_translation_pause').catch(error => setStatus(String(error)))}>暂停下载（保留进度）</button>}
        {provider === 'offline-quality' && offline && <details className="text-[11px] leading-6"><summary className="cursor-pointer">下载与检查详情</summary><p className="break-all select-text">模型目录：{offline.modelDir}</p><p>已保存模型：{Math.floor((offline.bytes || 0) / 1048576)} MB；未完成下载：{Math.floor((offline.partialBytes || 0) / 1048576)} MB</p><p>运行组件：{offline.runtimeAvailable ? '已找到' : '缺失'}{offline.errorCode ? `；检查结果：${offline.errorCode}` : ''}</p></details>}
      </div> : settings.selectionTranslationProvider === 'chatgpt' ? <ChatGptConnection /> : settings.selectionTranslationProvider === 'deepl-free' ? <div className="space-y-2">
        <p>使用官方 API Free 免费端点，有月度额度；需自己的免费密钥。不会转用付费 Pro。</p>
        <input type="password" autoComplete="off" aria-label="DeepL API Free 密钥" placeholder="DeepL API Free 密钥（:fx）" value={key} onChange={event => setKey(event.target.value)} className="pq-input w-full p-2" />
        <button type="button" className="pq-button px-2 py-1" disabled={!key} onClick={() => void invoke('selection_translation_set_deepl_key', { key }).then(() => { setKey(''); setStatus('已通过系统安全存储保存密钥'); }).catch(error => setStatus(String(error)))}>保存免费密钥</button>
      </div> : settings.selectionTranslationProvider === 'baidu' ? <BaiduTranslationControls /> : settings.selectionTranslationProvider === 'mymemory' ? <p>备用渠道单次最多 500 UTF-8 字节，有每日配额。</p> : <p>使用已配置的本地大模型，速度取决于本机模型；默认离线专用翻译不需要它。</p>}
      {!isOffline ? <label className="flex items-start gap-2"><input type="checkbox" checked={settings.selectionTranslationConsent} onChange={event => { updateSetting('selectionTranslationConsent', event.target.checked); if (event.target.checked) updateSetting('autoTranslateSelection', true); }} /><span>开启所选渠道的划词翻译。在线渠道仅发送选中文字；开启后不再逐次确认。服务可能留存文本，并有账户额度限制。</span></label> : null}
      {isOffline || settings.selectionTranslationConsent ? <label className="flex gap-2"><input type="checkbox" disabled={provider === 'offline-quality' && !offline?.ready} checked={settings.autoTranslateSelection} onChange={event => updateSetting('autoTranslateSelection', event.target.checked)} />划选结束后自动在此栏显示译文</label> : null}
      <TranslationGlossary />
      {status ? <p role="status" className="break-words leading-5">{status}</p> : null}
    </div>
  </details>;
}

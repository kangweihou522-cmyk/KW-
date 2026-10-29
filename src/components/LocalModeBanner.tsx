import { useState } from 'react';
import { HardDrive, Loader2, Settings2 } from 'lucide-react';
import { emitOpenPreferences } from '../app/appEvents';
import { listOpenAICompatibleModels } from '../services/llm';
import { useLocaleText } from '../i18n/uiLanguage';

export default function LocalModeBanner() {
  const l = useLocaleText();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');

  const checkLocalModel = async () => {
    setChecking(true);
    setStatus('');
    try {
      const result = await listOpenAICompatibleModels({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' });
      const models = result.models.map((model) => model.id);
      setStatus(models.length
        ? l(`本机模型：${models.join('、')}`, `Local models: ${models.join(', ')}`)
        : l('Ollama 已启动，但没有模型。请在终端运行 ollama pull qwen3:4b。', 'Ollama is running without models. Run ollama pull qwen3:4b.'));
    } catch {
      setStatus(l('未连接到本机 Ollama。请启动 Ollama；阅读、批注和笔记仍可使用。', 'Local Ollama is unavailable. Start Ollama; reading, annotations, and notes remain available.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-emerald-200/70 bg-emerald-50/80 px-4 py-1.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium"><HardDrive className="h-3.5 w-3.5" />{l('本地文库 · 报告缓存', 'Local library · Cached reports')}</span>
        <span className="hidden text-emerald-800/80 dark:text-emerald-300 sm:inline">{l('离线英中翻译 · 报告本地保存 · 账户连接可选', 'Offline English–Chinese translation · Local reports · Optional account connection')}</span>
        <button type="button" onClick={() => void checkLocalModel()} disabled={checking} className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 disabled:opacity-50">
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{l('检测可选本地模型', 'Check optional local AI')}
        </button>
        <button type="button" onClick={() => emitOpenPreferences('models')} className="inline-flex items-center gap-1"><Settings2 className="h-3.5 w-3.5" />{l('模型设置', 'Model settings')}</button>
      </div>
      {status ? <p role="status" className="mt-1 break-words leading-5">{status}</p> : null}
    </div>
  );
}

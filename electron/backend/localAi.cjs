// PaperDesk: local AI only. Never substitute a metered service or follow redirects.
const DEFAULT_LOCAL_AI = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3:4b',
  apiKey: '',
  apiMode: 'chat_completions',
});

function assertLocalAiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('本地模型地址无效，请使用 http://127.0.0.1:11434/v1。'); }
  if (!['http:', 'https:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.search || url.hash) {
    throw new Error('PaperDesk 仅连接本机模型，已拒绝外部 AI 地址；不会调用付费 API。请使用 Ollama 或 LM Studio 的本机地址。');
  }
  return url;
}

function localAiOptions(options = {}) {
  const result = {
    ...DEFAULT_LOCAL_AI,
    ...options,
    baseUrl: typeof options.baseUrl === 'string' && options.baseUrl.trim() ? options.baseUrl.trim() : DEFAULT_LOCAL_AI.baseUrl,
    model: typeof options.model === 'string' && options.model.trim() ? options.model.trim() : DEFAULT_LOCAL_AI.model,
  };
  assertLocalAiUrl(result.baseUrl);
  // Ollama exposes hosted models through the same localhost daemon. A loopback
  // address alone does not make a model with a cloud suffix run on this machine.
  if (/(?:[-:/]cloud)(?:$|[:/])/i.test(result.model)) {
    throw new Error('已拒绝 Ollama 云端模型。请选择已下载的本地模型，例如 qwen3:4b；不会购买额度或转用云端推理。');
  }
  return result;
}

async function localAiFetch(endpoint, init = {}) {
  assertLocalAiUrl(endpoint);
  try {
    return await fetch(endpoint, { ...init, redirect: 'error' });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    const cause = error?.cause?.message || error?.message || String(error);
    throw new Error(`无法连接本地模型（${cause}）。请启动 Ollama，安装 qwen3:4b，并检查本机端口；不会切换到云端付费接口。`, { cause: error });
  }
}

module.exports = { DEFAULT_LOCAL_AI, assertLocalAiUrl, localAiOptions, localAiFetch };

const { localAiOptions, localAiFetch } = require('./localAi.cjs');

function usesNativeOllama(options) {
  const url = new URL(options.baseUrl);
  return url.port === '11434' && options.apiMode !== 'responses';
}

async function requestOllamaReport(input, messages, timeoutMs = 300000) {
  const options = localAiOptions(input);
  const url = new URL('/api/chat', options.baseUrl);
  try {
    const response = await localAiFetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ model: options.model, messages, stream: false,
        think: false, format: 'json', keep_alive: '10m',
        options: { num_ctx: 8192, num_predict: 2048, repeat_penalty: 1.1, repeat_last_n: 128, temperature: options.temperature ?? 0.2 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (/token repeat limit|prediction aborted/i.test(detail)) throw new Error(`本地模型重复生成，被 Ollama 终止。未保存失败报告；请重试，若仍出现请保留此错误并检查 Ollama 版本。原始信息：${detail}`);
      throw new Error(`Ollama HTTP ${response.status}: ${detail}`);
    }
    const result = await response.json();
    if (result.error) throw new Error(String(result.error));
    if (result.done_reason === 'length') throw new Error('本地模型达到输出长度上限，未保存不完整报告。请重试或改用更适合结构化输出的本地模型。');
    if (result.done !== true || !result.message?.content?.trim()) throw new Error('Ollama 未返回完整报告正文。请核对模型名称与服务版本后重试。');
    return result.message.content;
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('本段报告请求超过 5 分钟，已停止等待。已完成的分段会保留缓存；请检查 Ollama 运行状态后重试。');
    }
    throw error;
  }
}

module.exports = { usesNativeOllama, requestOllamaReport };

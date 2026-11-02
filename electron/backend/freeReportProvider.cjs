const { ProtectedSettings } = require('./protectedSettings.cjs');
const { jsonRequest } = require('./remoteHttp.cjs');
const ENDPOINT = 'https://openrouter.ai/api/v1';
function isFreeModel(model) {
  if (!model?.id?.endsWith(':free')) return false;
  return !!model.pricing && model.pricing.prompt !== undefined && model.pricing.completion !== undefined && Object.values(model.pricing).every(value => value === null || value === undefined || Number(value) === 0);
}
class FreeReportProvider {
  constructor(context) { this.vault = new ProtectedSettings(context, 'free-report.enc'); this.json = context.freeReportJson || jsonRequest; }
  async status() { const value = await this.vault.read(); return { configured: !!value.key, model: value.model || 'openrouter/free', fallbackEnabled: value.fallbackEnabled === true }; }
  async configure({ key, model, fallbackEnabled } = {}) {
    await this.vault.update(value => {
      if (key !== undefined) { if (typeof key !== 'string' || key.length > 1000) throw new Error('密钥格式无效。'); value.key = key.trim(); }
      if (model !== undefined) { if (model !== 'openrouter/free' && !model.endsWith(':free')) throw new Error('只允许免费模型。'); value.model = model; }
      if (fallbackEnabled !== undefined) value.fallbackEnabled = fallbackEnabled === true;
    }); return this.status();
  }
  async models() { const result = await this.json(`${ENDPOINT}/models`); return [{ id: 'openrouter/free', label: '免费模型自动选择' }, ...(result.data || []).filter(isFreeModel).map(model => ({ id: model.id, label: model.name || model.id }))]; }
  async complete(prompt) {
    const value = await this.vault.read(); const model = value.model || 'openrouter/free';
    if (!value.key) throw new Error('请先在报告设置中保存 OpenRouter 密钥。');
    if (!(await this.models()).some(m => m.id === model)) throw new Error('所选免费模型已不可用，请重新选择。未回退到付费模型。');
    const result = await this.json(`${ENDPOINT}/chat/completions`, { method: 'POST', timeout: 240000, maxBytes: 12 * 1024 * 1024,
      headers: { Authorization: `Bearer ${value.key}`, 'Content-Type': 'application/json', 'X-Title': 'PaperDesk' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0 } }, stream: false }) });
    if (result.error || result.choices?.[0]?.finish_reason !== 'stop' || !result.choices[0].message?.content?.trim()) throw new Error('免费模型未返回完整报告，可能达到额度或上下文限制。未保存不完整报告，未切换付费模型。');
    return result.choices[0].message.content;
  }
}
module.exports = { FreeReportProvider, isFreeModel };

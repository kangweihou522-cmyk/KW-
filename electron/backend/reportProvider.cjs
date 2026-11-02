const fs = require('node:fs/promises');
const path = require('node:path');
const { SecureSettings, atomicJson } = require('./secureSettings.cjs');
const { serviceRequest } = require('./serviceHttp.cjs');

const ROOT = 'https://openrouter.ai/api/v1';
function isFreeModel(model) {
  if (!model || !(model.id === 'openrouter/free' || model.id?.endsWith(':free'))) return false;
  if (!model.pricing || !Object.keys(model.pricing).length) return false;
  if (model.pricing.prompt == null || model.pricing.completion == null) return false;
  return Object.values(model.pricing).every(value => value == null || value !== '' && Number(value) === 0);
}
class ReportProvider {
  constructor(context) {
    this.context = context; this.plan = context.chatGptBridge;
    this.request = context.reportRequest || serviceRequest;
    this.keyStore = new SecureSettings(context, 'openrouter-free');
    this.settingsFile = path.join(context.appPaths.dataDir, '.settings', 'report-provider.json');
    this.catalog = null; this.quota = null; this.lastModel = null;
  }
  async settings() {
    const saved = await fs.readFile(this.settingsFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
    const value = JSON.parse(saved);
    return { provider: value.provider === 'openrouter-free' ? 'openrouter-free' : 'chatgpt', model: typeof value.model === 'string' ? value.model : 'openrouter/free' };
  }
  async status() {
    const settings = await this.settings();
    return { ...settings, configured: settings.provider === 'chatgpt' ? (await this.plan.account()).connected : !!(await this.keyStore.read())?.key,
      openRouterConfigured: !!(await this.keyStore.read())?.key, quota: this.quota };
  }
  async configure({ provider, key, model } = {}) {
    if (!['chatgpt', 'openrouter-free'].includes(provider)) throw new Error('未知报告渠道。');
    if (key !== undefined) {
      if (key === '') await this.keyStore.remove();
      else {
        if (typeof key !== 'string' || !/^sk-or-[a-z0-9-]{12,450}$/i.test(key.trim())) throw new Error('请填写有效的 OpenRouter API 密钥。');
        await this.keyStore.write({ key: key.trim() });
      }
      this.catalog = null; this.quota = null;
    }
    const current = await this.settings();
    const selected = model || current.model;
    if (selected !== 'openrouter/free' && !/^[a-z0-9_.\/-]+:free$/i.test(selected)) throw new Error('报告仅支持明确的免费模型，不允许收费模型或自动收费路由。');
    if (provider === 'openrouter-free' && model && model !== 'openrouter/free') {
      if (!(await this.models()).some(item => item.id === selected)) throw new Error('所选模型没有当前已核实的零价格记录。');
    }
    await atomicJson(this.settingsFile, { provider, model: selected }); return this.status();
  }
  async call(route, options = {}, authenticated = true) {
    const key = authenticated ? (await this.keyStore.read())?.key : null;
    if (authenticated && !key) throw new Error('请先在报告设置中保存自己的 OpenRouter 密钥；不需要充值。');
    const result = await this.request(`${ROOT}${route}`, { ...options, allowedHosts: ['openrouter.ai'], headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...options.headers,
    } });
    if (result.status !== 200) throw new Error(result.status === 429 ? '免费报告渠道已限流或额度用尽，已停止请求；本地内容仍可编辑。'
      : result.status === 401 ? 'OpenRouter 密钥无效或已失效，请在本机设置中更新。'
        : `免费报告渠道不可用（HTTP ${result.status}），没有切换收费服务。`);
    return result.json;
  }
  async models() {
    const json = await this.call('/models', { timeout: 30000 }, false);
    const models = json?.data?.filter(isFreeModel).map(item => ({ id: item.id, name: item.name || item.id, context: item.context_length || 8192, output: item.top_provider?.max_completion_tokens || 4096 }));
    if (!models?.length) throw new Error('当前没有可核实为零价格的模型，请稍后重试；未使用收费模型。');
    this.catalog = models; return models;
  }
  async checkQuota() {
    const value = await this.call('/key', { timeout: 30000 });
    const quota = value?.data?.free_model_daily_requests;
    this.quota = quota && Number.isFinite(quota.remaining) ? { used: quota.used, limit: quota.limit, remaining: quota.remaining } : null;
    return this.quota;
  }
  async info() {
    const settings = await this.settings();
    if (settings.provider === 'chatgpt') {
      const models = this.plan.catalog || await this.plan.models();
      const account = await this.plan.account();
      const model = models.find(item => item.id === account.model) || models[0];
      return { provider: 'chatgpt', label: 'ChatGPT 套餐', model: model.id, context: model.context || 32000 };
    }
    const models = this.catalog || await this.models();
    const model = models.find(item => item.id === settings.model);
    if (!model) throw new Error('所选免费模型已不可用，请刷新免费模型列表后重新选择。');
    return { provider: 'openrouter-free', label: 'OpenRouter 免费模型', model: model.id, context: model.context, output: model.output };
  }
  async complete(prompt, options = {}) {
    const info = await this.info();
    if (info.provider === 'chatgpt') { const text = await this.plan.complete(prompt, options); this.lastModel = this.plan.lastModel; return text; }
    const quota = await this.checkQuota();
    if (quota && quota.remaining <= 0) throw new Error('今日免费模型请求已用完，请等待额度恢复；没有充值或使用收费模型。');
    const json = await this.call('/chat/completions', { method: 'POST', signal: options.signal,
      body: { model: info.model, messages: [{ role: 'user', content: prompt }], max_tokens: Math.min(info.output || 4096, 6000), stream: false,
        provider: { max_price: { prompt: 0, completion: 0 }, data_collection: 'deny' } } });
    const choice = json?.choices?.[0]; const text = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) {
      const error = new Error('免费模型未返回完整报告，已保留可恢复的草稿；没有把截断内容标记为完成。');
      error.partialText = typeof text === 'string' ? text : ''; throw error;
    }
    this.lastModel = json.model || info.model; options.onDelta?.(text); return text.trim();
  }
}
function createReportProviderCommands(context) {
  const provider = context.reportProvider;
  return {
    report_provider_status() { return provider.status(); },
    report_provider_configure(args) { return provider.configure(args); },
    report_provider_models() { return provider.models(); },
    async report_provider_test() {
      const text = await provider.complete('请只回复“连接成功”。本请求仅测试连接，不分析任何文献。');
      return { ok: true, text, ...await provider.info(), quota: provider.quota };
    },
  };
}
module.exports = { ReportProvider, createReportProviderCommands, isFreeModel };

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { SecureSettings, atomicJson } = require('./secureSettings.cjs');
const { serviceRequest } = require('./serviceHttp.cjs');
const { splitByBytes } = require('./reportAnalysis.cjs');

const DEFAULT_TERMS = [
  ['sample size', '样本量'], ['control group', '对照组'], ['confidence interval', '置信区间'],
  ['randomized controlled trial', '随机对照试验'], ['gut microbiota', '肠道微生物群'],
  ['ulcerative colitis', '溃疡性结肠炎'], ['intestinal barrier', '肠道屏障'], ['statistical significance', '统计学显著性'],
].map(([source, target]) => ({ source, target }));
function validateTerms(terms) {
  if (!Array.isArray(terms) || terms.length > 300 || terms.some(item => typeof item.source !== 'string' || !item.source.trim() || item.source.length > 120 || typeof item.target !== 'string' || !item.target.trim() || item.target.length > 120)) throw new Error('术语表最多300项，每项原文和译文各不超过120字。');
  const seen = new Set();
  return terms.map(item => ({ source: item.source.trim(), target: item.target.trim() })).filter(item => { const key = item.source.toLowerCase(); if (seen.has(key)) throw new Error('术语表包含重复原文，请合并后保存。'); seen.add(key); return true; });
}
class TranslationExtras {
  constructor(context) {
    this.context = context; this.request = context.baiduRequest || serviceRequest;
    this.credentials = new SecureSettings(context, 'baidu-free');
    this.termsFile = path.join(context.appPaths.dataDir, '.settings', 'scientific-terms.json');
    this.budgetFile = path.join(context.appPaths.dataDir, '.settings', 'baidu-free-budget.json');
    this.queue = Promise.resolve(); this.lastCall = 0;
  }
  async terms() {
    try { return validateTerms(JSON.parse(await fs.readFile(this.termsFile, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return DEFAULT_TERMS; throw error; }
  }
  async saveTerms({ terms }) { const value = validateTerms(terms); await atomicJson(this.termsFile, value); return { terms: value }; }
  async budget() { try { return JSON.parse(await fs.readFile(this.budgetFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
  async status() {
    const saved = await this.credentials.read(); const budget = await this.budget();
    const entry = saved ? budget[createHash('sha256').update(saved.appId).digest('hex')] : null;
    return { configured: !!saved?.key, remaining: Math.max(0, (entry?.ceiling || 0) - (entry?.used || 0)), terms: await this.terms() };
  }
  async configure({ appId, key, remainingFreeCharacters, freeOnlyConfirmed = false } = {}) {
    const task = this.queue.catch(() => {}).then(async () => {
      if (key === '') { await this.credentials.remove(); return this.status(); }
      if (typeof appId !== 'string' || !/^\d{8,30}$/.test(appId.trim()) || typeof key !== 'string' || !/^[a-z0-9_-]{8,200}$/i.test(key.trim())) throw new Error('请填写百度开放平台的 APP ID 和密钥。');
      if (freeOnlyConfirmed !== true || !Number.isSafeInteger(remainingFreeCharacters) || remainingFreeCharacters <= 0 || remainingFreeCharacters > 100000000) throw new Error('请先在百度确认可用免费额度并关闭超额付费，再填写本次免费字符预算。');
      const budget = await this.budget(); const id = createHash('sha256').update(appId.trim()).digest('hex'); const used = budget[id]?.used || 0;
      budget[id] = { used, ceiling: used + remainingFreeCharacters };
      await atomicJson(this.budgetFile, budget); await this.credentials.write({ appId: appId.trim(), key: key.trim(), freeOnlyConfirmed: true });
      return this.status();
    }); this.queue = task; return task;
  }
  async translate(text, { source, target, signal } = {}) {
    const task = this.queue.catch(() => {}).then(async () => {
      if (signal?.aborted) throw new Error('请求已取消。');
      const saved = await this.credentials.read();
      if (!saved?.freeOnlyConfirmed) throw new Error('百度渠道尚未完成免费额度确认与密钥配置。');
      const languages = { English: 'en', Chinese: 'zh', en: 'en', 'zh-CN': 'zh', auto: 'auto', Japanese: 'jp', German: 'de', French: 'fra', Spanish: 'spa', Korean: 'kor' };
      const from = languages[source]; const to = languages[target]; if (!from || !to || to === 'auto') throw new Error('百度渠道不支持所选语言。');
      const budget = await this.budget(); const id = createHash('sha256').update(saved.appId).digest('hex'); const entry = budget[id];
      // UTF-8 bytes deliberately overcount characters. No automatic monthly reset,
      // guessed allowance, or paid-account upgrade is ever performed.
      const cost = Buffer.byteLength(text);
      if (!entry || entry.used + cost > entry.ceiling) throw new Error('本机登记的百度免费预算不足，已停止发送；可切回离线翻译。');
      entry.used += cost; await atomicJson(this.budgetFile, budget);
      const result = [];
      for (const part of splitByBytes(text, 5500)) {
        const wait = Math.max(0, 1100 - (Date.now() - this.lastCall));
        if (wait) await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new Error('请求已取消。')); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, wait);
          signal?.addEventListener('abort', abort, { once: true });
        });
        if (signal?.aborted) throw new Error('请求已取消。');
        const salt = randomBytes(12).toString('hex');
        const sign = createHash('md5').update(saved.appId + part + salt + saved.key, 'utf8').digest('hex');
        const body = new URLSearchParams({ q: part, from, to, appid: saved.appId, salt, sign }); this.lastCall = Date.now();
        const response = await this.request('https://fanyi-api.baidu.com/api/trans/vip/translate', { method: 'POST', signal, timeout: 20000, allowedHosts: ['fanyi-api.baidu.com'], headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        if (response.status !== 200 || response.json?.error_code) throw new Error(`百度翻译未完成（${response.json?.error_code || `HTTP ${response.status}`}），没有切换其他收费渠道；请检查官网免费资格和额度。`);
        const translations = response.json?.trans_result;
        if (!Array.isArray(translations) || !translations.length || translations.some(item => typeof item.dst !== 'string')) throw new Error('百度未返回有效译文。');
        result.push(translations.map(item => item.dst).join('\n'));
      }
      return result.join('\n');
    }); this.queue = task; return task;
  }
}
function createTranslationExtraCommands(context) {
  const settings = context.translationExtras;
  return { translation_extras_status() { return settings.status(); }, translation_terms_save(args) { return settings.saveTerms(args); }, translation_baidu_configure(args) { return settings.configure(args); } };
}
module.exports = { TranslationExtras, createTranslationExtraCommands, validateTerms, DEFAULT_TERMS };

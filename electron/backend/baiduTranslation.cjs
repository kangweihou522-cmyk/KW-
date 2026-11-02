const { createHash, randomBytes } = require('node:crypto');
const { jsonRequest } = require('./remoteHttp.cjs');
const { ProtectedSettings } = require('./protectedSettings.cjs');
const LANG = { English: 'en', Chinese: 'zh', Japanese: 'jp', Korean: 'kor', German: 'de', French: 'fra', Spanish: 'spa', Russian: 'ru', Portuguese: 'pt', Italian: 'it', auto: 'auto', en: 'en', 'zh-CN': 'zh' };
class BaiduTranslation {
  constructor(context) { this.vault = new ProtectedSettings(context, 'baidu-translation.enc'); this.json = context.baiduJson || jsonRequest; }
  async configure({ appId, secret, freeQuotaConfirmed, monthlyLimit } = {}) {
    if (appId === '' && secret === '') { await this.vault.update(v => { delete v.appId; delete v.secret; v.enabled = false; }); return this.status(); }
    if (typeof appId !== 'string' || !/^\d{5,40}$/.test(appId) || typeof secret !== 'string' || !secret || secret.length > 500 || freeQuotaConfirmed !== true || !Number.isInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 10000000) throw new Error('请填写APP ID和密钥、设置账户免费额度内的月字符上限，并确认已关闭超额付费。');
    await this.vault.update(v => { Object.assign(v, { appId, secret, enabled: true, monthlyLimit }); }); return this.status();
  }
  async status() { const v = await this.vault.read(); return { configured: !!v.enabled && !!v.secret, monthlyLimit: v.monthlyLimit || 0, used: v.month === new Date().toISOString().slice(0, 7) ? v.used || 0 : 0 }; }
  async translate(text, source, target, signal) {
    if (!LANG[source] || !LANG[target] || Buffer.byteLength(text, 'utf8') > 6000) throw new Error('百度渠道请选择支持语言且单次不超过6000 UTF-8字节。');
    const v = await this.vault.update(value => {
      if (!value.enabled || !value.secret) throw new Error('百度翻译尚未配置。');
      const month = new Date().toISOString().slice(0, 7); if (value.month !== month) { value.month = month; value.used = 0; }
      const count = [...text].length; if ((value.used || 0) + count > value.monthlyLimit) throw new Error('已达到本机设置的百度免费月字符上限，未提交请求。');
      value.used = (value.used || 0) + count; return structuredClone(value);
    });
    const salt = randomBytes(16).toString('hex'); const sign = createHash('md5').update(v.appId + text + salt + v.secret).digest('hex');
    const result = await this.json('https://fanyi-api.baidu.com/api/trans/vip/translate', { method: 'POST', signal, timeout: 20000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ q: text, from: LANG[source], to: LANG[target], appid: v.appId, salt, sign }).toString() });
    if (result.error_code || !result.trans_result?.length) throw new Error(`百度翻译未成功（${String(result.error_code || 'empty')}）。未切换收费渠道；本次字符预留仍计入本机上限。`);
    return result.trans_result.map(r => r.dst).join('\n');
  }
}
module.exports = { BaiduTranslation };

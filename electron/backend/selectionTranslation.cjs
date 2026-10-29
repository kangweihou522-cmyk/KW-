const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function buildTranslationUrl(text, source = 'en', target = 'zh-CN') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先划选一句或一小段文字。');
  if (Buffer.byteLength(text, 'utf8') > 500) throw new Error('免费翻译单次最多 500 UTF-8 字节，请缩短划选内容（约一至三句英文）。');
  // MyMemory requires an explicit source language; never silently infer arbitrary languages.
  const aliases = { English: 'en', Chinese: 'zh-CN', Japanese: 'ja', German: 'de', French: 'fr', Spanish: 'es', Italian: 'it', Russian: 'ru', Korean: 'ko', Portuguese: 'pt' };
  source = aliases[source] || source; target = aliases[target] || target;
  const languages = new Set(['en', 'zh-CN', 'zh', 'ja', 'de', 'fr', 'es', 'it', 'ru', 'ko', 'pt']);
  if (!languages.has(source) || !languages.has(target)) throw new Error('此免费渠道暂不支持所选语言，请在设置中明确选择源语言和目标语言。');
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text.trim()); url.searchParams.set('langpair', `${source}|${target}`);
  return url;
}
function requestTranslation(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: new https.Agent({ proxyEnv: process.env }), timeout: 12000, headers: { 'User-Agent': 'PaperDesk/0.3.0' } }, (response) => {
      // No redirect following, credentials, configurable endpoint, or paid fallback.
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`免费翻译服务不可用（HTTP ${response.statusCode}），请稍后重试。`)); return; }
      let size = 0; const chunks = [];
      response.on('data', (chunk) => { size += chunk.length; if (size > 262144) request.destroy(new Error('翻译响应过大。')); else chunks.push(chunk); });
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('免费翻译服务返回了无效数据。')); } });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('免费翻译连接超时，请检查网络。')));
    request.on('error', reject);
  });
}
function parseTranslationResponse(data) {
  if (data?.quotaFinished || Number(data?.responseStatus) !== 200 || !data?.responseData?.translatedText?.trim()) {
    throw new Error('免费翻译额度已用尽或服务拒绝请求。不会转用付费接口，请稍后重试或手动翻译。');
  }
  // Keep result as plain text; renderer escapes it through MarkdownPreview.
  return data.responseData.translatedText.trim();
}
function createSelectionTranslationCommands({ appPaths, translate = requestTranslation }) {
  const pending = new Map();
  return {
    async translate_selection_free({ text, source = 'en', target = 'zh-CN', consent = false } = {}) {
      if (consent !== true) throw new Error('请先同意将所选文字发送给 MyMemory 免费翻译服务。');
      const url = buildTranslationUrl(text, source, target);
      const key = createHash('sha256').update(url.href).digest('hex');
      const file = path.join(appPaths.dataDir, '.selection-translations', `${key}.json`);
      try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (typeof cached.translation === 'string' && cached.translation) return { translation: cached.translation, cached: true, provider: 'MyMemory' }; }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (!pending.has(key)) pending.set(key, (async () => {
        const translation = parseTranslationResponse(await translate(url));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify({ translation, provider: 'MyMemory', savedAt: Date.now() }), 'utf8');
        return { translation, cached: false, provider: 'MyMemory' };
      })().finally(() => pending.delete(key)));
      return pending.get(key);
    },
  };
}
module.exports = { buildTranslationUrl, parseTranslationResponse, createSelectionTranslationCommands };

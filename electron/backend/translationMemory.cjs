const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalizeText(text) {
  return text.normalize('NFKC').replace(/([\p{L}])-\r?\n\s*(?=[\p{L}])/gu, '$1').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}
function language(value, text) {
  const code = String(value || 'auto').toLowerCase();
  if (/^(english|en(?:-|$))/.test(code) || code === 'auto' && !/[\u3400-\u9fff]/u.test(text)) return 'en';
  if (/^(chinese|zh(?:-|$))/.test(code)) return 'zh';
  return code;
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
class TranslationMemory {
  constructor(context) { this.context = context; this.root = path.join(context.appPaths.dataDir, '.translation-memory'); this.inflight = new Map(); this.indexes = new Map(); this.writes = new Map(); }
  async scope({ documentId, pdfPath, expectedSignature } = {}) {
    if (!documentId) return '';
    if (!pdfPath && documentId.startsWith('native-library:')) {
      const paper = this.context.store?.load().papers.find(paper => paper.id === documentId.slice(15));
      pdfPath = paper?.attachments?.find(attachment => attachment.kind === 'pdf')?.storedPath;
    }
    if (!pdfPath) return hash([documentId]);
    const stat = await fs.stat(pdfPath);
    const signature = hash([pdfPath, stat.size, stat.mtimeMs, stat.ctimeMs]);
    if (expectedSignature && signature !== expectedSignature) throw new Error('PDF 已发生变化，已保留完成结果；请重新一键处理。');
    return hash([documentId, signature]);
  }
  identity(text, options) {
    const terms = this.context.noteStore?.getDocument('__translation__', 'glossary')?.content || [];
    const model = this.context.qualityTranslation.lock?.model?.sha256 || 'hy-mt2';
    const family = hash(['hy-mt2-memory-v1', model, terms, language(options.source, text), language(options.target || 'Chinese', text)]);
    return { family, key: hash([family, normalizeText(text)]), terms };
  }
  async index(scope) {
    if (!this.indexes.has(scope)) this.indexes.set(scope, (await readJson(path.join(this.root, 'documents', `${scope}.json`))) || []);
    return this.indexes.get(scope);
  }
  async remember(scope, entry) {
    if (!scope) return;
    const previous = this.writes.get(scope) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const index = await this.index(scope);
      if (!index.some(item => item.key === entry.key && item.pageIndex === entry.pageIndex)) index.push(entry);
      await writeJson(path.join(this.root, 'documents', `${scope}.json`), index);
    });
    this.writes.set(scope, next);
    try { await next; } finally { if (this.writes.get(scope) === next) this.writes.delete(scope); }
  }
  async translate(text, options = {}) {
    options.signal?.throwIfAborted();
    const normalized = normalizeText(text);
    if (!normalized || text.length > 40000) throw new Error('待翻译文本为空或过长。');
    const { family, key, terms } = this.identity(text, options);
    const scope = await this.scope(options);
    const file = path.join(this.root, 'entries', `${key}.json`);
    const cached = await readJson(file);
    if (cached?.translation) {
      await this.remember(scope, { key, family, text: normalized, pageIndex: options.pageIndex });
      return { ...cached, cached: true, cacheMatch: 'exact' };
    }
    const model = this.context.qualityTranslation.lock?.model?.sha256;
    const legacyKey = hash(['v3', terms, model, 'offline-quality', options.source || 'English', options.target || 'Chinese', text.trim()]);
    const legacy = await readJson(path.join(this.context.appPaths.dataDir, '.selection-translations', `${legacyKey}.json`));
    if (legacy?.translation) {
      const result = { translation: legacy.translation, sourceText: normalized, provider: 'offline-quality' };
      await writeJson(file, result); await this.remember(scope, { key, family, text: normalized, pageIndex: options.pageIndex });
      return { ...result, cached: true, cacheMatch: 'exact' };
    }
    // Never cut Chinese output using offsets in the English source. Return the
    // complete containing paragraph, explicitly labelled by the reader.
    if (!options.background && scope && normalized.length >= 16) {
      const all = (await this.index(scope)).filter(item => item.family === family && item.text.includes(normalized));
      const onPage = Number.isInteger(options.pageIndex) ? all.filter(item => item.pageIndex === options.pageIndex) : all;
      const candidates = onPage.length ? onPage : all.filter(item => item.pageIndex === undefined);
      if (candidates.length && new Set(candidates.map(item => item.text)).size === 1 && candidates[0].text.length <= Math.max(1600, normalized.length * 8)) {
        const paragraph = await readJson(path.join(this.root, 'entries', `${candidates[0].key}.json`));
        if (paragraph?.translation) return { ...paragraph, cached: true, cacheMatch: 'paragraph' };
      }
    }
    if (this.inflight.has(key)) {
      try {
        const result = await this.inflight.get(key);
        options.signal?.throwIfAborted(); await this.remember(scope, { key, family, text: normalized, pageIndex: options.pageIndex });
        return { ...result, cached: true, cacheMatch: 'exact' };
      } catch (error) { options.signal?.throwIfAborted(); if (this.inflight.has(key)) throw error; }
    }
    const task = (async () => {
      options.signal?.throwIfAborted();
      const translation = await this.context.qualityTranslation.translate(text, { ...options, terms });
      options.signal?.throwIfAborted();
      const result = { translation, sourceText: normalized, provider: 'offline-quality' };
      await writeJson(file, result); await this.remember(scope, { key, family, text: normalized, pageIndex: options.pageIndex });
      return { ...result, cached: false, cacheMatch: 'new' };
    })();
    this.inflight.set(key, task);
    try { return await task; } finally { this.inflight.delete(key); }
  }
}
module.exports = { TranslationMemory, normalizeText, writeJson, readJson, hash };

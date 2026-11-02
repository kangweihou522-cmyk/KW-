const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { normalizeText, selectionContext } = require('./translationText.cjs');
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
    if (!expectedSignature && documentId.startsWith('native-library:')) {
      const paper = this.context.store?.load().papers.find(paper => paper.id === documentId.slice(15));
      pdfPath = paper?.attachments?.find(attachment => attachment.kind === 'pdf')?.storedPath || pdfPath;
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
    const { family, key: baseKey, terms } = this.identity(text, options);
    const scope = await this.scope(options);
    let context = normalizeText(options.selectionContext || options.context || '').slice(0, 4000);
    let reference = null;
    if (!options.background && scope) {
      const all = (await this.index(scope)).filter(item => item.family === family && !item.fragment && item.text !== normalized && item.text.includes(normalized));
      const onPage = Number.isInteger(options.pageIndex) ? all.filter(item => item.pageIndex === options.pageIndex) : all;
      const candidates = onPage.length ? onPage : all.filter(item => item.pageIndex === undefined);
      const specific = candidates.filter(item => !candidates.some(other => other.text !== item.text && item.text.includes(other.text)));
      const unique = [...new Map(specific.map(item => [item.text, item])).values()];
      if (unique.length === 1) {
        const parent = unique[0];
        context ||= selectionContext(parent.context || parent.text, normalized).slice(0, 4000);
        if (parent.text !== normalized) {
          const cachedParent = await readJson(path.join(this.root, 'entries', `${parent.key}.json`));
          if (cachedParent?.translation && (!options.selectionContext || normalizeText(options.selectionContext).includes(parent.text))) reference = { sourceText: parent.text, translation: cachedParent.translation };
        }
      }
    }
    if (context && !context.includes(normalized)) context = '';
    if (context) context = selectionContext(context, normalized);
    // Whole sentences keep the old exact cache. Fragments get their own key,
    // scoped to the paper and surrounding sentence; never return a parent as
    // the selected text's translation.
    const complete = options.background || context === normalized && /\s|[.!?。！？]/.test(normalized) || !context && /[.!?。！？]["')\]]?$/.test(normalized) && /\s/.test(normalized);
    const key = complete ? baseKey : hash([family, 'selection-v2', scope, options.pageIndex, context, context ? null : options.location, normalized]);
    const file = path.join(this.root, 'entries', `${key}.json`);
    const entry = { key, family, text: normalized, fragment: !complete, context: options.background ? normalizeText(options.context || '') : context, pageIndex: options.pageIndex };
    const decorate = (result, cached) => ({ ...result, reference, cached, cacheMatch: cached ? 'exact' : 'new' });
    const cached = await readJson(file);
    if (cached?.translation) { await this.remember(scope, entry); return decorate(cached, true); }
    if (complete) {
      const model = this.context.qualityTranslation.lock?.model?.sha256;
      const legacyKey = hash(['v3', terms, model, 'offline-quality', options.source || 'English', options.target || 'Chinese', text.trim()]);
      const legacy = await readJson(path.join(this.context.appPaths.dataDir, '.selection-translations', `${legacyKey}.json`));
      if (legacy?.translation) {
        const result = { translation: legacy.translation, sourceText: normalized, provider: 'offline-quality' };
        await writeJson(file, result); await this.remember(scope, entry); return decorate(result, true);
      }
    }
    if (this.inflight.has(key)) {
      const pending = this.inflight.get(key);
      try {
        const result = await pending;
        options.signal?.throwIfAborted(); await this.remember(scope, entry); return decorate(result, true);
      } catch (error) { options.signal?.throwIfAborted(); if (this.inflight.get(key) === pending) this.inflight.delete(key); }
    }
    const task = (async () => {
      options.signal?.throwIfAborted();
      const translation = await this.context.qualityTranslation.translate(text, { ...options, context, terms });
      options.signal?.throwIfAborted();
      const result = { translation, sourceText: normalized, provider: 'offline-quality' };
      await writeJson(file, result); await this.remember(scope, entry); return result;
    })();
    this.inflight.set(key, task);
    try { return decorate(await task, false); } finally { if (this.inflight.get(key) === task) this.inflight.delete(key); }
  }
}
module.exports = { TranslationMemory, normalizeText, writeJson, readJson, hash };

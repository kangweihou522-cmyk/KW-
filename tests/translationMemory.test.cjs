const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TranslationMemory, normalizeText, hash, writeJson } = require('../electron/backend/translationMemory.cjs');
const { InferenceQueue } = require('../electron/backend/inferenceQueue.cjs');
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-memory-')); t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let calls = 0; let terms = [];
  const context = { appPaths: { dataDir }, qualityTranslation: { lock: { model: { sha256: 'model-a' } }, translate: async text => { calls++; return `译文：${normalizeText(text)}`; } }, noteStore: { getDocument: () => ({ content: terms }) } };
  return { context, get calls() { return calls; }, glossary: value => { terms = value; }, create: () => new TranslationMemory(context) };
}
test('full translation and selection share normalized cache across restart, and label containing paragraphs', async t => {
  const f = await fixture(t); const first = f.create();
  await first.translate('The treat-\nment reduced blood pressure. The sample size was 20.', { documentId: 'paper-a', background: true, source: 'English' });
  const restarted = f.create();
  const exact = await restarted.translate('The treatment reduced blood pressure.  The sample size was 20.', { documentId: 'paper-a', source: 'auto' });
  assert.equal(exact.cached, true); assert.equal(f.calls, 1);
  const paragraph = await restarted.translate('The sample size was 20.', { documentId: 'paper-a' });
  assert.equal(paragraph.cacheMatch, 'paragraph'); assert(paragraph.sourceText.startsWith('The treatment'));
  const unrelated = await restarted.translate('The sample size was 20.', { documentId: 'paper-b' });
  assert.equal(unrelated.cached, false); assert.equal(f.calls, 2);
});
test('terms, model, target and changed PDF invalidate relevant cached translations', async t => {
  const f = await fixture(t); const memory = f.create(); const pdfPath = path.join(f.context.appPaths.dataDir, 'paper.pdf'); await fs.writeFile(pdfPath, 'old');
  const text = 'A long paragraph includes sample size of twenty participants.';
  await memory.translate(text, { documentId: 'paper', pdfPath });
  f.glossary([{ source: 'sample', target: '样本' }]); assert.equal((await memory.translate(text, {})).cached, false);
  f.context.qualityTranslation.lock.model.sha256 = 'model-b'; assert.equal((await memory.translate(text, {})).cached, false);
  assert.equal((await memory.translate(text, { target: 'French' })).cached, false);
  f.glossary([]); f.context.qualityTranslation.lock.model.sha256 = 'model-a';
  await fs.writeFile(pdfPath, 'new PDF with different content');
  assert.equal((await memory.translate('sample size of twenty participants.', { documentId: 'paper', pdfPath })).cached, false);
});
test('canceled and failed generation never populate cache, simultaneous exact requests compute once', async t => {
  const f = await fixture(t); const memory = f.create(); let release;
  f.context.qualityTranslation.translate = () => new Promise(resolve => { release = resolve; });
  const one = memory.translate('Same passage');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const two = memory.translate('Same passage'); release('同一段');
  assert.equal((await one).translation, (await two).translation);
  const abort = new AbortController(); f.context.qualityTranslation.translate = async () => { abort.abort(); return '取消的译文'; };
  await assert.rejects(memory.translate('Canceled passage', { signal: abort.signal }));
  f.context.qualityTranslation.translate = async () => '完成';
  assert.equal((await memory.translate('Canceled passage')).cached, false);
});
test('previous exact selection caches migrate into the shared translation memory', async t => {
  const f = await fixture(t); const key = hash(['v3', [], 'model-a', 'offline-quality', 'English', 'Chinese', 'Legacy passage']);
  await writeJson(path.join(f.context.appPaths.dataDir, '.selection-translations', `${key}.json`), { translation: '旧译文' });
  assert.equal((await f.create().translate('Legacy passage', { source: 'English', target: 'Chinese' })).translation, '旧译文'); assert.equal(f.calls, 0);
});
test('containing matches use the selected page and avoid ambiguous paragraphs when the location is unknown', async t => {
  const f = await fixture(t); const memory = f.create();
  await memory.translate('In the first experiment the sample size was twenty participants.', { documentId: 'paper', background: true, pageIndex: 0 });
  await memory.translate('In the second experiment the sample size was twenty participants.', { documentId: 'paper', background: true, pageIndex: 1 });
  const fragment = 'the sample size was twenty participants.';
  const located = await memory.translate(fragment, { documentId: 'paper', pageIndex: 1 });
  assert.equal(located.cached, true); assert(located.sourceText.includes('second experiment'));
  const unknown = await memory.translate(fragment, { documentId: 'paper' }); assert.equal(unknown.cached, false);
});
test('interactive requests run before queued background requests and aborted queue entries are removed', async () => {
  const queue = new InferenceQueue(); const order = []; let release;
  const first = queue.run(() => new Promise(resolve => { release = resolve; }), { background: true });
  const background = queue.run(() => order.push('background'), { background: true });
  const abort = new AbortController(); const cancelled = queue.run(() => assert.fail('cancelled work ran'), { signal: abort.signal });
  const rejected = assert.rejects(cancelled); abort.abort();
  const reading = queue.run(() => order.push('reading')); release();
  await Promise.all([first, background, reading, rejected]); assert.deepEqual(order, ['reading', 'background']);
});

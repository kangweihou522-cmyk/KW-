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
test('old paragraph caches remain references; an exact selected sentence is translated once and reused after restart', async t => {
  const f = await fixture(t); const first = f.create();
  await first.translate('The treat-\nment reduced blood pressure. The sample size was 20.', { documentId: 'paper-a', background: true, source: 'English' });
  const restarted = f.create();
  const exact = await restarted.translate('The treatment reduced blood pressure.  The sample size was 20.', { documentId: 'paper-a', source: 'auto' });
  assert.equal(exact.cached, true); assert.equal(f.calls, 1);
  const sentence = await restarted.translate('The sample size was 20.', { documentId: 'paper-a' });
  assert.equal(sentence.cached, false); assert.equal(sentence.translation, '译文：The sample size was 20.');
  assert(sentence.reference.sourceText.startsWith('The treatment'));
  assert.equal((await f.create().translate('The sample size was 20.', { documentId: 'paper-a' })).cached, true); assert.equal(f.calls, 2);
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
  const f = await fixture(t); const key = hash(['v3', [], 'model-a', 'offline-quality', 'English', 'Chinese', 'Legacy passage.']);
  await writeJson(path.join(f.context.appPaths.dataDir, '.selection-translations', `${key}.json`), { translation: '旧译文' });
  assert.equal((await f.create().translate('Legacy passage.', { source: 'English', target: 'Chinese' })).translation, '旧译文'); assert.equal(f.calls, 0);
});
test('fragments use page-specific context and never substitute the containing translation', async t => {
  const f = await fixture(t); const memory = f.create();
  await memory.translate('In the first experiment the sample size was twenty participants.', { documentId: 'paper', background: true, pageIndex: 0 });
  await memory.translate('In the second experiment the sample size was twenty participants.', { documentId: 'paper', background: true, pageIndex: 1 });
  const fragment = 'the sample size was twenty participants.';
  const located = await memory.translate(fragment, { documentId: 'paper', pageIndex: 1 });
  assert.equal(located.cached, false); assert.equal(located.sourceText, fragment); assert(located.reference.sourceText.includes('second experiment'));
  assert.equal((await memory.translate(fragment, { documentId: 'paper', pageIndex: 1 })).cached, true);
  assert.equal((await memory.translate(fragment, { documentId: 'paper', pageIndex: 0 })).cached, false);
});
test('short words use their surrounding sentence and remain separately cached for different meanings', async t => {
  const f = await fixture(t); const memory = f.create(); let calls = 0; const contexts = [];
  f.context.qualityTranslation.translate = async (text, options) => { calls++; contexts.push(options.context); return options.context.includes('control group') ? '对照' : '控制'; };
  const request = { documentId: 'paper', pageIndex: 0, selectionContext: 'The control group received no treatment.' };
  const one = await memory.translate('control', request); assert.equal(one.translation, '对照'); assert.equal(one.cached, false);
  assert.equal((await f.create().translate('control', request)).cached, true); assert.equal(calls, 1);
  const other = await memory.translate('control', { ...request, selectionContext: 'We control the temperature.' });
  assert.equal(other.translation, '控制'); assert.equal(calls, 2); assert.equal(contexts[0], request.selectionContext);
});
test('annotated and original PDFs of the same library paper share references and word caches', async t => {
  const f = await fixture(t); const memory = f.create();
  const original = path.join(f.context.appPaths.dataDir, 'original.pdf'); const annotated = path.join(f.context.appPaths.dataDir, 'annotated.pdf');
  await fs.writeFile(original, 'original PDF'); await fs.writeFile(annotated, 'annotated PDF');
  f.context.store = { load: () => ({ papers: [{ id: 'p', attachments: [{ kind: 'pdf', storedPath: original }] }] }) };
  await memory.translate('Capsaicinoids improve growth.', { documentId: 'native-library:p', pdfPath: original, background: true });
  const word = await memory.translate('Capsaicinoids', { documentId: 'native-library:p', pdfPath: annotated });
  assert.equal(word.translation, '译文：Capsaicinoids'); assert.equal(word.reference.translation, '译文：Capsaicinoids improve growth.');
  assert.equal((await memory.translate('Capsaicinoids', { documentId: 'native-library:p', pdfPath: original })).cached, true);
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

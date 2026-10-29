const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');
const { createSelectionTranslationCommands, buildTranslationUrl, parseTranslationResponse } = require('../electron/backend/selectionTranslation.cjs');

test('ChatGPT reports update one durable note and reject stale editors', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-report-'));
  const appPaths = { dataDir: dir, notesDatabasePath: path.join(dir, 'notes.sqlite') };
  let store = createNoteStore(appPaths); const commands = createNoteCommands({ noteStore: store });
  t.after(async () => { store.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const request = { paperId: 'paper-1', title: 'Fictional test report', type: 'ai-chat', content: 'First', contentText: 'First', tags: ['读书报告', 'ChatGPT手动回填'] };
  const first = commands.notes_save_chatgpt_report({ request });
  assert.throws(() => commands.notes_save_chatgpt_report({ request }), /其他窗口/);
  const updated = commands.notes_save_chatgpt_report({ request: { ...request, content: 'Second', contentText: 'Second' }, expectedUpdatedAt: first.updatedAt, expectedContent: first.content });
  assert.equal(updated.id, first.id);
  assert.equal(store.listNotes({ paperId: 'paper-1' }).length, 1);
  store.close(); store = createNoteStore(appPaths);
  assert.equal(store.getNote({ id: first.id }).contentText, 'Second');
  assert.equal(store.listNotes({ paperId: 'paper-2' }).length, 0);
});

test('free translation caches durably and coalesces duplicate requests without a paid fallback', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-translate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const commands = createSelectionTranslationCommands({ appPaths: { dataDir: dir }, translate: async (url) => {
    calls++; assert.equal(url.hostname, 'api.mymemory.translated.net'); assert.equal(url.searchParams.get('q'), 'Fictional sample size: twenty.');
    return { responseStatus: 200, responseData: { translatedText: '虚构样本量：二十。' } };
  } });
  const request = { text: 'Fictional sample size: twenty.', source: 'en', target: 'zh-CN', consent: true };
  await assert.rejects(commands.translate_selection_free({ ...request, consent: false }), /同意/);
  const [a, b] = await Promise.all([commands.translate_selection_free(request), commands.translate_selection_free(request)]);
  assert.equal(a.translation, b.translation); assert.equal(calls, 1);
  const fresh = createSelectionTranslationCommands({ appPaths: { dataDir: dir }, translate: () => { throw new Error('cache miss'); } });
  assert.equal((await fresh.translate_selection_free(request)).cached, true);
});

test('translation preserves UTF-8, enforces byte and language limits, and rejects quota failures', () => {
  assert.equal(buildTranslationUrl('α + β = 测试').searchParams.get('q'), 'α + β = 测试');
  assert.throws(() => buildTranslationUrl('中'.repeat(167)), /500/);
  assert.throws(() => buildTranslationUrl('test', 'auto'), /明确选择/);
  assert.throws(() => parseTranslationResponse({ responseStatus: 403, responseData: { translatedText: 'QUOTA EXCEEDED' } }), /额度/);
  assert.throws(() => parseTranslationResponse({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'no' } }), /额度/);
});

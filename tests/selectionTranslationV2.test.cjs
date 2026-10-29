const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { createSelectionTranslationV2 } = require('../electron/backend/selectionTranslationV2.cjs');
async function fixture(t, complete) { const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-selection-v2-')); t.after(() => fs.rm(dataDir, { recursive: true, force: true })); return createSelectionTranslationV2({ appPaths: { dataDir }, chatGptBridge: { complete } }); }
test('ChatGPT selections accept longer passages than the old free endpoint and reuse local results without auth or model requests', async t => {
  let calls = 0; const commands = await fixture(t, async () => { calls++; return '虚构科研译文，n=20。'; });
  const request = { text: 'Fictional scientific text. '.repeat(30), provider: 'chatgpt', consent: true, requestId: 'first' };
  await assert.rejects(commands.selection_translate({ ...request, consent: false }), /开启自动/);
  const first = await commands.selection_translate(request); const second = await commands.selection_translate({ ...request, requestId: 'second' });
  assert.equal(first.translation, second.translation); assert.equal(second.cached, true); assert.equal(calls, 1);
});
test('selection cancellation reaches the active model call and rejects its stale task', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const commands = await fixture(t, (text, { signal }) => new Promise((resolve, reject) => { started(); signal.addEventListener('abort', () => reject(new Error('取消旧请求')), { once: true }); }));
  const pending = commands.selection_translate({ text: 'Fictional stale request', consent: true, requestId: 'old' }); const rejected = assert.rejects(pending, /取消/);
  await ready; commands.selection_translate_cancel({ requestId: 'old' }); await rejected;
});
test('unknown services are rejected and DeepL uses a free key instead of a paid fallback', async t => {
  const commands = await fixture(t, () => { throw new Error('not expected'); });
  await assert.rejects(commands.selection_translate({ text: 'Example', provider: 'paid-pro', consent: true }), /未知/);
  await assert.rejects(commands.selection_translation_set_deepl_key({ key: 'non-free-key' }), /Free/);
});

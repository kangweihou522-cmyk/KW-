// Actual inference integration check; uses only the pinned model and local CPU.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { OfflineTranslation } = require('../../electron/backend/offlineTranslation.cjs');
const { createSelectionTranslationV2 } = require('../../electron/backend/selectionTranslationV2.cjs');
const lock = require('../../packaging/offline-translation-lock.json');

async function main() {
  const repo = path.resolve(__dirname, '../..');
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-real-translation-'));
  const appPaths = { homeDir, dataDir: path.join(homeDir, 'data') };
  const packaged = process.argv.includes('--packaged-runtime');
  const pythonPath = packaged ? path.join(repo, 'release/offline-translation/python/python.exe') : process.env.PAPERDESK_TRANSLATION_PYTHON || path.join(repo, '.cache/offline-translation-venv/bin/python');
  const workerPath = packaged ? path.join(repo, 'release/offline-translation/worker.py') : path.join(__dirname, 'worker.py');
  const engine = new OfflineTranslation({ appPaths, pythonPath, workerPath, downloadPackage: () => fs.readFile(path.join(repo, '.cache/offline-translation', lock.model.name)) });
  const commands = createSelectionTranslationV2({ appPaths, offlineTranslation: engine, chatGptBridge: { complete() { throw new Error('Offline inference must never call ChatGPT'); } } });
  try {
    await engine.install();
    assert.equal((await engine.status()).ready, true);
    const startup = performance.now(); await engine.start();
    console.log(JSON.stringify({ platform: process.platform, packagedRuntime: packaged, startupMs: Math.round(performance.now() - startup), model: lock.model.id }));
    const examples = [
      'The sample size was 20.',
      'The treatment reduced blood pressure by 12% compared with the control group (95% confidence interval, 8-16%; P < 0.05).',
      'The authors reported an association, but the observational design does not establish causality.',
      'In a random-\nized trial, 40 participants were assigned to two groups.\n\nFollow-up lasted 6 months.',
    ];
    for (const [index, text] of examples.entries()) {
      const started = performance.now(); const deltas = [];
      const translation = await engine.translate(text, { onDelta: delta => deltas.push(delta) });
      assert.match(translation, /[\u3400-\u9fff]/);
      assert.equal(deltas.join(''), translation);
      for (const number of text.match(/\d+(?:\.\d+)?/g) || []) assert(translation.includes(number), `Missing original number ${number}: ${translation}`);
      if (index === 3) assert(translation.includes('\n\n'), 'Paragraph separation disappeared');
      console.log(JSON.stringify({ sample: index + 1, ms: Math.round(performance.now() - started), translation }));
    }
    const longText = Array.from({ length: 40 }, (_, index) => `the measured value in group ${300 + index} was associated with the outcome`).join('; ') + '.';
    const longStarted = performance.now(); const longTranslation = await engine.translate(longText);
    assert(longTranslation.includes('339'), 'Long-input tail was silently truncated');
    console.log(JSON.stringify({ longInputChars: longText.length, ms: Math.round(performance.now() - longStarted), tailPreserved: true }));
    const request = { provider: 'offline', consent: false, text: examples[0], requestId: 'cache-first' };
    const first = await commands.selection_translate(request); assert.equal(first.cached, false);
    const cachedAt = performance.now(); const cached = await commands.selection_translate({ ...request, requestId: 'cache-next' });
    assert.equal(cached.cached, true); assert.equal(cached.translation, first.translation);
    console.log(JSON.stringify({ cached: true, ms: Math.round(performance.now() - cachedAt), cloudConsent: false }));
    const controller = new AbortController(); let chunks = 0;
    const canceled = engine.translate(longText, { signal: controller.signal, onDelta() { if (++chunks === 1) controller.abort(); } });
    await assert.rejects(canceled, /取消/);
    const afterCancel = await engine.translate('The sample size was 21.'); assert(afterCancel.includes('21'));
    console.log(JSON.stringify({ realCancellationPassed: true, nextSelectionSucceeded: true }));
  } finally {
    const child = engine.child;
    const stopped = child && child.exitCode == null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    engine.close();
    await stopped;
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

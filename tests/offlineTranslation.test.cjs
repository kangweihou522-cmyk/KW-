const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { OfflineTranslation, packageEntries } = require('../electron/backend/offlineTranslation.cjs');
const { createSelectionTranslationV2 } = require('../electron/backend/selectionTranslationV2.cjs');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function languagePackage(extra = []) {
  const archive = new AdmZip();
  for (const [name, data] of [
    ['metadata.json', JSON.stringify({ from_code: 'en', to_code: 'zh', package_version: '1.9' })],
    ['sentencepiece.model', 'Fictional tokenizer, not an inference-quality test'],
    ['model/config.json', '{}'], ['model/model.bin', 'Fictional model'], ['LICENSE', 'Fictional license fixture'], ...extra,
  ]) archive.addFile(`translate-en_zh-1_9/${name}`, Buffer.from(data));
  return archive.toBuffer();
}
async function fixture(t, options = {}) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-offline-test-'));
  const dataDir = path.join(homeDir, 'data'); await fs.mkdir(dataDir);
  const bytes = languagePackage();
  const lock = { model: { id: 'argos-en-zh-1.9', name: 'fictional.argosmodel', downloadUrl: 'https://github.com/fictional/fixture', sha256: digest(bytes), bytes: bytes.length } };
  let downloads = 0; let launch; const sent = [];
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 0); };
  const reply = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.stdin = new Writable({ write(data, encoding, done) { sent.push(JSON.parse(data)); done(); } });
  const engine = new OfflineTranslation({ appPaths: { homeDir, dataDir }, lock, pythonPath: process.execPath, workerPath: __filename,
    downloadPackage: async () => { downloads++; return options.corrupt ? Buffer.from('corrupted download') : bytes; },
    spawnProcess(executable, args, config) { launch = { executable, args, config }; setImmediate(() => reply({ type: 'ready' })); return child; },
  });
  t.after(async () => { engine.close(); await fs.rm(homeDir, { recursive: true, force: true }); });
  return { engine, dataDir, homeDir, lock, sent, reply, launch: () => launch, downloads: () => downloads };
}
const next = () => new Promise(resolve => setImmediate(resolve));

test('language package installs once outside the app and preserves local notes', async t => {
  const f = await fixture(t); const note = path.join(f.dataDir, 'existing-note.txt'); await fs.writeFile(note, 'Keep this report');
  const oldModel = path.join(f.homeDir, 'models', 'existing-ollama-model'); await fs.mkdir(path.dirname(oldModel)); await fs.writeFile(oldModel, 'Keep optional local models');
  await Promise.all([f.engine.install(), f.engine.install()]);
  assert.equal(f.downloads(), 1); assert.equal((await f.engine.status()).ready, true);
  assert(f.engine.modelDir.startsWith(path.join(f.homeDir, 'models', 'translation')));
  assert.equal(await fs.readFile(note, 'utf8'), 'Keep this report');
  assert.equal(await fs.readFile(oldModel, 'utf8'), 'Keep optional local models');
  await f.engine.install(); assert.equal(f.downloads(), 1);
  assert(await fs.stat(path.join(f.engine.modelDir, 'LICENSE')));
});
test('corrupt downloads cannot replace an installed language package', async t => {
  const f = await fixture(t); await f.engine.install();
  const before = await fs.readFile(path.join(f.engine.modelDir, 'model/model.bin'));
  f.engine.failure = 'Test repair request'; f.engine.downloadPackage = async () => Buffer.from('corruption');
  await assert.rejects(f.engine.install(), /SHA256/);
  assert.deepEqual(await fs.readFile(path.join(f.engine.modelDir, 'model/model.bin')), before);
});
test('archive traversal, duplicate paths and wrong languages are rejected before extraction', () => {
  const unsafe = new AdmZip(); unsafe.addFile('fixture/metadata.json', Buffer.from('{"from_code":"en","to_code":"zh"}'));
  unsafe.addFile('fixture/model/C:stream', Buffer.from('x'));
  assert.throws(() => packageEntries(unsafe.toBuffer()), /不安全/);
  assert.throws(() => packageEntries(languagePackage([['model/MODEL.BIN', 'case collision']])), /重复/);
  const wrong = new AdmZip(); wrong.addFile('metadata.json', Buffer.from('{"from_code":"de","to_code":"zh"}'));
  assert.throws(() => packageEntries(wrong.toBuffer()), /英语/);
});
test('damaged installed weights fail verification before the Python worker starts', async t => {
  const f = await fixture(t); await f.engine.install();
  await fs.writeFile(path.join(f.engine.modelDir, 'model/model.bin'), 'Different model');
  await assert.rejects(f.engine.start(), /语言包|损坏/); assert.equal(f.launch(), undefined);
});
test('persistent worker streams the current request and cancels stale selections', async t => {
  const f = await fixture(t); await f.engine.install(); const controller = new AbortController(); const chunks = [];
  const first = f.engine.translate('Fictional old selection', { signal: controller.signal }); const rejected = assert.rejects(first, /取消/);
  for (let i = 0; i < 30 && !f.sent.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const old = f.sent.find(item => item.type === 'translate'); assert(old); controller.abort(); await rejected;
  assert(f.sent.some(item => item.type === 'cancel' && item.id === old.id));
  const second = f.engine.translate('Fictional current selection', { onDelta: delta => chunks.push(delta) }); await next();
  const current = f.sent.filter(item => item.type === 'translate').at(-1);
  f.reply({ id: old.id, type: 'done', translation: 'Discard old result' });
  f.reply({ id: current.id, type: 'delta', delta: '当前译文' }); f.reply({ id: current.id, type: 'done', translation: '当前译文' });
  assert.equal(await second, '当前译文'); assert.deepEqual(chunks, ['当前译文']);
  assert(f.launch().args.includes('-I')); assert.equal(f.engine.pending.size, 0);
});
test('offline selections need no cloud consent or ChatGPT account and use persistent cache', async t => {
  const f = await fixture(t); let translations = 0;
  f.engine.translate = async () => { translations++; return '虚构测试译文'; };
  const commands = createSelectionTranslationV2({ appPaths: { dataDir: f.dataDir }, offlineTranslation: f.engine, chatGptBridge: { complete() { assert.fail('Offline translation contacted ChatGPT'); } } });
  const request = { provider: 'offline', source: 'English', target: 'Chinese', text: 'Fictional selection', consent: false };
  assert.equal((await commands.selection_translate(request)).cached, false);
  assert.equal((await commands.selection_translate(request)).cached, true); assert.equal(translations, 1);
  await assert.rejects(commands.selection_translate({ ...request, provider: 'chatgpt' }), /开启自动/);
});
test('long inputs retain every token and PDF line wraps are normalized without discarding paragraphs', () => {
  const script = "import runpy,json; m=runpy.run_path('scripts/translation/worker.py'); tokens=[str(i) for i in range(1500)]; chunks=m['token_chunks'](tokens); print(json.dumps({'tokens':[t for c in chunks for t in c], 'largest':max(map(len,chunks)), 'paragraphs':m['normalize_pdf_text']('A random-\\nized trial.\\nSample size: 20.\\n\\nP < 0.05.')}))";
  const result = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', script], { encoding: 'utf8' }));
  assert.equal(result.tokens.length, 1500); assert.equal(result.tokens.at(-1), '1499'); assert(result.largest <= 192);
  assert.deepEqual(result.paragraphs, ['A randomized trial. Sample size: 20.', 'P < 0.05.']);
});

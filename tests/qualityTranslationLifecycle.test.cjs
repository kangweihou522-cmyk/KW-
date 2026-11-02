const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { QualityTranslation } = require('../electron/backend/qualityTranslation.cjs');

async function fixture(t, options = {}) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-quality-lifecycle-'));
  const bytes = Buffer.from('GGUF Fictional model fixture, never an inference-quality claim.');
  const model = { repository: 'tencent/fixture', revision: 'a'.repeat(40), name: 'fixture.gguf', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  const runtime = path.join(homeDir, 'runtime', 'cpu'); await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(runtime, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'), 'fixture');
  let downloads = 0; let starts = 0;
  const engine = new QualityTranslation({ appPaths: { homeDir, dataDir: path.join(homeDir, 'data') }, qualityRuntimeDir: path.dirname(runtime), qualityLock: { model }, qualityDownload: async (url, file, settings) => { downloads++; if (options.download) await options.download(file, settings); else await fs.writeFile(file, bytes); } });
  engine.launch = async () => { starts++; };
  t.after(async () => { engine.close(); await fs.rm(homeDir, { recursive: true, force: true }); });
  return { engine, bytes, model, homeDir, downloads: () => downloads, starts: () => starts };
}

test('a missing-model error does not poison a later successful install or translation startup', async t => {
  const f = await fixture(t);
  await assert.rejects(f.engine.start(), error => error.code === 'MODEL_MISSING');
  const status = await f.engine.install();
  assert.equal(status.ready, true); assert.equal(status.installing, false); assert.equal(status.error, '');
  assert.equal(f.downloads(), 1); assert.equal(f.starts(), 1);
  await f.engine.start(); await f.engine.install(undefined, true);
  assert.equal(f.downloads(), 1, 'Repair must verify and reuse healthy weights.');
});

test('complete weights without a manifest are recovered without another download', async t => {
  const f = await fixture(t); await fs.mkdir(f.engine.modelDir, { recursive: true });
  await fs.writeFile(f.engine.modelFile, f.bytes);
  assert.equal((await f.engine.status()).recoverable, true);
  await f.engine.install();
  assert.equal(f.downloads(), 0); assert.equal((await f.engine.status()).ready, true);
  assert.equal((await f.engine.manifest()).sha256, f.model.sha256);
  assert.match(await fs.readFile(path.join(f.engine.modelDir, 'LICENSE-HY-MT2'), 'utf8'), /Apache/);
});

test('runtime failure is distinct from model damage and is retryable without downloading weights', async t => {
  const f = await fixture(t); await f.engine.install(); f.engine.close();
  f.engine.launch = async () => { throw new Error('Fictional runtime failure'); };
  await assert.rejects(f.engine.start(), error => error.code === 'RUNTIME_START_FAILED' && error.message.includes('无需重新下载'));
  assert.equal((await f.engine.status()).installed, true);
  assert.equal((await f.engine.status()).errorPhase, 'runtime');
  f.engine.launch = async () => {};
  await f.engine.start();
  assert.equal((await f.engine.status()).ready, true); assert.equal(f.downloads(), 1);
});

test('selection during installation awaits the same install instead of reporting a missing model', async t => {
  let release; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { download: async file => { started(); await gate; await fs.writeFile(file, f.bytes); } });
  const install = f.engine.install(); await ready;
  const start = f.engine.start();
  assert.equal((await f.engine.status()).installing, true);
  release(); await Promise.all([install, start]);
  assert.equal(f.downloads(), 1); assert.equal(f.starts(), 1);
  assert.equal((await f.engine.status()).error, '');
});

test('failed downloads retain partial bytes and distinguish incomplete files from corrupt full weights', async t => {
  const f = await fixture(t, { download: async file => { await fs.writeFile(file, 'GGUF partial'); throw new Error('Fictional connection reset'); } });
  await assert.rejects(f.engine.install(), /connection reset/);
  const status = await f.engine.status();
  assert.equal(status.partialBytes, 12); assert.equal(status.errorPhase, 'download'); assert.equal(status.ready, false);
  assert.equal(await fs.readFile(f.engine.partialFile(), 'utf8'), 'GGUF partial');
  await fs.writeFile(f.engine.modelFile, 'GGUF short');
  await assert.rejects(f.engine.start(), error => error.code === 'MODEL_SIZE_MISMATCH');
  await fs.writeFile(f.engine.modelFile, Buffer.alloc(f.bytes.length, 'x'));
  await assert.rejects(f.engine.start(), error => error.code === 'MODEL_HASH_MISMATCH');
});

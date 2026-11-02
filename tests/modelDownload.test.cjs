const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { downloadModelResource, trustedAddress, modelDownloadSession, MODEL_DOWNLOAD_PARTITION } = require('../electron/backend/modelDownload.cjs');

const url = 'https://huggingface.co/tencent/fixture/resolve/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/model.gguf';
const bytes = Buffer.from('GGUF Fictional download fixture.');
const checksum = createHash('sha256').update(bytes).digest('hex');
async function fixture(t) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-model-download-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); return path.join(folder, 'model.part'); }
const response = (body, statusCode = 200, headers = {}) => ({ stream: Readable.from([body]), statusCode, headers: { 'content-length': String(body.length), ...headers } });
const options = extra => ({ bytes: bytes.length, sha256: checksum, retryDelay: 0, ...extra });

test('model continuation verifies Range, final size and the full SHA256 before enabling', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 9));
  const progress = [];
  await downloadModelResource(url, file, options({ onProgress: p => progress.push(p), openResponse: async (address, { headers }) => { assert.equal(headers.Range, 'bytes=9-'); return response(bytes.subarray(9), 206, { 'content-range': `bytes 9-${bytes.length - 1}/${bytes.length}` }); } }));
  assert.deepEqual(await fs.readFile(file), bytes);
  assert(progress.some(p => p.received === 9)); assert.equal(progress.at(-1).stage, 'verify');
});

test('a server ignoring Range replaces the partial file instead of appending a second copy', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 6));
  await downloadModelResource(url, file, options({ openResponse: async () => response(bytes) }));
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('temporary network failure retries the pinned model and retains existing progress', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 7)); let calls = 0;
  await downloadModelResource(url, file, options({ openResponse: async (address, { headers }) => { calls++; assert.equal(headers.Range, 'bytes=7-'); if (calls === 1) { const error = new Error('fixture disconnect'); error.code = 'ECONNRESET'; throw error; } return response(bytes.subarray(7), 206, { 'content-range': `bytes 7-${bytes.length - 1}/${bytes.length}` }); } }));
  assert.equal(calls, 2); assert.deepEqual(await fs.readFile(file), bytes);
});

test('exhausted download retries preserve the prefix and identify the failing official host', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 5));
  await assert.rejects(downloadModelResource(url, file, options({ attempts: 2, openResponse: async () => { const error = new Error('fixture failure'); error.code = 'ETIMEDOUT'; throw error; } })), /huggingface.co，ETIMEDOUT/);
  assert.deepEqual(await fs.readFile(file), bytes.subarray(0, 5));
});

test('wrong continuation ranges cannot append data to an existing partial model', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 5));
  await assert.rejects(downloadModelResource(url, file, options({ openResponse: async () => response(bytes.subarray(5), 206, { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` }) })), /RANGE_INVALID/);
  assert.deepEqual(await fs.readFile(file), bytes.subarray(0, 5));
});

test('a corrupt completed file is rejected and a subsequent verified download is accepted', async t => {
  const file = await fixture(t); const corrupt = Buffer.alloc(bytes.length, 'x');
  await assert.rejects(downloadModelResource(url, file, options({ attempts: 1, openResponse: async () => response(corrupt) })), /HASH_MISMATCH/);
  await assert.rejects(fs.stat(file), error => error.code === 'ENOENT');
  await downloadModelResource(url, file, options({ openResponse: async () => response(bytes) }));
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('only official HTTPS model redirects are accepted, without credentials or insecure downgrade', () => {
  assert.equal(trustedAddress('https://cas-bridge.xethub.hf.co/model').hostname, 'cas-bridge.xethub.hf.co');
  for (const address of ['http://huggingface.co/model', 'https://huggingface.co.evil.invalid/model', 'https://user:password@huggingface.co/model', 'https://example.invalid/model']) assert.throws(() => trustedAddress(address), /官方/);
});

test('pausing a connection preserves its partial file and does not turn into automatic retries', async t => {
  const file = await fixture(t); await fs.writeFile(file, bytes.subarray(0, 8));
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(downloadModelResource(url, file, options({ signal: controller.signal, openResponse: async (address, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); setImmediate(() => controller.abort(new Error('User paused download'))); });
  } })), /User paused/);
  assert.equal(calls, 1); assert.deepEqual(await fs.readFile(file), bytes.subarray(0, 8));
});

test('model downloads use an isolated session with official-host checks and no renderer permissions', () => {
  let check; let permission; let registrations = 0;
  const isolated = { setPermissionRequestHandler(handler) { permission = handler; }, webRequest: { onBeforeRequest(filter, handler) { registrations++; check = handler; } } };
  const electron = { session: { fromPartition(name, options) { assert.equal(name, MODEL_DOWNLOAD_PARTITION); assert.equal(options.cache, false); return isolated; }, get defaultSession() { throw new Error('Model downloads must not change document renderer policy.'); } } };
  assert.equal(modelDownloadSession(electron), isolated);
  modelDownloadSession(electron); assert.equal(registrations, 1);
  check({ url }, result => assert.equal(result.cancel, false));
  check({ url: 'https://cas-bridge.xethub.hf.co/model' }, result => assert.equal(result.cancel, false));
  for (const address of ['https://example.invalid/file', 'http://huggingface.co/file', 'file:///private', 'https://github.com/file']) check({ url: address }, result => assert.equal(result.cancel, true));
  permission(null, 'clipboard-read', allowed => assert.equal(allowed, false));
});

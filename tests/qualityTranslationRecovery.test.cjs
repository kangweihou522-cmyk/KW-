const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { QualityTranslation } = require('../electron/backend/qualityTranslation.cjs');
async function fixture(t, handler) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const engine = new QualityTranslation({ appPaths: { dataDir: '/unused' } }); let restarts = 0;
  engine.start = async () => { engine.port = server.address().port; engine.token = 'fictional-local-token'; };
  engine.stopRuntime = async () => { restarts++; };
  t.after(async () => { engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { engine, restarts: () => restarts };
}
function complete(res, value) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: value }, finish_reason: 'stop' }] })}\n\n`);
}
test('an actual local socket disconnect restores the runtime once and returns a complete translation', async t => {
  let requests = 0; const resets = [];
  const f = await fixture(t, (req, res) => { if (++requests === 1) req.socket.destroy(); else complete(res, '辣椒素类化合物'); });
  const result = await f.engine.translate('Capsaicinoids', { onReset: value => resets.push(value) });
  assert.equal(result, '辣椒素类化合物'); assert.equal(requests, 2); assert.equal(f.restarts(), 1); assert.deepEqual(resets, ['']);
});
test('a second disconnect reports an actionable local error without an infinite retry', async t => {
  let requests = 0;
  const f = await fixture(t, req => { requests++; req.socket.destroy(); });
  await assert.rejects(f.engine.translate('Capsaicinoids'), error => error.code === 'INFERENCE_CONNECTION_LOST' && /已有模型和缓存会保留/.test(error.message));
  assert.equal(requests, 2); assert.equal(f.restarts(), 1);
});
test('canceling an old selection never restarts the shared runtime or poisons the next selection', async t => {
  let started; const ready = new Promise(resolve => { started = resolve; }); let requests = 0;
  const f = await fixture(t, (req, res) => {
    if (++requests === 1) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"旧选区"}}]}\n\n'); }
    else complete(res, '新选区');
  });
  const controller = new AbortController();
  const old = f.engine.translate('Old selection', { signal: controller.signal, onDelta: () => started() }); const rejected = assert.rejects(old);
  await ready; controller.abort(); await rejected;
  assert.equal(await f.engine.translate('New selection'), '新选区'); assert.equal(f.restarts(), 0); assert.equal(requests, 2);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { assertLocalUrl, createLocalOnlyFetch } = require('../electron/backend/networkPolicy.cjs');

test('hosted AI, remote services and credentialed URLs are blocked before network access', async () => {
  let called = false;
  const guarded = createLocalOnlyFetch(async () => { called = true; });
  for (const endpoint of ['https://api.openai.com/v1/chat/completions', 'https://mineru.net/api/v4',
    'http://127.0.0.1.evil.example/', 'http://user:secret@localhost/', 'file:///tmp/a', 'http://192.168.1.2/']) {
    await assert.rejects(guarded(endpoint), /本地模式/);
  }
  assert.equal(called, false);
  for (const endpoint of ['http://127.0.0.1:11434/v1', 'http://localhost:1234/v1', 'http://[::1]:11434/v1']) {
    assert.doesNotThrow(() => assertLocalUrl(endpoint));
  }
});

test('local model HTTP requests work and local-to-remote redirects fail closed', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'https://api.openai.com/v1/models' }); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'qwen3:4b' }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const localFetch = createLocalOnlyFetch(fetch);
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await localFetch(`${base}/v1/models`);
  assert.equal((await response.json()).data[0].id, 'qwen3:4b');
  await assert.rejects(localFetch(`${base}/redirect`, { redirect: 'follow' }));
});

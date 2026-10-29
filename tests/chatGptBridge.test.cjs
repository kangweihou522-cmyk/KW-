const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ChatGptBridge, bridgeConfig } = require('../electron/backend/chatGptBridge.cjs');

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-codex-protocol-'));
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', 0); };
  const sent = []; let thread = 0;
  const reply = value => child.stdout.write(JSON.stringify(value) + '\n');
  child.stdin = new Writable({ write(data, encoding, done) {
    const message = JSON.parse(data.toString()); sent.push(message);
    if (message.id && message.method) {
      let result = {};
      if (message.method === 'account/read') result = { account: { type: 'chatgpt', planType: 'plus', email: 'fictional@example.invalid' } };
      if (message.method === 'account/rateLimits/read') result = { ordinaryUsageAllowed: true, rateLimits: {} };
      if (message.method === 'thread/start') result = { thread: { id: `thread-${++thread}` } };
      if (message.method === 'turn/start') result = { turn: { id: `turn-${message.params.threadId}` } };
      if (message.method === 'account/login/start') result = { type: 'chatgpt', authUrl: 'https://auth.openai.com/oauth/authorize?fictional=1', loginId: 'fake' };
      reply({ id: message.id, result });
    }
    done();
  } });
  let launch;
  const bridge = new ChatGptBridge({ appPaths: { dataDir }, app: { isPackaged: false }, spawnProcess: (executable, args, options) => { launch = { executable, args, options }; return child; } });
  t.after(async () => { bridge.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await bridge.start();
  return { bridge, child, sent, reply, launch: () => launch };
}
const next = () => new Promise(resolve => setImmediate(resolve));
test('official browser sign-in opens only the trusted authorization page and isolates account storage', async t => {
  const f = await fixture(t); const opened = [];
  await f.bridge.login({ openExternal: url => opened.push(url) });
  assert.equal(new URL(opened[0]).hostname, 'auth.openai.com');
  assert(f.sent.some(message => message.method === 'account/login/start' && message.params.type === 'chatgpt'));
  const launch = f.launch(); assert(launch.options.windowsHide); assert(launch.options.env.CODEX_HOME.startsWith(launch.options.cwd.replace(/[/\\]work$/, '')));
  assert(!('OPENAI_API_KEY' in launch.options.env)); assert(launch.args.includes('features.shell_tool=false'));
});
test('concurrent text tasks route final output by thread and reject tool requests', async t => {
  const f = await fixture(t); const deltas = [];
  const first = f.bridge.complete('Fictional A', { onDelta: delta => deltas.push(delta) });
  const second = f.bridge.complete('Fictional B'); await next();
  assert.equal(f.sent.filter(message => message.method === 'initialize').length, 1);
  const threads = f.sent.filter(message => message.method === 'turn/start').map(message => message.params.threadId);
  assert.equal(threads.length, 2);
  f.reply({ id: 'tool-1', method: 'item/commandExecution/requestApproval', params: { threadId: threads[0] } });
  assert(f.sent.some(message => message.id === 'tool-1' && message.error?.code === -32601));
  f.reply({ method: 'item/agentMessage/delta', params: { threadId: threads[0], delta: '片段' } });
  for (const [id, text] of [[threads[1], 'Answer B'], [threads[0], 'Answer A']]) {
    f.reply({ method: 'item/completed', params: { threadId: id, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text } } });
    f.reply({ method: 'turn/completed', params: { threadId: id, turn: { status: 'completed' } } });
  }
  assert.equal(await first, 'Answer A'); assert.equal(await second, 'Answer B'); assert.deepEqual(deltas, ['片段']);
  assert.equal(bridgeConfig().sandbox_mode, 'read-only'); assert.equal(bridgeConfig().forced_login_method, 'chatgpt');
});
test('canceling a stale selection interrupts the official turn and cannot return its later answer', async t => {
  const f = await fixture(t); const controller = new AbortController();
  const pending = f.bridge.complete('Fictional stale selection', { signal: controller.signal }); const rejected = assert.rejects(pending, /取消/);
  await next(); controller.abort(); await rejected;
  assert(f.sent.some(message => message.method === 'turn/interrupt'));
  assert.equal(f.bridge.jobs.size, 0);
});
test('failed or quota-limited turns are errors instead of cached partial answers', async t => {
  const f = await fixture(t); const pending = f.bridge.complete('Fictional report'); const rejected = assert.rejects(pending, /额度/); await next();
  const threadId = f.sent.find(message => message.method === 'turn/start').params.threadId;
  f.reply({ method: 'item/completed', params: { threadId, item: { id: 'partial', type: 'agentMessage', text: 'Partial' } } });
  f.reply({ method: 'turn/completed', params: { threadId, turn: { status: 'failed', error: { message: '账户额度已用尽' } } } }); await rejected;
});

test('paid credit availability never substitutes for included account allowance', async t => {
  const f = await fixture(t); const originalRpc = f.bridge.rpc.bind(f.bridge);
  f.bridge.rpc = (method, params, timeout) => method === 'account/rateLimits/read'
    ? Promise.resolve({ ordinaryUsageAllowed: false, rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '100' } } })
    : originalRpc(method, params, timeout);
  await assert.rejects(f.bridge.complete('Fictional task'), /套餐内/);
  assert.equal(f.sent.some(message => message.method === 'turn/start'), false);
});

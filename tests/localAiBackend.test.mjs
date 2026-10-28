import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openAiChat, listOpenAiModels, embedTexts } = require('../electron/backend/utils.cjs');
const { localAiOptions, assertLocalAiUrl } = require('../electron/backend/localAi.cjs');
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const { splitReportContext, cachedReport } = require('../electron/backend/localReport.cjs');

async function server(t, callback) {
  const requests = [];
  const instance = http.createServer(async (req, res) => {
    let text = '';
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : null;
    requests.push({ path: req.url, body, headers: req.headers });
    if (callback) return callback(req, res, body, requests);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'qwen3:4b' }] }));
    else if (req.url === '/v1/embeddings') res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
    else res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: '本地译文' } }] }));
  });
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { instance.closeAllConnections(); instance.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${instance.address().port}/v1`, requests };
}

test('default local model is usable without ChatGPT or an API key; external endpoints rejected', () => {
  assert.equal(localAiOptions({}).baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(localAiOptions({}).model, 'qwen3:4b');
  assert.equal(localAiOptions({}).apiKey, '');
  assert.throws(() => localAiOptions({ model: 'gpt-oss:120b-cloud' }), /拒绝.*云端模型/);
  for (const value of ['https://api.openai.com/v1', 'https://localhost.attacker.test/v1', 'file:///etc/passwd', 'http://user:secret@localhost:1234/v1', 'http://localhost:1234/v1?forward=1']) {
    assert.throws(() => assertLocalAiUrl(value), /本机模型/);
  }
});

test('real loopback chat, embeddings and model listing use only the local daemon', async (t) => {
  const { baseUrl, requests } = await server(t);
  const result = await openAiChat({ baseUrl, model: 'qwen3:4b' }, [{ role: 'user', content: 'Translate control group.' }]);
  assert.equal(result.choices[0].message.content, '本地译文');
  const models = await listOpenAiModels({ baseUrl });
  assert.equal(models.models[0].id, 'qwen3:4b');
  assert.deepEqual(await embedTexts(['evidence'], { baseUrl, model: 'nomic-embed-text' }), [[1, 0, 0]]);
  assert.deepEqual(requests.map((r) => r.path), ['/v1/chat/completions', '/v1/models', '/v1/embeddings']);
});

test('local daemon redirects are refused instead of transmitting a paper elsewhere', async (t) => {
  const { baseUrl, requests } = await server(t, (_req, res) => {
    res.writeHead(302, { Location: 'https://api.openai.com/v1/chat/completions' });
    res.end();
  });
  await assert.rejects(openAiChat({ baseUrl }, [{ role: 'user', content: 'private paper' }]), /不会切换到云端付费接口/);
  assert.equal(requests.length, 1);
});

test('seven-section report survives local model response and is reused without another call', async (t) => {
  const { baseUrl, requests } = await server(t, (_req, res, body) => {
    assert.match(body.messages[0].content, /dataAnalysis/);
    assert.match(body.messages[0].content, /Never invent/);
    assert.match(body.messages[1].content, /PDF Page 2/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      title: 'Controlled trial', background: '临床问题 [PDF p. 2]', approach: '对照试验 [PDF p. 2]',
      dataAnalysis: '未报告统计检验', keyFindings: ['n=20 [PDF p. 2]'],
      discussion: '作者认为存在改善，但未证明因果', conclusions: '有待复核',
      evidenceEvaluation: '样本量有限', limitations: '未报告随机化',
    }) } }] }));
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-report-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const commands = createAiCommands({ appPaths: { dataDir: directory } });
  const options = { baseUrl, title: 'Trial', outputLanguage: 'Chinese', documentText: '# PDF Page 2\nA controlled trial with n=20.' };
  const [first, second] = await Promise.all([
    commands.summarize_document_openai_compatible({ options }),
    commands.summarize_document_openai_compatible({ options }),
  ]);
  assert.equal(first.dataAnalysis, '未报告统计检验');
  assert.equal(first.evidenceEvaluation, '样本量有限');
  assert.deepEqual(second, first);
  assert.deepEqual(await commands.summarize_document_openai_compatible({ options }), first);
  assert.equal(requests.length, 1);
  assert.ok((await fs.readdir(path.join(directory, '.reports'))).some((file) => file.endsWith('.json')));
});

test('failed in-flight report is released so the next explicit attempt can succeed', async () => {
  const identity = { text: 'unique concurrent failure test', model: 'qwen3:4b' };
  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) throw new Error('model unavailable');
    return { title: 'retry succeeded' };
  };
  const failed = await Promise.allSettled([
    cachedReport(null, identity, generate), cachedReport(null, identity, generate),
  ]);
  assert.deepEqual(failed.map((result) => result.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
  assert.deepEqual(await cachedReport(null, identity, generate), { title: 'retry succeeded' });
  assert.equal(calls, 2);
});

test('report refuses title-only input and refuses cloud base URLs before a request', async () => {
  const commands = createAiCommands({});
  await assert.rejects(commands.summarize_document_openai_compatible({ options: { title: 'Only title' } }), /没有可分析的原文/);
  await assert.rejects(commands.summarize_document_openai_compatible({ options: { baseUrl: 'https://api.openai.com/v1', documentText: 'some text' } }), /拒绝外部/);
});

test('long source is partitioned without losing final evidence or page context', () => {
  const source = '# Page 1\n' + 'Evidence '.repeat(2500) + '\n# Page 7\nEND EVIDENCE';
  const chunks = splitReportContext(source);
  assert.ok(chunks.length > 1);
  assert.match(chunks[1], /^# Page 1 \(continued excerpt/);
  assert.match(chunks.at(-1), /END EVIDENCE/);
});

test('long-report pipeline sends every excerpt and merges the final-page evidence, then reuses cache', async (t) => {
  const { baseUrl, requests } = await server(t, (_req, res, body) => {
    const payload = JSON.parse(body.messages[1].content);
    const tail = payload.text.includes('FINAL-PAGE-EVIDENCE');
    const report = {
      title: 'Long trial', background: 'Background [PDF p. 1]',
      keyFindings: tail ? ['FINAL-PAGE-EVIDENCE [PDF p. 8]'] : ['Early evidence [PDF p. 1]'],
      dataAnalysis: '原文未报告统计检验。',
      evidenceEvaluation: '仅评价所提供材料。',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }));
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-long-report-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const commands = createAiCommands({ appPaths: { dataDir: directory } });
  const options = { baseUrl, title: 'Long trial', documentText: '# Page 1\n' +
    'CONTROL '.repeat(3000) + '\n# Page 8\nFINAL-PAGE-EVIDENCE' };
  const result = await commands.summarize_document_openai_compatible({ options });
  assert.ok(requests.length > 1);
  assert.ok(requests.some((request) => JSON.parse(request.body.messages[1].content).stage.startsWith('merge level')));
  assert.match(result.keyFindings.join(' '), /FINAL-PAGE-EVIDENCE/);
  const firstCount = requests.length;
  assert.deepEqual(await commands.summarize_document_openai_compatible({ options }), result);
  assert.equal(requests.length, firstCount);
});

test('supplement CSV reaches the report with file/line source and XLSX exclusions remain visible even if model omits them', async (t) => {
  const { baseUrl, requests } = await server(t, (_req, res, body) => {
    const payload = JSON.parse(body.messages[1].content);
    assert.match(payload.text, /# Supplement: supporting.csv/);
    assert.match(payload.text, /L2: control,20|L2: control,21/);
    assert.match(payload.text, /未读取 XLSX/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      title: 'Trial with supplements', overview: 'Initial model overview', evidenceEvaluation: 'Initial appraisal',
    }) } }] }));
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-supplement-report-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const csv = path.join(directory, 'supporting.csv');
  await fs.writeFile(csv, 'group,n\ncontrol,20\n');
  const paper = { id: 'paper-test', attachments: [
    { kind: 'supplement', storedPath: csv, fileName: 'supporting.csv' },
    { kind: 'supplement', storedPath: path.join(directory, 'unparsed.xlsx'), fileName: 'unparsed.xlsx' },
  ] };
  const commands = createAiCommands({ appPaths: { dataDir: directory }, store: { load: () => ({ papers: [paper] }) } });
  const options = { baseUrl, paperId: paper.id, documentText: '# PDF Page 1\nMain study context.' };
  const report = await commands.summarize_document_openai_compatible({ options });
  assert.match(report.overview, /unparsed.xlsx：XLSX 工作表仅保管，未纳入分析/);
  assert.match(report.evidenceEvaluation, /分析范围说明/);
  const firstCount = requests.length;
  await commands.summarize_document_openai_compatible({ options });
  assert.equal(requests.length, firstCount, 'unchanged supplements reuse report cache');
  await fs.writeFile(csv, 'group,n\ncontrol,21\n');
  await commands.summarize_document_openai_compatible({ options });
  assert.ok(requests.length > firstCount, 'changed supporting data invalidates report cache');
  await assert.rejects(commands.summarize_document_openai_compatible({ options: { ...options, paperId: 'not-saved' } }), /归属/);
});

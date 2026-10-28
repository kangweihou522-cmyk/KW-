const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestOllamaReport, usesNativeOllama } = require('../electron/backend/ollamaReport.cjs');

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return `http://127.0.0.1:${instance.address().port}/v1`;
}

test('native local report disables thinking, preserves UTF-8 and bounds context/output', async t => {
  const baseUrl = await server(t, async (req,res) => {
    let source=''; for await (const part of req) source+=part;
    const body=JSON.parse(source);
    assert.equal(req.url,'/api/chat');assert.equal(body.think,false);
    assert.equal(body.options.num_ctx,8192);assert.equal(body.options.num_predict,2048);
    assert.equal(body.options.repeat_penalty,1.1);
    assert.equal(body.messages[0].content,'中文证据 /no_think');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({done:true,message:{content:'{"background":"对照组"}'}}));
  });
  assert.equal(await requestOllamaReport({baseUrl},[{role:'user',content:'中文证据 /no_think'}]),'{"background":"对照组"}');
  assert.equal(usesNativeOllama({baseUrl:'http://127.0.0.1:11434/v1'}),true);
  assert.equal(usesNativeOllama({baseUrl,apiMode:'responses'}),false);
});

test('repeat-loop error remains visible and no failed report is returned', async t => {
  const baseUrl=await server(t,(_,res)=>{res.writeHead(500);res.end('{"error":"prediction aborted, token repeat limit reached"}');});
  await assert.rejects(requestOllamaReport({baseUrl},[]),/重复生成.*token repeat limit/);
});

test('truncated native output is rejected instead of cached as a completed report', async t => {
  const baseUrl=await server(t,(_,res)=>res.end(JSON.stringify({done:true,done_reason:'length',message:{content:'{"background":"partial'}})));
  await assert.rejects(requestOllamaReport({baseUrl},[]),/长度上限/);
});

test('local report request timeout ends waiting with an actionable message', async t => {
  const baseUrl=await server(t,()=>{});
  await assert.rejects(requestOllamaReport({baseUrl},[],30),/超过 5 分钟/);
});

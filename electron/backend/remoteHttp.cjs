const https = require('node:https');

function request(url, { method = 'GET', headers = {}, body, signal, timeout = 120000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const address = new URL(url);
    if (address.protocol !== 'https:') return reject(new Error('远程服务必须使用 HTTPS。'));
    const req = https.request(address, { method, headers, signal, timeout, agent: new https.Agent({ proxyEnv: process.env }) }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); const error = new Error(`服务请求失败（HTTP ${res.statusCode}），未切换到收费接口。`); error.status = res.statusCode; reject(error); return;
      }
      // All callers use fixed official URLs; redirects never forward bearer credentials.
      res.pause();
      let received = 0;
      res.on('data', chunk => { received += chunk.length; if (received > maxBytes) res.destroy(new Error('服务响应超过大小限制。')); });
      res.on('error', reject);
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('服务连接超时，请重试。')));
    req.on('error', reject); req.end(body);
  });
}
async function jsonRequest(url, options) {
  const res = await request(url, options); const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('服务未返回有效 JSON。'); }
}
async function consumeSse(stream, onEvent) {
  const decoder = new TextDecoder(); let pending = '';
  async function lines() {
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') { let event; try { event = JSON.parse(data); } catch { throw new Error('模型流式响应格式无效。'); } await onEvent(event); }
    }
    if (pending.length > 4 * 1024 * 1024) throw new Error('模型响应事件过大。');
  }
  for await (const chunk of stream) { pending += decoder.decode(chunk, { stream: true }); pending = pending.replace(/\r\n/g, '\n'); await lines(); }
  pending += decoder.decode(); if (pending.trim()) { pending += '\n\n'; await lines(); }
}
module.exports = { request, jsonRequest, consumeSse };

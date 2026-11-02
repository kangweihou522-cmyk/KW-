const https = require('node:https');
const { StringDecoder } = require('node:string_decoder');

// Dedicated, fixed-host services stay separate from the local-only generic fetch.
// Never follow a redirect carrying an Authorization header.
function serviceRequest(input, { method = 'GET', headers = {}, body, signal, onEvent,
  timeout = 180000, maxBytes = 16 * 1024 * 1024, allowedHosts = [] } = {}) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || !allowedHosts.includes(url.hostname)) {
    throw new Error('服务地址不在已登记的 HTTPS 范围内。');
  }
  const bytes = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      error ? reject(error) : resolve(result);
    };
    const request = https.request(url, {
      method, signal, timeout, agent: new https.Agent({ proxyEnv: process.env }),
      headers: { 'User-Agent': 'PaperDesk', ...headers, ...(bytes ? { 'Content-Length': bytes.length } : {}) },
    }, response => {
      const status = response.statusCode;
      const streaming = status === 200 && onEvent && /text\/event-stream/i.test(response.headers['content-type'] || '');
      const chunks = []; const decoder = new StringDecoder('utf8');
      let size = 0; let pending = ''; let data = [];
      const line = value => {
        if (value === '') {
          if (!data.length) return;
          const payload = data.join('\n'); data = [];
          if (payload === '[DONE]') onEvent({ type: 'done' });
          else onEvent(JSON.parse(payload));
        } else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
      };
      const consume = text => {
        pending += text;
        for (;;) {
          const index = pending.indexOf('\n');
          if (index < 0) break;
          const value = pending.slice(0, index).replace(/\r$/, ''); pending = pending.slice(index + 1); line(value);
        }
      };
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) return request.destroy(new Error('服务响应超出本次容量限制。'));
        try { if (streaming) consume(decoder.write(chunk)); else chunks.push(chunk); }
        catch (error) { request.destroy(error); }
      });
      response.on('error', error => finish(error));
      response.on('end', () => {
        try {
          if (streaming) { consume(decoder.end()); if (pending) line(pending.replace(/\r$/, '')); line(''); }
          const text = streaming ? '' : Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* HTTP status remains diagnostic. */ }
          finish(null, { status, headers: response.headers, json, streaming });
        } catch (error) { finish(error); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('服务请求超时，已停止等待；本地内容不受影响。')), timeout);
    request.on('error', error => finish(error));
    request.on('timeout', () => request.destroy(new Error('服务连接超时。')));
    request.end(bytes);
  });
}
module.exports = { serviceRequest };

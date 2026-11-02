const https = require('node:https');
const HOSTS = new Set(['api.crossref.org', 'api.openalex.org']);
const PARTITION = 'paperdesk-bibliography-v1';
const configured = new WeakSet();

function metadataAddress(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !HOSTS.has(url.hostname)) throw new Error('书目信息来源异常。');
  return url;
}

/** Dedicated registry requests; PDFs and their text are never uploaded. */
function readMetadataJson(value, { timeout = 10000 } = {}) {
  const url = metadataAddress(value);
  return new Promise((resolve, reject) => {
    let request; let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => { finish(new Error(`书目信息查询超时（${url.hostname}），本地信息已保留。`)); request?.abort?.(); request?.destroy?.(); }, timeout);
    const failure = error => finish(new Error(`书目信息查询失败（${url.hostname}，${error.code || error.message?.match(/ERR_[A-Z0-9_]+/)?.[0] || '连接失败'}），本地信息已保留。`));
    const response = stream => {
      if (stream.statusCode !== 200) { stream.resume(); const error = new Error(`书目信息查询失败（${url.hostname}，HTTP ${stream.statusCode}）。`); error.status = stream.statusCode; finish(error); return; }
      const chunks = []; let size = 0;
      stream.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { finish(new Error('书目信息响应过大。')); stream.destroy(); } else chunks.push(chunk); });
      stream.on('error', failure);
      stream.on('end', () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('书目信息未返回有效 JSON。')); } });
    };
    try {
      const explicitProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
      if (process.versions.electron && !explicitProxy) {
        const electron = require('electron'); const session = electron.session.fromPartition(PARTITION, { cache: false });
        if (!configured.has(session)) {
          session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => { try { metadataAddress(details.url); callback({ cancel: details.method !== 'GET' }); } catch { callback({ cancel: true }); } });
          session.setPermissionRequestHandler((contents, permission, callback) => callback(false)); configured.add(session);
        }
        request = electron.net.request({ session, url: String(url), method: 'GET', redirect: 'error', credentials: 'omit', useSessionCookies: false });
        request.setHeader('User-Agent', 'PaperDesk/0.6.2 (local literature manager)');
        request.on('response', response); request.on('error', failure); request.end();
      } else {
        request = https.get(url, { agent: new https.Agent({ proxyEnv: process.env }), headers: { 'User-Agent': 'PaperDesk/0.6.2 (local literature manager)' } }, response);
        request.on('error', failure);
      }
    } catch (error) { failure(error); }
  });
}
module.exports = { readMetadataJson, metadataAddress, PARTITION };

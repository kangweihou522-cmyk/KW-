const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { createHash } = require('node:crypto');
function allowed(host) { return ['github.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co'].includes(host) || host.endsWith('.hf.co') || host.endsWith('.xethub.hf.co') || host.endsWith('.huggingface.co'); }
async function downloadResource(url, file, { sha256, bytes, onProgress, signal, maxBytes = 3 * 1024 ** 3 } = {}, redirects = 0) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || !allowed(address.hostname) || redirects > 8) throw new Error('组件下载地址无效。');
  const response = await new Promise((resolve, reject) => {
    const req = https.get(address, { signal, timeout: 60000, agent: new https.Agent({ proxyEnv: process.env }), headers: { 'User-Agent': 'PaperDesk' } }, resolve);
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('组件下载超时，请重试。')));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) { response.resume(); if (!response.headers.location) throw new Error('下载重定向无效。'); return downloadResource(new URL(response.headers.location, address), file, { sha256, bytes, onProgress, signal, maxBytes }, redirects + 1); }
  if (response.statusCode !== 200) { response.resume(); throw new Error(`组件下载失败（HTTP ${response.statusCode}），原有翻译组件保留。`); }
  const digest = createHash('sha256'); let received = 0; let last = 0;
  const meter = new Transform({ transform(chunk, encoding, callback) {
    received += chunk.length;
    if (received > maxBytes || bytes && received > bytes) return callback(new Error('组件下载大小异常。'));
    digest.update(chunk); if (Date.now() - last > 250) { onProgress?.({ received, total: bytes || Number(response.headers['content-length']) || 0, stage: 'download' }); last = Date.now(); } callback(null, chunk);
  } });
  try {
    await pipeline(response, meter, fs.createWriteStream(file, { flags: 'wx' }), { signal });
    if (bytes && received !== bytes || sha256 && digest.digest('hex') !== sha256) throw new Error('组件大小或 SHA256 校验失败，未替换现有组件。');
    return { bytes: received };
  } catch (error) { await fsp.rm(file, { force: true }); throw error; }
}
async function hashFile(file) { const digest = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
module.exports = { downloadResource, hashFile };

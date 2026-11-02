const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const ASSET_HOSTS = ['github.com', 'release-assets.githubusercontent.com', 'github-cloud.s3.amazonaws.com', 'huggingface.co', '*.hf.co'];
function assetUrl(input, hosts = ASSET_HOSTS) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || !hosts.some(host => host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host)) throw new Error('组件下载地址不在登记范围内。');
  return url;
}
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function trustedArtifact(item) { return item && /^[a-f0-9]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes < 2 * 1024 ** 3; }
function openAsset(input, { signal, hosts }, redirects = 0) {
  if (redirects > 6) throw new Error('组件下载重定向过多。');
  const url = assetUrl(input, hosts);
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal, timeout: 60000, agent: new https.Agent({ proxyEnv: process.env }), headers: { 'User-Agent': 'PaperDesk-verified-components' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        try { if (!response.headers.location) throw new Error('组件重定向地址缺失。'); resolve(openAsset(new URL(response.headers.location, url), { signal, hosts }, redirects + 1)); }
        catch (error) { reject(error); }
      } else if (response.statusCode === 200) resolve(response);
      else { response.resume(); reject(new Error(`组件下载失败（HTTP ${response.statusCode}），原有组件已保留。`)); }
    });
    request.on('timeout', () => request.destroy(new Error('组件下载连接超时。'))); request.on('error', reject);
  });
}
async function downloadVerified(item, destination, { signal, onProgress, hosts = ASSET_HOSTS } = {}) {
  if (!trustedArtifact(item)) throw new Error('该组件尚未完成可信大小和 SHA256 登记，已停止下载。');
  try { if ((await fsp.stat(destination)).size === item.bytes && await fileHash(destination) === item.sha256) return destination; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.partial`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30 * 60000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let bytes = 0; const hash = createHash('sha256'); let lastProgress = 0;
  try {
    const response = await openAsset(item.url || item.downloadUrl, { signal: combinedSignal, hosts });
    const meter = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > item.bytes) return callback(new Error('组件大小超出已登记范围。'));
      hash.update(chunk);
      if (Date.now() - lastProgress > 200) { lastProgress = Date.now(); onProgress?.({ received: bytes, total: item.bytes, stage: 'download' }); }
      callback(null, chunk);
    } });
    await pipeline(response, meter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: combinedSignal });
    if (bytes !== item.bytes || hash.digest('hex') !== item.sha256) throw new Error('组件 SHA256 或大小校验失败，原有文件已保留。');
    await fsp.rename(temporary, destination); return destination;
  } finally { clearTimeout(timer); await fsp.rm(temporary, { force: true }); }
}
module.exports = { assetUrl, fileHash, trustedArtifact, downloadVerified };

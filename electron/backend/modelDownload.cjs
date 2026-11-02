const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { hashFile } = require('./resourceDownload.cjs');

function trustedAddress(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || !(['huggingface.co', 'cdn-lfs.huggingface.co'].includes(host) || host.endsWith('.hf.co') || host.endsWith('.huggingface.co'))) throw new Error('模型下载地址不属于官方 HTTPS 来源。');
  return url;
}

async function openModelResponse(url, { headers, signal }) {
  // Electron's network stack follows the Windows system/PAC proxy. Node is retained
  // for command-line validation, where the managed environment supplies proxyEnv.
  const explicitProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (process.versions.electron && !explicitProxy) {
    return new Promise((resolve, reject) => {
      const request = require('electron').net.request({ url: String(url), method: 'GET', redirect: 'manual', useSessionCookies: false });
      let body;
      const abort = () => { request.abort(); body?.destroy(signal.reason); reject(signal.reason); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      request.on('redirect', (statusCode, method, location) => {
        cleanup(); resolve({ statusCode, headers: { location }, stream: Readable.from([]) }); request.abort();
      });
      request.on('response', response => {
        body = response;
        response.once('end', cleanup); response.once('close', cleanup); response.once('error', cleanup);
        resolve({ statusCode: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])), stream: response });
      });
      request.on('error', error => { cleanup(); body?.destroy(error); reject(error); });
      for (const [key, value] of Object.entries(headers)) request.setHeader(key, value);
      if (signal.aborted) abort(); else request.end();
    });
  }
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, signal, agent: new https.Agent({ proxyEnv: process.env }) }, response => resolve({ statusCode: response.statusCode, headers: response.headers, stream: response }));
    request.on('error', reject);
  });
}

function downloadError(message, code, retryable = false) { const error = new Error(message); error.code = code; error.retryable = retryable; return error; }
async function size(file) { return (await fsp.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.size || 0; }

/** Resume only immutable, hash-pinned weights. Never enable an incomplete file. */
async function downloadModelResource(url, file, { sha256, bytes, onProgress, signal, attempts = 3, idleTimeout = 60000, openResponse = openModelResponse, retryDelay = 500 } = {}) {
  const original = trustedAddress(url);
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 3 * 1024 ** 3) throw new Error('模型下载缺少可信的大小或 SHA256。');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let timer;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(downloadError('模型下载连接超时', 'ETIMEDOUT', true)), idleTimeout); };
    let host = original.hostname;
    try {
      let received = await size(file);
      if (received > bytes) { await fsp.rm(file); received = 0; }
      if (received < bytes) {
        let address = original;
        let response;
        touch();
        onProgress?.({ stage: 'connect', received, total: bytes, attempt, message: `正在连接官方模型来源（${address.hostname}）` });
        for (let redirects = 0; ; redirects++) {
          host = address.hostname;
          response = await openResponse(address, { signal: controller.signal, headers: { 'User-Agent': 'PaperDesk', 'Accept-Encoding': 'identity', ...(received ? { Range: `bytes=${received}-` } : {}) } });
          if (![301, 302, 303, 307, 308].includes(response.statusCode)) break;
          response.stream.destroy();
          if (!response.headers.location || redirects >= 8) throw downloadError('模型下载重定向无效', 'REDIRECT_INVALID');
          address = trustedAddress(new URL(response.headers.location, address));
        }
        if (![200, 206].includes(response.statusCode)) {
          response.stream.destroy();
          throw downloadError(`模型下载服务返回 HTTP ${response.statusCode}`, `HTTP_${response.statusCode}`, response.statusCode === 429 || response.statusCode >= 500);
        }
        if (response.statusCode === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
          if (!range || Number(range[1]) !== received || Number(range[2]) !== bytes - 1 || Number(range[3]) !== bytes) { response.stream.destroy(); throw downloadError('模型续传范围与官方文件不一致', 'RANGE_INVALID'); }
        } else received = 0; // Server ignored Range: safely start a new file, never append a full response.
        const declared = response.headers['content-length'];
        if (declared !== undefined && Number(declared) !== bytes - received) { response.stream.destroy(); throw downloadError(`模型响应大小异常（${declared} 字节，预期 ${bytes - received} 字节）`, 'SIZE_INVALID'); }
        let last = 0;
        onProgress?.({ stage: 'download', received, total: bytes, attempt, message: received ? '继续下载已保存的部分' : '已连接官方模型下载地址' });
        const meter = new Transform({ transform(chunk, encoding, done) {
          touch(); received += chunk.length;
          if (received > bytes) return done(downloadError('模型文件超过官方登记大小', 'SIZE_INVALID'));
          if (Date.now() - last > 250) { last = Date.now(); onProgress?.({ stage: 'download', received, total: bytes, attempt }); }
          done(null, chunk);
        } });
        await pipeline(response.stream, meter, fs.createWriteStream(file, { flags: received ? 'a' : 'w' }), { signal: controller.signal });
      }
      clearTimeout(timer);
      if (await size(file) !== bytes) throw downloadError('模型下载未完成', 'DOWNLOAD_INCOMPLETE', true);
      onProgress?.({ stage: 'verify', received: bytes, total: bytes, message: '正在校验完整模型 SHA256' });
      if (await hashFile(file) !== sha256) { await fsp.rm(file, { force: true }); throw downloadError('模型 SHA256 校验不一致，已移除损坏的临时文件', 'HASH_MISMATCH', true); }
      return { bytes };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      lastError = controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
      const stored = await size(file);
      if (['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'ENOTDIR'].includes(lastError.code)) throw downloadError(`无法写入模型文件（${lastError.code}）。请检查模型所在磁盘的剩余空间和文件夹权限，已有文件仍保留。`, lastError.code);
      if (lastError.retryable === false || attempt === attempts) {
        const code = String(lastError.code || lastError.cause?.code || lastError.message?.match(/ERR_[A-Z0-9_]+/)?.[0] || 'CONNECTION_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 60);
        throw downloadError(`模型下载未完成（${host}，${code}）。已保留 ${Math.floor(stored / 1048576)} / ${Math.ceil(bytes / 1048576)} MB，下次点击继续下载。${['HASH_MISMATCH', 'SIZE_INVALID', 'RANGE_INVALID'].includes(code) ? ` ${lastError.message}` : ''}`, code);
      }
      onProgress?.({ stage: 'retry', received: stored, total: bytes, attempt, message: '连接中断，保留进度并自动重试' });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
  }
  throw lastError;
}

module.exports = { downloadModelResource, openModelResponse, trustedAddress };

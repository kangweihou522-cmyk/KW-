const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { jsonRequest, consumeSse } = require('./remoteHttp.cjs');
const { downloadResource, hashFile } = require('./resourceDownload.cjs');
const lock = require('../../packaging/quality-translation-lock.json');
function chunkText(text, limit = 1600) {
  const chunks = []; let remaining = text.replace(/(\w)-\r?\n(?=\w)/g, '$1').replace(/([^\n])\r?\n(?=[^\n])/g, '$1 ');
  while (remaining.length > limit) { let end = remaining.lastIndexOf(' ', limit); if (end < limit / 2) end = limit; chunks.push(remaining.slice(0, end)); remaining = remaining.slice(end); }
  if (remaining.trim()) chunks.push(remaining); return chunks;
}
function translationPrompt(text, { source = 'English', target = 'Chinese', terms = [], context = '' } = {}) {
  const glossary = terms.filter(t => text.toLowerCase().includes(t.source.toLowerCase())).map(t => `${t.source} → ${t.target}`).join('\n');
  return `${context ? `Context (do not translate):\n${context}\n` : ''}${glossary ? `Terminology:\n${glossary}\n` : ''}Translate the following segment from ${source === 'auto' ? 'its original language' : source} into ${target}, without any explanation. Keep numbers, units, formulas, citations and negation unchanged.\n\n${text}`;
}
function localRequest(port, token, route, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET', signal, timeout: 180000, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`离线推理失败（HTTP ${res.statusCode}）。`)); } else resolve(res);
    }); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('离线推理超时。'))); req.end(body ? JSON.stringify(body) : undefined);
  });
}
class QualityTranslation {
  constructor(context) {
    this.lock = context.qualityLock || lock; this.context = context; this.json = context.qualityJson || jsonRequest; this.download = context.qualityDownload || downloadResource;
    this.modelDir = path.join(context.appPaths.homeDir || context.appPaths.dataDir, 'models', 'translation', 'hy-mt2-1.8b-q4');
    this.modelFile = path.join(this.modelDir, 'model.gguf'); this.child = null; this.starting = null; this.installing = null; this.queue = Promise.resolve(); this.backend = null;
    this.runtimeDir = context.qualityRuntimeDir || (context.app?.isPackaged ? path.join(process.resourcesPath, 'quality-translation') : path.resolve(__dirname, '../../release/quality-translation'));
  }
  executable(backend) { return path.join(this.runtimeDir, backend, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'); }
  async manifest() { try { return JSON.parse(await fs.readFile(path.join(this.modelDir, 'paperdesk-model.json'), 'utf8')); } catch { return null; } }
  async status() {
    const manifest = await this.manifest(); const stat = await fs.stat(this.modelFile).catch(() => null);
    const pinned = !this.lock.model || manifest?.sha256 === this.lock.model.sha256 && manifest?.revision === this.lock.model.revision;
    const runtimeAvailable = !!await fs.stat(this.executable('cpu')).catch(() => null);
    return { ready: pinned && !!manifest && stat?.size === manifest.bytes && runtimeAvailable, installed: pinned && !!manifest && stat?.size === manifest.bytes, runtimeAvailable, name: 'Hy-MT2-1.8B · Q4_K_M', backend: this.backend, bytes: stat?.size || 0, experimental: true };
  }
  async resolveModel() {
    if (this.lock.model) {
      const model = this.lock.model;
      return { ...model, url: `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.name}` };
    }
    const base = `https://huggingface.co/api/models/${this.lock.modelRepository}`;
    const model = await this.json(`${base}?blobs=true`);
    if (!/^[a-f0-9]{40}$/.test(model.sha)) throw new Error('官方模型版本信息无效。');
    let files = model.siblings || [];
    if (!files.some(f => f.lfs)) files = await this.json(`${base}/tree/${model.sha}?recursive=true`);
    const file = files.find(f => /q4_k_m.*\.gguf$/i.test(f.rfilename || f.path || ''));
    const sha256 = file?.lfs?.sha256 || file?.lfs?.oid; const bytes = file?.lfs?.size || file?.size;
    const name = file?.rfilename || file?.path;
    if (!name || name.includes('..') || !/^[a-f0-9]{64}$/.test(sha256) || !(bytes > 100000000 && bytes < 3 * 1024 ** 3)) throw new Error('官方Q4_K_M模型文件或校验值未找到，未下载其他模型。');
    return { repository: this.lock.modelRepository, revision: model.sha, name, sha256, bytes, url: `https://huggingface.co/${this.lock.modelRepository}/resolve/${model.sha}/${name.split('/').map(encodeURIComponent).join('/')}` };
  }
  async install(onProgress) {
    if (this.installing) return this.installing;
    this.installing = (async () => {
      if ((await this.status()).ready) return this.status();
      if (!(await this.status()).runtimeAvailable) throw new Error('高质量翻译运行组件缺失，请安装完整更新包。');
      const model = await this.resolveModel(); await fs.mkdir(this.modelDir, { recursive: true });
      const temp = path.join(this.modelDir, `download-${randomUUID()}.tmp`);
      try { await this.download(model.url, temp, { ...model, onProgress });
        const handle = await fs.open(temp, 'r'); const magic = Buffer.alloc(4); try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
        if ((await fs.stat(temp)).size !== model.bytes || await hashFile(temp) !== model.sha256) throw new Error('模型 SHA256 或文件大小校验失败，未启用损坏模型。');
        if (magic.toString() !== 'GGUF') throw new Error('下载文件不是GGUF模型。');
        this.close(); await fs.rename(temp, this.modelFile);
        await fs.copyFile(path.resolve(__dirname, '../../scripts/translation/LICENSE-HY-MT2'), path.join(this.modelDir, 'LICENSE-HY-MT2'));
        await fs.writeFile(path.join(this.modelDir, 'paperdesk-model.json'), JSON.stringify(model));
        onProgress?.({ received: model.bytes, total: model.bytes, stage: 'ready' }); return this.status();
      } finally { await fs.rm(temp, { force: true }); }
    })().finally(() => { this.installing = null; }); return this.installing;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const manifest = await this.manifest();
      if (!(await this.status()).ready || await hashFile(this.modelFile) !== manifest.sha256) throw new Error('高质量翻译包尚未安装或校验失败，请重新下载。');
      for (const backend of process.platform === 'win32' ? ['vulkan', 'cpu'] : ['cpu']) {
        if (!await fs.stat(this.executable(backend)).catch(() => null)) continue;
        try { await this.launch(backend); this.backend = backend; return; } catch { this.child?.kill(); this.child = null; }
      }
      throw new Error('高质量翻译组件启动失败，当前模型可能需要更新的运行内核。可切回快速离线翻译。');
    })().catch(error => { this.starting = null; throw error; }); return this.starting;
  }
  async launch(backend) {
    const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve));
    const token = randomBytes(32).toString('hex');
    const child = spawn(this.executable(backend), ['--model', this.modelFile, '--host', '127.0.0.1', '--port', String(port), '--api-key', token, '--ctx-size', '8192', '--parallel', '1', '--n-gpu-layers', backend === 'cpu' ? '0' : '99', '--offline', '--no-webui'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child; let exited = false; child.stderr.on('data', () => {}); child.on('error', () => { exited = true; }); child.on('exit', () => { exited = true; if (this.child === child) { this.child = null; this.starting = null; } });
    const deadline = Date.now() + 120000;
    while (!exited && Date.now() < deadline && this.child === child) {
      try { const response = await localRequest(port, token, '/health', null, AbortSignal.timeout(1000)); response.resume(); this.port = port; this.token = token; return; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    child.kill(); throw new Error('离线推理组件未就绪。');
  }
  translate(text, options = {}) {
    const task = this.queue.catch(() => {}).then(async () => {
      if (options.signal?.aborted) throw new Error('请求已取消。'); await this.start();
      const result = [];
      for (const chunk of chunkText(text)) {
        if (options.signal?.aborted) throw new Error('请求已取消。');
        const response = await localRequest(this.port, this.token, '/v1/chat/completions', { messages: [{ role: 'user', content: translationPrompt(chunk, options) }], temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05, max_tokens: 4096, stream: true }, options.signal);
        let output = ''; let finished = false;
        await consumeSse(response, event => {
          if (event.error) throw new Error('离线模型翻译失败。');
          const choice = event.choices?.[0]; if (choice?.delta?.content) output += choice.delta.content;
          if (choice?.finish_reason) { if (choice.finish_reason !== 'stop') throw new Error('译文达到长度限制，未缓存截断内容。请缩短划选。'); finished = true; }
        });
        if (!finished || !output.trim()) throw new Error('离线模型未返回完整译文。');
        if (result.length) options.onDelta?.('\n\n'); result.push(output.trim()); options.onDelta?.(output.trim());
      }
      return result.join('\n\n');
    }); this.queue = task; return task;
  }
  close() { this.child?.kill(); this.child = null; this.starting = null; this.backend = null; }
}
function createQualityTranslationCommands(context) {
  const engine = context.qualityTranslation;
  return { quality_translation_status: () => engine.status(), quality_translation_install: (args, event) => engine.install(progress => { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('paperquay:event', 'paperdesk:quality-translation-install-progress', progress); }) };
}
module.exports = { QualityTranslation, createQualityTranslationCommands, translationPrompt, chunkText };

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { jsonRequest, consumeSse } = require('./remoteHttp.cjs');
const { hashFile } = require('./resourceDownload.cjs');
const { downloadModelResource } = require('./modelDownload.cjs');
const lock = require('../../packaging/quality-translation-lock.json');
const { InferenceQueue } = require('./inferenceQueue.cjs');
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
      if (res.statusCode !== 200) { res.resume(); const error = new Error(`离线推理失败（HTTP ${res.statusCode}）。`); error.status = res.statusCode; reject(error); } else resolve(res);
    }); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('离线推理超时。'))); req.end(body ? JSON.stringify(body) : undefined);
  });
}
class QualityTranslation {
  constructor(context) {
    this.lock = context.qualityLock || lock; this.context = context; this.json = context.qualityJson || jsonRequest; this.download = context.qualityDownload || downloadModelResource;
    this.modelDir = path.join(context.appPaths.modelsDir || path.join(context.appPaths.homeDir || path.dirname(context.appPaths.dataDir), 'models'), 'translation', 'hy-mt2-1.8b-q4');
    this.modelFile = path.join(this.modelDir, 'model.gguf'); this.child = null; this.starting = null; this.installing = null; this.scheduler = new InferenceQueue(); this.backend = null; this.failure = ''; this.failurePhase = ''; this.failureCode = ''; this.progress = null; this.verified = null; this.installController = null;
    this.runtimeDir = context.qualityRuntimeDir || (context.app?.isPackaged ? path.join(process.resourcesPath, 'quality-translation') : path.resolve(__dirname, '../../release/quality-translation'));
  }
  executable(backend) { return path.join(this.runtimeDir, backend, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'); }
  async manifest() { try { return JSON.parse(await fs.readFile(path.join(this.modelDir, 'paperdesk-model.json'), 'utf8')); } catch { return null; } }
  progressUpdate(value, listener) { this.progress = value; listener?.(value); }
  fail(error, phase) { this.failure = error.message || String(error); this.failureCode = error.code || 'UNKNOWN'; this.failurePhase = phase; }
  clearFailure() { this.failure = ''; this.failureCode = ''; this.failurePhase = ''; }
  problem(message, code) { const error = new Error(message); error.code = code; return error; }
  partialFile(model = this.lock.model) { return path.join(this.modelDir, `download-${model.sha256}.part`); }
  async status() {
    const manifest = await this.manifest(); const stat = await fs.stat(this.modelFile).catch(() => null);
    const model = this.lock.model;
    const pinned = !model || manifest?.sha256 === model.sha256 && manifest?.revision === model.revision && manifest?.bytes === model.bytes;
    const runtimeAvailable = !!await fs.stat(this.executable('cpu')).catch(() => null);
    const installed = pinned && !!manifest && stat?.size === manifest.bytes;
    const partial = model ? await fs.stat(this.partialFile(model)).catch(() => null) : null;
    return { error: this.failure, errorCode: this.failureCode, errorPhase: this.failurePhase,
      ready: !this.installing && installed && runtimeAvailable && this.failurePhase !== 'runtime' && this.failureCode !== 'MODEL_HASH_MISMATCH',
      installed, installing: !!this.installing, progress: this.progress, runtimeAvailable,
      modelDir: this.modelDir, modelFile: this.modelFile, bytes: stat?.size || 0,
      expectedBytes: model?.bytes || manifest?.bytes || 0, packageBytes: model?.bytes || manifest?.bytes || null,
      partialBytes: partial?.size || 0, recoverable: !!model && stat?.size === model.bytes,
      name: 'Hy-MT2-1.8B · Q4_K_M', backend: this.backend, experimental: true };
  }
  async verifyFile(file, model) {
    const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) throw this.problem(`尚未下载高质量模型。请在翻译设置中点击“下载并启用”。保存位置：${this.modelDir}`, 'MODEL_MISSING');
    if (stat.size !== model.bytes) throw this.problem(`高质量模型未下载完整（${stat.size} / ${model.bytes} 字节）。点击“检查并修复”继续下载。`, 'MODEL_SIZE_MISMATCH');
    const fingerprint = `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${model.sha256}`;
    if (this.verified === fingerprint) return;
    const handle = await fs.open(file, 'r'); const magic = Buffer.alloc(4);
    try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
    if (magic.toString() !== 'GGUF' || await hashFile(file) !== model.sha256) throw this.problem('高质量模型 SHA256 校验不一致，尚未启用。点击“检查并修复”重新下载损坏模型。', 'MODEL_HASH_MISMATCH');
    this.verified = fingerprint;
  }
  async writeRegistration(model) {
    // readFile works inside app.asar; model files remain outside the application.
    const license = await fs.readFile(path.resolve(__dirname, '../../scripts/translation/LICENSE-HY-MT2'));
    for (const [name, content] of [['LICENSE-HY-MT2', license], ['paperdesk-model.json', JSON.stringify(model)]]) {
      const file = path.join(this.modelDir, name); const temp = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
    }
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
  async install(onProgress, force = false) {
    if (this.installing) return this.installing;
    this.installController = new AbortController();
    const notify = value => this.progressUpdate(value, onProgress);
    const task = (async () => {
      let phase = 'check';
      try {
        this.clearFailure(); if (force) this.verified = null;
        if (!(await this.status()).runtimeAvailable) throw this.problem('高质量翻译运行组件缺失。请使用桌面 PaperDesk - Update 更新程序，模型文件会保留。', 'RUNTIME_MISSING');
        const model = await this.resolveModel(); await fs.mkdir(this.modelDir, { recursive: true });
        notify({ stage: 'verify', received: 0, total: model.bytes, message: '正在检查已有模型，完整文件会直接复用' });
        let existing = false;
        try { await this.verifyFile(this.modelFile, model); existing = true; }
        catch (error) { if (!['MODEL_MISSING', 'MODEL_SIZE_MISMATCH', 'MODEL_HASH_MISMATCH'].includes(error.code)) throw error; }
        if (!existing) {
          phase = 'download'; const temp = this.partialFile(model);
          // Recover interrupted older installs without discarding their download progress.
          if (!await fs.stat(temp).catch(() => null)) {
            const candidates = await fs.readdir(this.modelDir);
            for (const name of ['model.gguf', ...candidates.filter(name => /^download-[a-f0-9-]+\.tmp$/.test(name))]) {
              const candidate = path.join(this.modelDir, name); const stat = await fs.stat(candidate).catch(() => null);
              if (stat?.size > 0 && (stat.size < model.bytes || name !== 'model.gguf' && stat.size === model.bytes)) { await fs.copyFile(candidate, temp); break; }
            }
          }
          await this.download(model.url, temp, { ...model, signal: this.installController.signal, onProgress: notify });
          await this.verifyFile(temp, model); this.installController.signal.throwIfAborted();
          await this.stopRuntime(); await fs.rename(temp, this.modelFile); this.verified = null;
        }
        phase = 'register'; this.installController.signal.throwIfAborted();
        await this.writeRegistration(model);
        phase = 'runtime'; notify({ stage: 'start', received: model.bytes, total: model.bytes, message: '模型校验通过，正在启动本机翻译组件' });
        await this.start(true);
        notify({ stage: 'ready', received: model.bytes, total: model.bytes, message: existing ? '已复用完整模型并启用' : '模型下载、校验和启动均已完成' });
      } catch (error) { this.fail(error, phase); notify({ stage: 'error', message: error.message, received: this.progress?.received || 0, total: this.progress?.total || 0 }); throw error; }
    })();
    this.installing = task.then(async () => { this.installing = null; this.installController = null; return this.status(); }, error => { this.installing = null; this.installController = null; throw error; });
    return this.installing;
  }
  async start(duringInstall = false) {
    if (this.installing && !duringInstall) await this.installing;
    if (this.starting) return this.starting;
    const task = (async () => {
      const model = await this.resolveModel();
      if (!(await this.status()).runtimeAvailable) throw this.problem('高质量翻译运行组件缺失。请通过 PaperDesk - Update 更新，已有模型无需删除。', 'RUNTIME_MISSING');
      await this.verifyFile(this.modelFile, model);
      const manifest = await this.manifest();
      if (manifest?.sha256 !== model.sha256 || manifest?.revision !== model.revision || manifest?.bytes !== model.bytes) await this.writeRegistration(model);
      const failures = [];
      for (const backend of process.platform === 'win32' ? ['vulkan', 'cpu'] : ['cpu']) {
        if (!await fs.stat(this.executable(backend)).catch(() => null)) continue;
        try { await this.launch(backend); this.backend = backend; this.clearFailure(); return; }
        catch (error) { failures.push(`${backend}: ${error.message}`); await this.stopRuntime(false); }
      }
      throw this.problem(`模型已通过校验，但本机运行组件启动失败。无需重新下载模型，可点击“检查并修复”重试。${failures.join('；')}`, 'RUNTIME_START_FAILED');
    })();
    this.starting = task.catch(error => { this.fail(error, error.code?.startsWith('MODEL_') ? 'check' : 'runtime'); this.starting = null; throw error; });
    return this.starting;
  }
  async stopRuntime(reset = true) {
    const child = this.child; this.child = null; this.backend = null;
    if (reset) this.starting = null;
    if (!child || child.exitCode !== null && child.exitCode !== undefined) return;
    await new Promise(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill(); });
  }
  async launch(backend) {
    const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve));
    const token = randomBytes(32).toString('hex');
    const child = spawn(this.executable(backend), ['--model', this.modelFile, '--host', '127.0.0.1', '--port', String(port), '--api-key', token, '--ctx-size', '8192', '--parallel', '1', '--n-gpu-layers', backend === 'cpu' ? '0' : '99', '--offline', '--no-webui'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child; let exited = false; let exitReason = ''; let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1500); }); child.on('error', error => { exited = true; exitReason = error.code || 'SPAWN_ERROR'; }); child.on('exit', code => { exited = true; exitReason ||= `exit ${code}`; if (this.child === child) { this.child = null; if (this.backend) { this.starting = null; this.backend = null; } } });
    const deadline = Date.now() + 120000;
    while (!exited && Date.now() < deadline && this.child === child) {
      try { const response = await localRequest(port, token, '/health', null, AbortSignal.timeout(1000)); response.resume(); this.port = port; this.token = token; return; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    child.kill(); throw new Error(`离线推理组件未就绪（${exitReason || '启动超时'}）。${stderr.split(token).join('[已隐藏]').trim()}`);
  }
  async translate(text, options = {}) {
    const result = [];
    for (const chunk of chunkText(text, 1000)) {
      const output = await this.scheduler.run(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          options.signal?.throwIfAborted(); await this.start();
          try {
            const response = await localRequest(this.port, this.token, '/v1/chat/completions', { messages: [{ role: 'user', content: translationPrompt(chunk, options) }], temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05, max_tokens: 4096, stream: true }, options.signal);
            let output = ''; let finished = false;
            if (result.length && !attempt) options.onDelta?.('\n\n');
            await consumeSse(response, event => {
              if (event.error) throw new Error('离线模型翻译失败。');
              const choice = event.choices?.[0]; if (choice?.delta?.content) { output += choice.delta.content; options.onDelta?.(choice.delta.content); }
              if (choice?.finish_reason) { if (choice.finish_reason !== 'stop') throw new Error('译文达到长度限制，未缓存截断内容。请缩短划选。'); finished = true; }
            });
            if (!finished) throw Object.assign(new Error('本机翻译连接提前结束。'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
            if (!output.trim()) throw new Error('离线模型未返回完整译文。');
            return output;
          } catch (error) {
            options.signal?.throwIfAborted();
            const recoverable = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code) || error.status === 503 || /socket hang up|premature close/i.test(error.message);
            if (!recoverable) throw error;
            if (attempt) throw this.problem('本机翻译连接中断，自动恢复后仍未完成。请点击“立即翻译”重试，或“检查并修复高质量翻译”；已有模型和缓存会保留。', 'INFERENCE_CONNECTION_LOST');
            options.onReset?.(result.join('\n\n') + (result.length ? '\n\n' : ''));
            await this.stopRuntime(); options.signal?.throwIfAborted();
          }
        }
      }, options);
      result.push(output);
    }
    return result.join('\n\n');
  }
  pauseInstall() {
    if (!this.installing || !['connect', 'download', 'retry'].includes(this.progress?.stage)) return { paused: false };
    this.installController?.abort(this.problem('模型下载已暂停，进度已保留。下次点击继续下载。', 'DOWNLOAD_PAUSED'));
    return { paused: true };
  }
  close() { this.installController?.abort(new Error('模型下载已暂停，进度已保留。')); this.child?.kill(); this.child = null; this.starting = null; this.backend = null; }
}
function createQualityTranslationCommands(context) {
  const engine = context.qualityTranslation;
  return { quality_translation_status: () => engine.status(), quality_translation_pause: () => engine.pauseInstall(), quality_translation_install: (args, event) => engine.install(progress => { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('paperquay:event', 'paperdesk:quality-translation-install-progress', progress); }, args?.force === true) };
}
module.exports = { QualityTranslation, createQualityTranslationCommands, translationPrompt, chunkText };

const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const AdmZip = require('adm-zip');
const componentLock = require('../../packaging/offline-translation-lock.json');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'github-cloud.s3.amazonaws.com']);
function downloadLanguagePackage(url, { signal, expectedBytes, onProgress }, redirects = 0) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || !DOWNLOAD_HOSTS.has(address.hostname) || redirects > 5) throw new Error('离线语言包下载地址异常。');
  return new Promise((resolve, reject) => {
    const request = https.get(address, { signal, timeout: 30000, agent: new https.Agent({ proxyEnv: process.env }), headers: { 'User-Agent': 'PaperDesk-offline-translation' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) { reject(new Error('语言包下载重定向无效。')); return; }
        try { resolve(downloadLanguagePackage(new URL(response.headers.location, address), { signal, expectedBytes, onProgress }, redirects + 1)); } catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`语言包下载失败（HTTP ${response.statusCode}）。可稍后重试，未切换在线翻译。`)); return; }
      const chunks = []; let bytes = 0; let lastProgress = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > expectedBytes || bytes > 300 * 1024 * 1024) { request.destroy(new Error('语言包大小超出已登记范围。')); return; }
        chunks.push(chunk);
        if (Date.now() - lastProgress > 200) { lastProgress = Date.now(); onProgress?.({ received: bytes, total: expectedBytes, stage: 'download' }); }
      });
      response.on('end', () => { if (bytes !== expectedBytes) reject(new Error('语言包下载不完整，请重试。')); else resolve(Buffer.concat(chunks)); });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('语言包下载超时，请检查网络后重试。')));
    request.on('error', reject);
  });
}

function packageEntries(bytes) {
  const seen = new Set(); let expanded = 0;
  const entries = new AdmZip(bytes).getEntries();
  if (entries.length > 20000) throw new Error('语言包包含过多文件。');
  for (const entry of entries) {
    const name = entry.entryName;
    if (!name || /^[\/\\]|[\\:\x00]/.test(name) || name.split('/').some((part, index, parts) => !part && index !== parts.length - 1 || part === '..' || part === '.' || /[. ]$/.test(part))) throw new Error('语言包包含不安全的文件路径。');
    if (seen.has(name.toLowerCase())) throw new Error('语言包包含重复的文件路径。');
    seen.add(name.toLowerCase()); expanded += entry.header.size;
    if (expanded > 700 * 1024 * 1024 || ((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error('语言包大小或文件类型异常。');
  }
  const metadata = entries.filter(entry => !entry.isDirectory && /(^|\/)metadata\.json$/.test(entry.entryName));
  if (metadata.length !== 1) throw new Error('语言包元数据缺失或不唯一。');
  const prefix = metadata[0].entryName.slice(0, -'metadata.json'.length);
  const info = JSON.parse(metadata[0].getData().toString('utf8'));
  if (info.from_code !== 'en' || info.to_code !== 'zh') throw new Error('当前语言包仅支持英语翻译为中文。');
  const selected = entries.filter(entry => !entry.isDirectory && entry.entryName.startsWith(prefix)).map(entry => ({ entry, name: entry.entryName.slice(prefix.length) })).filter(({ name }) => name === 'metadata.json' || name === 'sentencepiece.model' || name.startsWith('model/') || /^(license|licence|readme)/i.test(name));
  for (const required of ['metadata.json', 'sentencepiece.model', 'model/model.bin', 'model/config.json']) if (!selected.some(item => item.name === required)) throw new Error(`语言包缺少必要组件：${required}`);
  return selected;
}

class OfflineTranslation {
  constructor({ app, appPaths, spawnProcess = spawn, downloadPackage = downloadLanguagePackage, lock = componentLock, pythonPath, workerPath }) {
    this.appPaths = appPaths; this.app = app; this.spawnProcess = spawnProcess; this.downloadPackage = downloadPackage; this.lock = lock;
    this.modelDir = path.join(appPaths.modelsDir || path.join(appPaths.homeDir || path.dirname(appPaths.dataDir), 'models'), 'translation', lock.model.id);
    const runtime = app?.isPackaged ? path.join(process.resourcesPath, 'offline-translation') : path.resolve(__dirname, '../../scripts/translation');
    this.python = pythonPath || (app?.isPackaged && process.platform === 'win32' ? path.join(runtime, 'python', 'python.exe') : process.env.PAPERDESK_TRANSLATION_PYTHON || path.resolve(__dirname, '../../.cache/offline-translation-venv/bin/python'));
    this.script = workerPath || path.join(runtime, 'worker.py'); this.child = null; this.starting = null; this.pending = new Map(); this.failure = ''; this.installing = null;
  }
  async installed() {
    try {
      const marker = JSON.parse(await fs.readFile(path.join(this.modelDir, 'paperdesk-model.json'), 'utf8'));
      if (!this.lock.model.sha256 || marker.sha256 !== this.lock.model.sha256 || marker.id !== this.lock.model.id || !Array.isArray(marker.files)) return false;
      for (const file of ['metadata.json', 'sentencepiece.model', 'model/model.bin', 'model/config.json']) {
        const registered = marker.files.find(item => item.name === file);
        if (!registered || (await fs.stat(path.join(this.modelDir, file))).size !== registered.bytes) return false;
      }
      return true;
    } catch { return false; }
  }
  async status() {
    const installed = await this.installed();
    const runtimeAvailable = !!(await fs.stat(this.python).catch(() => null)) && !!(await fs.stat(this.script).catch(() => null));
    return { installed, runtimeAvailable, ready: installed && runtimeAvailable && !this.failure, installing: !!this.installing, model: this.lock.model.id, packageBytes: this.lock.model.bytes, error: this.failure, from: 'English', to: 'Chinese' };
  }
  async install(onProgress) {
    if (this.installing) return this.installing;
    if (!/^[a-f0-9]{64}$/.test(this.lock.model.sha256) || !Number.isSafeInteger(this.lock.model.bytes) || this.lock.model.bytes <= 0) throw new Error('语言包的可信校验信息尚未发布，已停止下载。');
    this.installController = new AbortController();
    this.installing = (async () => {
      if (await this.installed() && !this.failure) return this.status();
      const bytes = await this.downloadPackage(this.lock.model.downloadUrl, { signal: this.installController.signal, expectedBytes: this.lock.model.bytes, onProgress });
      if (sha256(bytes) !== this.lock.model.sha256 || bytes.length !== this.lock.model.bytes) throw new Error('语言包 SHA256 校验失败，原有文件已保留。');
      const entries = packageEntries(bytes);
      const parent = path.dirname(this.modelDir); await fs.mkdir(parent, { recursive: true });
      const staging = path.join(parent, `.install-${randomUUID()}`); const backup = path.join(parent, `.previous-${randomUUID()}`); let moved = false;
      await fs.mkdir(staging);
      try {
        onProgress?.({ received: bytes.length, total: bytes.length, stage: 'install' });
        const files = [];
        for (const { name, entry } of entries) {
          const data = entry.getData(); const file = path.join(staging, name);
          await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data);
          files.push({ name, bytes: data.length, sha256: sha256(data) });
        }
        await fs.writeFile(path.join(staging, 'paperdesk-model.json'), JSON.stringify({ format: 1, id: this.lock.model.id, sha256: this.lock.model.sha256, files }));
        this.stop();
        if (await fs.stat(this.modelDir).catch(() => null)) { await fs.rename(this.modelDir, backup); moved = true; }
        try { await fs.rename(staging, this.modelDir); } catch (error) { if (moved) await fs.rename(backup, this.modelDir); moved = false; throw error; }
        if (moved) await fs.rm(backup, { recursive: true, force: true });
        this.failure = '';
        onProgress?.({ received: bytes.length, total: bytes.length, stage: 'ready' });
        return this.status();
      } finally { await fs.rm(staging, { recursive: true, force: true }); }
    })().finally(() => { this.installing = null; this.installController = null; });
    return this.installing;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.launch().catch(error => { this.failure = error.message; this.stop(error); throw error; });
    return this.starting;
  }
  async launch() {
    const status = await this.status();
    if (!status.runtimeAvailable) throw new Error('离线翻译组件缺失，请使用完整 Windows 更新包；不需要安装 Ollama。');
    if (!status.installed) throw new Error('请先在右侧翻译栏下载一次英中语言包。');
    const marker = JSON.parse(await fs.readFile(path.join(this.modelDir, 'paperdesk-model.json'), 'utf8'));
    for (const item of marker.files) {
      if (/^[\/\\]|[\\:\x00]/.test(item.name) || item.name.split('/').some(part => part === '..' || part === '.')) throw new Error('语言包登记路径无效，请重新安装语言包。');
      if (sha256(await fs.readFile(path.join(this.modelDir, item.name))) !== item.sha256) throw new Error('语言包文件损坏，请重新安装语言包。');
    }
    const child = this.spawnProcess(this.python, ['-I', '-B', '-u', this.script, '--model-dir', this.modelDir], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('离线翻译组件初始化超时。')); }, 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      child.on('error', () => { const error = new Error('离线翻译进程无法启动。'); fail(error); if (this.child === child) this.stop(error); });
      child.on('exit', () => { const error = new Error('离线翻译进程已退出，请重试。'); fail(error); if (this.child === child) this.stop(error); });
      child.stderr.on('data', () => {});
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (line.length > 2_000_000) { fail(new Error('离线翻译响应过大。')); return; }
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.type === 'ready') { clearTimeout(timer); this.failure = ''; resolve(); return; }
        if (message.type === 'startup-error') { fail(new Error(`离线翻译组件初始化失败：${String(message.error || '请检查完整运行包和语言包。').slice(0, 500)}`)); return; }
        const job = this.pending.get(message.id); if (!job) return;
        if (message.type === 'delta') job.onDelta?.(message.delta || '');
        if (message.type === 'done') job.finish(message.translation?.trim() ? null : new Error('离线翻译未返回译文。'), message.translation);
        if (message.type === 'error' || message.type === 'canceled') job.finish(new Error(message.type === 'canceled' ? '请求已取消。' : '离线翻译失败，请缩短选区后重试。'));
      });
    });
  }
  send(message) { if (!this.child?.stdin?.writable) throw new Error('离线翻译进程未就绪。'); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  async translate(text, { source = 'English', target = 'Chinese', signal, onDelta } = {}) {
    if (!['English', 'en', 'auto'].includes(source) || !['Chinese', 'zh', 'zh-CN'].includes(target)) throw new Error('当前离线语言包仅支持英语 → 中文，请调整翻译语言。');
    if (typeof text !== 'string' || !text.trim() || text.length > 40000) throw new Error('请选择 1–40000 字的英文片段。');
    if (signal?.aborted) throw new Error('请求已取消。');
    await this.start();
    if (signal?.aborted) throw new Error('请求已取消。');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { if (!this.pending.has(id)) return; this.pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
      const cancel = () => { try { this.send({ type: 'cancel', id }); } catch {} finish(new Error('请求已取消。')); };
      const timer = setTimeout(cancel, 120000);
      this.pending.set(id, { finish, onDelta }); signal?.addEventListener('abort', cancel, { once: true });
      try { this.send({ type: 'translate', id, text }); } catch (error) { finish(error); }
    });
  }
  stop(error = new Error('离线翻译已关闭。')) {
    const child = this.child; this.child = null; this.starting = null;
    for (const job of [...this.pending.values()]) job.finish(error);
    if (child && !child.killed) child.kill();
  }
  close() { this.installController?.abort(); this.stop(); }
}

function createOfflineTranslationCommands(context) {
  const engine = context.offlineTranslation;
  return {
    offline_translation_status() { return engine.status(); },
    offline_translation_install(args, event) { return engine.install(progress => { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('paperquay:event', 'paperdesk:offline-translation-install-progress', progress); }); },
  };
}
module.exports = { OfflineTranslation, createOfflineTranslationCommands, packageEntries, downloadLanguagePackage };

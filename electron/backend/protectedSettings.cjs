const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
class ProtectedSettings {
  constructor(context, name) { this.file = path.join(context.appPaths.dataDir, '.settings', name); this.storage = context.safeStorage; this.queue = Promise.resolve(); }
  secure() {
    const storage = this.storage || require('electron').safeStorage;
    if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全存储不可用，不会将凭据保存为明文。');
    return storage;
  }
  async read(fallback = {}) {
    try { return JSON.parse(this.secure().decryptString(await fs.readFile(this.file))); }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
  }
  update(change, fallback = {}) {
    const task = this.queue.then(async () => {
      const current = await this.read(fallback); const result = await change(current);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, this.secure().encryptString(JSON.stringify(current)), { mode: 0o600 }); await fs.rename(temp, this.file); }
      finally { await fs.rm(temp, { force: true }); }
      return result;
    }); this.queue = task.catch(() => {}); return task;
  }
}
module.exports = { ProtectedSettings };

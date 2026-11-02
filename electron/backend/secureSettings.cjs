const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

class SecureSettings {
  constructor(context, name) {
    this.context = context;
    this.file = path.join(context.appPaths.dataDir, '.settings', `${name}.encrypted`);
  }
  storage() {
    const storage = this.context.safeStorage || require('electron').safeStorage;
    if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('系统安全存储不可用，未读取或保存明文凭据。Windows 请使用完整桌面程序。');
    }
    return storage;
  }
  async read() {
    const bytes = await fs.readFile(this.file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    return bytes ? JSON.parse(this.storage().decryptString(bytes)) : null;
  }
  async write(value) {
    const bytes = this.storage().encryptString(JSON.stringify(value));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async remove() { await fs.rm(this.file, { force: true }); }
}
module.exports = { SecureSettings, atomicJson };

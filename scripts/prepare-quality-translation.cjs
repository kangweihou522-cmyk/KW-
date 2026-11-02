const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const tar = require('tar');
const lock = require('../packaging/quality-translation-lock.json');
const { downloadVerified, fileHash, trustedArtifact } = require('../electron/backend/verifiedDownload.cjs');
const root = path.resolve(__dirname, '..');

function safeName(name) {
  const value = name.replace(/^\.\//, '');
  if (/^[\/\\]|[\\:\x00]/.test(value) || value.split('/').some(part => part === '..' || part === '.')) throw new Error('运行包包含不安全的路径。');
  return value;
}
async function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(directory, name));
    else if (entry.isFile()) result.push({ name, sha256: await fileHash(path.join(directory, name)) });
  }
  return result;
}
async function prepareQualityRuntime(platform = process.platform, arch = process.arch, { stage = false } = {}) {
  const artifact = lock.runtime[`${platform}-${arch}`];
  if (!artifact) throw new Error('高质量翻译运行包暂不支持当前平台。');
  const cache = path.join(root, '.cache', 'quality-translation', artifact.name);
  await downloadVerified(artifact, cache);
  const output = path.join(root, 'release', `quality-translation-${platform}-${arch}`);
  let valid = false;
  try {
    const stamp = JSON.parse(await fs.readFile(path.join(output, 'components.json'), 'utf8'));
    valid = stamp.sha256 === artifact.sha256;
    if (valid) for (const file of stamp.files) if (await fileHash(path.join(output, safeName(file.name))) !== file.sha256) { valid = false; break; }
  } catch { valid = false; }
  if (!valid) {
    const temporary = `${output}.${crypto.randomUUID()}.install`; await fs.mkdir(temporary, { recursive: true });
    try {
      if (artifact.name.endsWith('.zip')) {
        const names = new Set();
        for (const entry of new AdmZip(cache).getEntries()) {
          const name = safeName(entry.entryName);
          if (entry.isDirectory()) continue;
          if (((entry.header.attr >>> 16) & 0xf000) === 0xa000 || names.has(name.toLowerCase())) throw new Error('运行包包含重复路径或链接。');
          names.add(name.toLowerCase()); const file = path.join(temporary, name);
          await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, entry.getData());
        }
      } else {
        await tar.x({ file: cache, cwd: temporary, filter(name, entry) {
          safeName(name);
          if (entry.linkpath) {
            const target = path.resolve(temporary, path.dirname(name), entry.linkpath);
            if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error('运行包链接超出组件目录。');
          }
          return true;
        } });
      }
      const files = await filesIn(temporary);
      const executable = files.find(file => path.basename(file.name) === (platform === 'win32' ? 'llama-server.exe' : 'llama-server'));
      if (!executable) throw new Error('官方运行包中没有翻译服务组件。');
      if (platform !== 'win32') await fs.chmod(path.join(temporary, executable.name), 0o755);
      const manifest = { format: 1, platform, arch, version: lock.version, sha256: artifact.sha256, executable: executable.name, files };
      await fs.copyFile(path.join(root, 'packaging', 'QUALITY_TRANSLATION_NOTICE.txt'), path.join(temporary, 'NOTICE.txt'));
      await fs.writeFile(path.join(temporary, 'components.json'), JSON.stringify(manifest));
      await fs.rm(output, { recursive: true, force: true }); await fs.rename(temporary, output);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }
  if (stage) { const target = path.join(root, 'release', 'quality-translation'); await fs.rm(target, { recursive: true, force: true }); await fs.cp(output, target, { recursive: true }); }
  return output;
}
async function prepareQualityAsset() {
  if (!trustedArtifact(lock.model) || !lock.model.upstreamUrl || !lock.model.revision) throw new Error('高质量语言包未完成来源、版本与 SHA256 验证，禁止发布。');
  const destination = path.join(root, 'release', 'downloads', lock.model.name);
  await downloadVerified({ ...lock.model, url: lock.model.upstreamUrl }, destination);
  return destination;
}
module.exports = { prepareQualityRuntime, prepareQualityAsset, safeName, filesIn };
if (require.main === module) (process.argv.includes('--model-asset') ? prepareQualityAsset() : prepareQualityRuntime(process.argv[2], process.argv[3], { stage: process.argv.includes('--stage') }))
  .then(directory => console.log(`Verified quality translation component: ${directory}`)).catch(error => { console.error(error.message); process.exitCode = 1; });

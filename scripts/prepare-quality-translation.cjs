const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { downloadResource, hashFile } = require('../electron/backend/resourceDownload.cjs');
const lock = require('../packaging/quality-translation-lock.json');
async function prepareQualityRuntime(platform = process.platform, arch = process.arch) {
  if (arch !== 'x64' || !['win32', 'linux'].includes(platform)) throw new Error('高质量翻译组件目前支持 Windows/Linux x64。');
  const target = path.resolve(__dirname, '../release/quality-translation');
  const cache = path.resolve(__dirname, '../.cache/quality-translation'); await fs.mkdir(cache, { recursive: true });
  for (const backend of platform === 'win32' ? ['cpu', 'vulkan'] : ['cpu']) {
    const asset = lock.runtimes[`${platform}-${arch}-${backend}`]; const archive = path.join(cache, asset.name);
    if (await hashFile(archive).catch(() => '') !== asset.sha256) { await fs.rm(archive, { force: true }); await downloadResource(asset.url, archive, asset); }
    const directory = path.join(target, backend); await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(directory, { recursive: true });
    if (asset.name.endsWith('.zip')) {
      const zip = new AdmZip(archive);
      for (const entry of zip.getEntries()) { if (entry.entryName.includes('..') || /^[\/\\]|[\\:]/.test(entry.entryName)) throw new Error('组件压缩包路径无效。'); }
      zip.extractAllTo(directory, true);
    } else execFileSync('tar', ['-xf', archive, '-C', directory, '--strip-components=1']);
    await fs.writeFile(path.join(directory, 'paperdesk-runtime.json'), JSON.stringify({ version: lock.runtimeVersion, sha256: asset.sha256, backend }));
  }
  return target;
}
module.exports = { prepareQualityRuntime };
if (require.main === module) prepareQualityRuntime(process.argv[2], process.argv[3]).then(p => console.log(`Quality translation runtime prepared: ${p}`)).catch(e => { console.error(e.message); process.exitCode = 1; });

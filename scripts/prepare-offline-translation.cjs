// Fixed Windows CPU runtime; artifacts are checked before any extraction.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const lock = require('../packaging/offline-translation-lock.json');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'offline-translation');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function artifact(item) {
  if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error(`Missing trusted SHA256 for ${item.name}`);
  await fs.mkdir(cache, { recursive: true });
  const file = path.join(cache, item.name);
  const existing = await fs.readFile(file).catch(() => null);
  if (existing && digest(existing) === item.sha256) return existing;
  const url = new URL(item.url || item.upstreamUrl);
  if (url.protocol !== 'https:' || !['api.nuget.org', 'files.pythonhosted.org', 'argos-net.com'].includes(url.hostname)) throw new Error('Unexpected offline component source');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Official component download failed: ${response.status} (${item.name})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== item.sha256 || item.bytes && bytes.length !== item.bytes) throw new Error(`Offline component integrity mismatch: ${item.name}`);
  await fs.writeFile(file, bytes);
  return bytes;
}

async function extract(bytes, output, prefix = '') {
  for (const entry of new AdmZip(bytes).getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const relative = entry.entryName.slice(prefix.length);
    if (!relative || /[\\:\x00]/.test(relative) || relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe component archive path');
    const file = path.join(output, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, entry.getData());
  }
}

async function fingerprints(directory, relative = '') {
  const result = [];
  for (const item of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, item.name);
    if (item.isDirectory()) result.push(...await fingerprints(directory, name));
    else if (item.isFile()) result.push({ name, sha256: digest(await fs.readFile(path.join(directory, name))) });
    else throw new Error('Unexpected non-file entry in the offline runtime');
  }
  return result;
}

async function prepareOfflineRuntime(platform = process.platform, arch = process.arch) {
  const output = path.join(root, 'release', 'offline-translation');
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(path.join(root, 'scripts', 'translation', 'worker.py'), path.join(output, 'worker.py'));
  await fs.copyFile(path.join(root, 'scripts', 'translation', 'scientific_terms.json'), path.join(output, 'scientific_terms.json'));
  await fs.copyFile(path.join(root, 'scripts', 'translation', 'requirements.txt'), path.join(output, 'requirements.txt'));
  await fs.copyFile(path.join(root, 'packaging', 'offline-translation-lock.json'), path.join(output, 'components.json'));
  await fs.copyFile(path.join(root, 'packaging', 'OFFLINE_TRANSLATION_NOTICE.txt'), path.join(output, 'NOTICE.txt'));
  await fs.copyFile(path.join(root, 'packaging', 'MODEL-EN-ZH-NOTICE.txt'), path.join(output, 'MODEL-LICENSE.txt'));
  if (platform !== 'win32') {
    // Developer/Linux builds use an explicitly configured Python virtualenv.
    return output;
  }
  if (arch !== 'x64') throw new Error('Offline Windows translation currently supports x64 only');
  const python = path.join(output, 'python');
  const stamp = digest(Buffer.from(JSON.stringify(['app-local-msvc-v1', lock.python, lock.wheels])));
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(output, 'runtime.json'), 'utf8')); } catch {}
  let verified = false;
  if (manifest?.stamp === stamp && Array.isArray(manifest.files)) {
    try { verified = JSON.stringify(await fingerprints(python)) === JSON.stringify(manifest.files); } catch {}
  }
  if (!verified) {
    await fs.rm(python, { recursive: true, force: true });
    await extract(await artifact(lock.python), python, 'tools/');
    for (const wheel of lock.wheels) await extract(await artifact(wheel), path.join(python, 'Lib', 'site-packages'));
    // The verified NumPy Windows wheel already redistributes this Microsoft
    // runtime. CTranslate2/SentencePiece import its original DLL name, so keep
    // an app-local copy instead of depending on a system-wide VC++ install.
    const numpyDlls = path.join(python, 'Lib', 'site-packages', 'numpy.libs');
    const msvcp = (await fs.readdir(numpyDlls)).filter(name => /^msvcp140-[a-z0-9]+\.dll$/i.test(name));
    if (msvcp.length !== 1) throw new Error('Pinned NumPy wheel does not contain the expected Microsoft runtime');
    await fs.copyFile(path.join(numpyDlls, msvcp[0]), path.join(python, 'MSVCP140.dll'));
    await fs.writeFile(path.join(output, 'runtime.json'), JSON.stringify({ format: 1, target: 'win32-x64', python: lock.python.version, stamp, files: await fingerprints(python) }, null, 2));
  }
  return output;
}

async function prepareLanguageAsset() {
  const bytes = await artifact(lock.model);
  const output = path.join(root, 'release', 'downloads'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, lock.model.name), bytes);
  return path.join(output, lock.model.name);
}
module.exports = { prepareOfflineRuntime, prepareLanguageAsset };
if (require.main === module) (process.argv.includes('--language-asset') ? prepareLanguageAsset() : prepareOfflineRuntime(process.argv[2], process.argv[3])).then(dir => console.log(`Verified offline translation component: ${dir}`)).catch(error => { console.error(error.message); process.exitCode = 1; });

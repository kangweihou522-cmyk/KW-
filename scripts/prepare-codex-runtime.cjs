// Cross-package only the requested official Codex binary, checked against npm lock integrity.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const tar = require('tar');
async function prepareCodexRuntime(platform = process.platform, arch = process.arch) {
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Codex runtime target');
  const root = path.resolve(__dirname, '..');
  const key = `node_modules/@openai/codex-${platform}-${arch}`;
  const lock = require('../package-lock.json').packages[key];
  if (!lock?.resolved || !lock.integrity?.startsWith('sha512-')) throw new Error('Codex target is not pinned in package-lock.json');
  const triple = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'win32' ? 'pc-windows-msvc' : platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
  const filename = platform === 'win32' ? 'codex.exe' : 'codex';
  const output = path.join(root, 'release', 'codex-runtime'); await fs.mkdir(output, { recursive: true });
  const marker = path.join(output, 'codex-runtime.json');
  try { const existing = JSON.parse(await fs.readFile(marker, 'utf8')); const data = await fs.readFile(path.join(output, filename)); if (await fs.stat(path.join(output, 'LICENSE-Codex.txt')).catch(() => null) && existing.integrity === lock.integrity && existing.target === triple && existing.binarySha256 === crypto.createHash('sha256').update(data).digest('hex')) return output; } catch {}
  const url = new URL(lock.resolved);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected Codex package source');
  const response = await fetch(url); if (!response.ok) throw new Error(`Official Codex download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`;
  if (actual !== lock.integrity) throw new Error('Codex package integrity mismatch; refusing to use the artifact');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-codex-package-'));
  try {
    const archive = path.join(temporary, 'package.tgz'); await fs.writeFile(archive, data);
    const binaryEntry = `package/vendor/${triple}/bin/${filename}`;
    await tar.x({ file: archive, cwd: temporary, filter: (name, entry) => name === binaryEntry && entry.type === 'File' });
    const binary = path.join(temporary, binaryEntry); const bytes = await fs.readFile(binary);
    await fs.copyFile(binary, path.join(output, filename)); if (platform !== 'win32') await fs.chmod(path.join(output, filename), 0o755);
    await fs.writeFile(marker, JSON.stringify({ version: require('../package.json').devDependencies['@openai/codex'], target: triple, integrity: lock.integrity, binarySha256: crypto.createHash('sha256').update(bytes).digest('hex'), source: url.href }, null, 2));
    // Keep the bundled component's license with the runtime.
    const license = path.join(root, 'packaging', 'CODEX-LICENSE.txt');
    await fs.copyFile(license, path.join(output, 'LICENSE-Codex.txt'));
    await fs.copyFile(path.join(root, 'packaging', 'CODEX-NOTICE.txt'), path.join(output, 'NOTICE-Codex.txt'));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return output;
}
module.exports = { prepareCodexRuntime };
if (require.main === module) prepareCodexRuntime(process.argv[2] || process.platform, process.argv[3] || process.arch).then(dir => console.log(`Verified official Codex runtime: ${dir}`)).catch(error => { console.error(error.message); process.exitCode = 1; });

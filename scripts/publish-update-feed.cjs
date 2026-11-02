// Publish a small, public HTTPS update manifest only after all release assets are ready.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const REPO = 'kangweihou522-cmyk/KW-';
const BRANCH = 'paperdesk-updates';
function buildManifest(release, sums) {
  const match = /^paperdesk-v(\d+\.\d+\.\d+)$/.exec(release.tag_name || '');
  if (!match || release.draft || release.prerelease) throw new Error('Only stable PaperDesk releases may enter the update feed.');
  const version = match[1]; const name = `PaperDesk-${version}-Windows.zip`;
  const assets = release.assets.filter(a => a.name === name);
  if (assets.length !== 1) throw new Error('Windows release asset must be unique.');
  const asset = assets[0]; const url = `https://github.com/${REPO}/releases/download/${release.tag_name}/${name}`;
  if (asset.state !== 'uploaded' || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 ** 31) throw new Error('Windows release asset is incomplete or from a different source.');
  const rows = String(sums).trim().split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line)).filter(row => row?.[2] === name);
  if (rows.length !== 1 || asset.digest !== `sha256:${rows[0][1].toLowerCase()}`) throw new Error('Release checksum and GitHub asset digest do not match.');
  return { schema: 1, product: 'PaperDesk', repository: REPO, version, tag: release.tag_name, publishedAt: release.published_at, asset: { name, url, bytes: asset.size, sha256: rows[0][1].toLowerCase() } };
}
function gh(args, options = {}) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
function api(route) { return JSON.parse(gh(['api', route])); }
function writeApi(route, method, body, directory) {
  const file = path.join(directory, 'request.json'); fs.writeFileSync(file, JSON.stringify(body));
  return JSON.parse(gh(['api', '--method', method, route, '--input', file]));
}
function newerVersion(left, right) {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i=0;i<3;i++) { if(a[i]!==b[i]) return a[i]>b[i]; } return false;
}
function publish(tag = `paperdesk-v${require('../package.json').version}`) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperdesk-update-feed-'));
  try {
    const release = api(`repos/${REPO}/releases/tags/${tag}`);
    gh(['release', 'download', tag, '--repo', REPO, '--pattern', 'SHA256SUMS.txt', '--dir', directory]);
    const manifest = buildManifest(release, fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8'));
    let ref;
    try { ref = api(`repos/${REPO}/git/ref/heads/${BRANCH}`); }
    catch (error) { if (!String(error.stderr).includes('404')) throw error; }
    if (!ref) {
      const sha = api(`repos/${REPO}/git/ref/heads/main`).object.sha;
      writeApi(`repos/${REPO}/git/refs`, 'POST', { ref: `refs/heads/${BRANCH}`, sha }, directory);
    }
    let existing;
    try { existing = api(`repos/${REPO}/contents/windows.json?ref=${BRANCH}`); }
    catch (error) { if (!String(error.stderr).includes('404')) throw error; }
    if (existing) {
      const current = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));
      if (newerVersion(current.version, manifest.version)) { console.log('Existing update feed is newer; no downgrade published.'); return; }
      if (current.version === manifest.version && current.asset.sha256 === manifest.asset.sha256) { console.log('Update feed already matches the verified release.'); return; }
    }
    writeApi(`repos/${REPO}/contents/windows.json`, 'PUT', { branch: BRANCH, message: `Publish verified PaperDesk ${manifest.version} Windows update feed`, content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n').toString('base64'), ...(existing ? { sha: existing.sha } : {}) }, directory);
    console.log(`Published verified PaperDesk ${manifest.version} update feed at https://raw.githubusercontent.com/${REPO}/${BRANCH}/windows.json`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { buildManifest, newerVersion, publish };
if (require.main === module) { try { publish(process.argv[2]); } catch(error) { console.error(error.message); if(error.stderr)console.error(String(error.stderr)); process.exitCode = 1; } }

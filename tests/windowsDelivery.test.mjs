import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolvePaperDeskHome } = require('../electron/backend/paperdeskPaths.cjs');
const { createAppPaths } = require('../electron/backend/libraryStore.cjs');
const { createUpdateCommands, getAutoUpdateSupport } = require('../electron/backend/updateCommands.cjs');
const app = { getPath: () => '/tmp/fake-user-data', isPackaged: true, getVersion: () => '0.2.0' };

test('Windows storage explicitly chooses D drive, and missing D never silently selects C', () => {
  assert.equal(resolvePaperDeskHome(app, { platform: 'win32', env: {}, exists: () => true }), 'D:\\PaperDesk');
  assert.throws(() => resolvePaperDeskHome(app, { platform: 'win32', env: {}, exists: () => false }), /PAPERDESK_HOME/);
  assert.equal(resolvePaperDeskHome(app, { platform: 'win32', env: { PAPERDESK_HOME: 'E:\\My Papers' }, exists: () => false }), 'E:\\My Papers');
  assert.throws(() => resolvePaperDeskHome(app, { platform: 'win32', env: { PAPERDESK_HOME: '.\\relative' } }), /absolute/);
});

test('application data and library do not live inside the replaced application directory', () => {
  const previous = process.env.PAPERDESK_HOME;
  process.env.PAPERDESK_HOME = '/tmp/paperdesk-delivery';
  try {
    const paths = createAppPaths(app);
    assert.equal(paths.homeDir, '/tmp/paperdesk-delivery');
    assert.equal(paths.dataDir, '/tmp/paperdesk-delivery/data');
    assert.equal(paths.libraryDatabasePath, '/tmp/paperdesk-delivery/data/paperquay-library.sqlite');
    assert.equal(paths.configPath.startsWith('/tmp/paperdesk-delivery/app/'), false);
  } finally {
    if (previous === undefined) delete process.env.PAPERDESK_HOME;
    else process.env.PAPERDESK_HOME = previous;
  }
});

test('fork update check performs no network call and refuses automatic installation', async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
  try {
    const commands = createUpdateCommands({ app });
    const result = await commands.app_update_check();
    assert.equal(requests, 0);
    assert.equal(result.canInstall, false);
    assert.equal(result.canDownload, false);
    assert.equal(result.latestVersion, '');
    assert.equal(result.autoUpdateUnsupportedReason, 'paperdesk-local-update');
    assert.equal(result.releaseUrl, 'https://github.com/kangweihou522-cmyk/KW-/releases');
    await assert.rejects(commands.app_update_download(), /PaperDesk/);
    assert.throws(() => commands.app_update_install(), /PaperDesk/);
    assert.deepEqual(getAutoUpdateSupport(app), { supported: false, reason: 'paperdesk-local-update' });
  } finally { globalThis.fetch = previous; }
});

test('Windows distribution has no upstream publication target and retains user data', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'paperdesk');
  assert.equal(pkg.build.productName, 'PaperDesk');
  assert.equal(pkg.build.publish, null);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.ok(pkg.build.extraResources.some((resource) => resource.from === 'scripts/ocr' && resource.to === 'ocr'),
    'Python OCR code must be outside app.asar so the system interpreter can open it');
});

test('shipped ZIP updater verifies the archive and retains rollback copies before replacing app', () => {
  // Architecture check on the actual shipped helper; execution of PowerShell
  // transactions still requires validation on Windows.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const updater = fs.readFileSync(path.join(root, 'scripts/windows/Update-PaperDesk.ps1'), 'utf8');
  assert.ok(updater.indexOf('Get-FileHash') < updater.indexOf('[IO.Compression.ZipFile]::OpenRead'));
  assert.ok(updater.indexOf('exactly one PaperDesk.exe') < updater.indexOf('$backup = New-PaperDeskBackup'));
  assert.ok(updater.indexOf('$backup = New-PaperDeskBackup') < updater.indexOf('Move-Item -LiteralPath $installTarget'));
  assert.match(updater, /IsPathRooted\(\$entryName\)/);
  assert.match(updater, /ZIP entry escapes the staging directory/);
  assert.match(updater, /Symbolic-link ZIP entries are not accepted/);
  assert.match(updater, /Move-Item -LiteralPath \$oldApplication -Destination \$installTarget/);
  assert.match(updater, /Move-Item -LiteralPath \$oldTools -Destination \$toolsTarget/);
  assert.doesNotMatch(updater, /Start-Process/);
  assert.ok(updater.indexOf("'Create-Shortcuts.ps1'") < updater.indexOf('Get-ChildItem -LiteralPath $newTools'));
});

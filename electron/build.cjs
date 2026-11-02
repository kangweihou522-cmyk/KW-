const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareQualityRuntime } = require('../scripts/prepare-quality-translation.cjs');
const { spawn } = require('node:child_process');
const { prepareOfflineRuntime } = require('../scripts/prepare-offline-translation.cjs');

// Use Electron/electron-builder official sources by default. Respect explicitly
// configured mirrors without replacing TLS or artifact checksum verification.
const mirrorEnv = {
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
};

function withNoDeprecationWarning(nodeOptions) {
  const value = (nodeOptions || '').trim();

  if (value.split(/\s+/).includes('--no-deprecation')) {
    return value;
  }

  return `${value} --no-deprecation`.trim();
}

const env = {
  ...process.env,
  ...mirrorEnv,
  NODE_OPTIONS: withNoDeprecationWarning(process.env.NODE_OPTIONS),
};

async function build() {
const args = process.argv.slice(2);
const platform = args.includes('--win') ? 'win32' : args.includes('--mac') ? 'darwin' : args.includes('--linux') ? 'linux' : process.platform;
const arch = args.includes('--arm64') ? 'arm64' : args.includes('--x64') ? 'x64' : process.arch;
if (platform === 'win32' || platform === 'linux') await prepareQualityRuntime(platform, arch);
await prepareOfflineRuntime(platform, arch);
// Use a generated descriptor: treating package.json as extraResources removes it from app.asar.
await fs.writeFile(path.resolve(__dirname, '../release/paperdesk-version.json'), JSON.stringify({ version: require('../package.json').version, channel: 'paperdesk-stable' }));
const child = spawn(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

}
build().catch(error => { console.error(error.message); process.exitCode = 1; });

const { spawn } = require('node:child_process');

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

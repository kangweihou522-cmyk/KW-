// Build reviewable Windows + corresponding-source downloads. Never publishes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const repo = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const output = path.resolve(process.argv[2] || path.join(repo, 'release', 'downloads'));
const windows = path.join(repo, 'release', 'win-unpacked');
if (!fs.existsSync(path.join(windows, 'PaperDesk.exe'))) throw new Error('Build Windows with npm run package:windows first.');
fs.mkdirSync(output, { recursive: true });
const prefix = `PaperDesk-${version}-Windows`;
const binary = new AdmZip();
binary.addLocalFolder(windows, `${prefix}/win-unpacked`);
binary.addLocalFolder(path.join(repo, 'scripts', 'windows'), `${prefix}/scripts/windows`);
for (const name of ['README.md', 'UPSTREAM.md', 'LICENSE', 'TRADEMARKS.md']) binary.addLocalFile(path.join(repo, name), prefix);
for (const name of ['WINDOWS.md', 'LOCAL_OCR.md', 'REFERENCE_EXCHANGE.md', 'VALIDATION.md']) {
  const file = path.join(repo, 'docs', name);
  if (fs.existsSync(file)) binary.addLocalFile(file, `${prefix}/docs`);
}
const install = '@echo off\r\nsetlocal\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\windows\\Setup-PaperDesk.ps1" -AppDirectory "%~dp0win-unpacked" %*\r\nif errorlevel 1 (\r\n  echo Installation failed. Read the error above.\r\n  pause\r\n  exit /b 1\r\n)\r\npause\r\n';
binary.addFile(`${prefix}/安装到D盘.cmd`, Buffer.from(install));
binary.addFile(`${prefix}/开始使用.txt`, Buffer.from('PaperDesk 本地文献工作站\r\n\r\n1. 完整解压本压缩包。\r\n2. 双击“安装到D盘.cmd”，默认 D:\\PaperDesk。\r\n3. 从 Ollama 官网安装引擎，运行桌面 PaperDesk - Local Model 下载本地模型。\r\n4. 桌面 PaperDesk 启动；Ctrl+Alt+L 启动，Ctrl+Alt+U 校验更新。\r\n5. 核心功能不需要 Plus。ChatGPT 网页辅助由你手动提交选定材料。\r\n\r\n首次安装引擎/模型需要联网下载，不购买 API 或额度。\r\n本包由 Linux 跨平台构建，Windows 安装、快捷键和显卡推理还需在你的本机核实。\r\n完整说明见 README.md 和 docs/WINDOWS.md。\r\n对应源代码随本次提供的 PaperDesk-*-Source.zip 发布，许可证见 LICENSE。\r\n', 'utf8'));
const binaryName = `${prefix}.zip`;
binary.writeZip(path.join(output, binaryName));

const source = new AdmZip();
const excluded = new Set(['.git', 'node_modules', 'dist', 'release', '.appdata', 'userData', '.cache', '.localappdata']);
function addDirectory(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const next = path.join(directory, entry.name);
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) addDirectory(next, rel);
    else source.addLocalFile(next, path.posix.join(`PaperDesk-${version}-Source`, path.posix.dirname(rel)));
  }
}
addDirectory(repo);
const sourceName = `PaperDesk-${version}-Source.zip`;
source.writeZip(path.join(output, sourceName));
const sums = [binaryName, sourceName].map((name) => {
  const content = fs.readFileSync(path.join(output, name));
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  console.log(`${name}: ${(content.length / 1048576).toFixed(1)} MiB`);
  return `${hash}  ${name}`;
}).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sums);
console.log(sums.trim());

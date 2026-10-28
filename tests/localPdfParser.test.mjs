import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { parseLocalPdf, parseLocalPdfBytes } = require('../electron/backend/localPdfParser.cjs');
const { createMineruCommands } = require('../electron/backend/mineruCommands.cjs');
const { appendSupplementContext, splitReportContext } = require('../electron/backend/localReport.cjs');

// A real minimal PDF fixture. Tests exercise PDF.js, rather than mocking its text output.
function makePdf(pageTexts) {
  const objects = [];
  const add = (value) => objects.push(value);
  const pageIds = pageTexts.map((_, index) => 4 + index * 2);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let index = 0; index < pageTexts.length; index += 1) {
    const pageId = pageIds[index];
    const escaped = pageTexts[index].replace(/[\\()]/g, '\\$&');
    const stream = escaped ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : '';
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}

test('extracts a real PDF locally with physical page references and usable bounds', async () => {
  const result = await parseLocalPdfBytes(makePdf(['Research background', 'Methods and evidence']), { filename: 'paper.pdf' });
  assert.equal(result.engine, 'pdfjs-local-text');
  assert.equal(result.pageCount, 2);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0][0].content, 'Research background');
  assert.equal(result.pages[1][0].content, 'Methods and evidence');
  assert.match(result.markdown, /# Page 2\n\nMethods and evidence/);
  assert.deepEqual(result.warnings, []);
  const block = result.pages[0][0];
  assert.equal(block.bboxCoordinateSystem, 'pdf');
  assert.deepEqual(block.bboxPageSize, [612, 792]);
  assert.ok(block.bbox[0] >= 0 && block.bbox[2] > block.bbox[0]);
  assert.ok(block.bbox[1] >= 0 && block.bbox[3] > block.bbox[1]);
});

test('retains unreadable page positions and exposes incomplete extraction', async () => {
  const result = await parseLocalPdfBytes(makePdf(['Page one evidence', '', 'Page three evidence']));
  assert.equal(result.pages.length, 3);
  assert.deepEqual(result.pages[1], []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /第 2 页/);
  assert.match(result.markdown, /# Page 2\n\n\[.*本地 OCR/);
  assert.match(result.markdown, /# Page 3\n\nPage three evidence/);
});

test('refuses an image-only or empty PDF instead of reporting successful OCR', async () => {
  await assert.rejects(parseLocalPdfBytes(makePdf([''])), (error) => {
    assert.equal(error.code, 'LOCAL_OCR_REQUIRED');
    assert.match(error.message, /本地 OCR/);
    assert.match(error.message, /不会.*上传/);
    return true;
  });
});

test('accepts a local PDF path and rejects remote locations before fetching', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'paperdesk-local-pdf-'));
  try {
    const filePath = path.join(dir, 'paper.pdf');
    await writeFile(filePath, makePdf(['Local file evidence']));
    const result = await parseLocalPdf(filePath);
    assert.equal(result.filename, 'paper.pdf');
    assert.equal(result.pages[0][0].content, 'Local file evidence');
    await assert.rejects(parseLocalPdf('https://example.com/paper.pdf'), /ENOENT|本机/);
    await assert.rejects(parseLocalPdfBytes(new Uint8Array()), /为空/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local parse IPC emits real reader-compatible artifacts without a token or a network request', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paperdesk-local-parse-command-'));
  try {
    const pdfPath = path.join(directory, 'source paper.pdf');
    await writeFile(pdfPath, makePdf(['Background and evidence', 'Methods on page two']));
    const commands = createMineruCommands({ appPaths: { mineruCacheDir: path.join(directory, 'parsed') } });
    const result = await commands.run_mineru_cloud_parse({ options: { pdfPath } });
    assert.equal(result.state, 'done');
    assert.equal(result.engine, 'pdfjs-local-text');
    assert.equal(result.fullZipUrl, '');
    const pages = JSON.parse(result.contentJsonText);
    assert.equal(pages[1][0].content, 'Methods on page two');
    assert.equal(await readFile(result.markdownPath, 'utf8'), result.markdownText);
    assert.deepEqual(JSON.parse(await readFile(result.contentJsonPath, 'utf8')), pages);
    const provenance = JSON.parse(await readFile(path.join(result.assetRootDir, 'paperdesk-parse.json'), 'utf8'));
    assert.equal(provenance.pageCount, 2);
    assert.deepEqual(provenance.warnings, []);
    assert.equal(provenance.fingerprint.length, 64);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('supplement PDF is extracted locally and source/page labels survive chunk boundaries', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paperdesk-supplement-pdf-'));
  try {
    const storedPath = path.join(directory, 'supporting.pdf');
    await writeFile(storedPath, makePdf(['Supplementary result n=20', 'Supplementary controls']));
    const warnings = [];
    const text = await appendSupplementContext('# Page 1\nMain PDF context', { paperId: 'paper-1' }, {
      store: { load: () => ({ papers: [{ id: 'paper-1', attachments: [{ kind: 'supplement', fileName: 'supporting.pdf', storedPath }] }] }) },
    }, warnings);
    assert.match(text, /# Source: Main PDF/);
    assert.match(text, /# Supplement: supporting.pdf\n# Page 1\n\nSupplementary result n=20/);
    assert.match(text, /# Page 2\n\nSupplementary controls/);
    assert.deepEqual(warnings, []);
    const chunks = splitReportContext('# Supplement: supporting.pdf\n# Page 2\n' + 'Evidence '.repeat(3000));
    assert.match(chunks[1], /^# Supplement: supporting.pdf\n# Page 2 \(continued/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

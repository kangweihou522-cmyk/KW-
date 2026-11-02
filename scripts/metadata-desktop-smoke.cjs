const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyMetadataFields(page, paper) {
  const row = () => page.locator(`[data-paper-row-id="${paper.id}"]`);
  await row().getByRole('button', { name: '编辑文献信息', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑文献信息', exact: true });
  await editor.getByRole('button', { name: '添加项目', exact: true }).click();
  await editor.getByLabel('新增项目名称', { exact: true }).fill('中文标题');
  await editor.getByRole('button', { name: '添加', exact: true }).click();
  await editor.getByRole('textbox', { name: '中文标题', exact: true }).fill('第一篇文献的中文标题');
  await editor.getByRole('button', { name: '移除项目：URL', exact: true }).click();
  assert.equal(await editor.getByRole('textbox', { name: 'URL', exact: true }).count(), 0);
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await row().getByText('第一篇文献的中文标题', { exact: true }).waitFor();
  assert(!(await row().innerText()).includes('中文标题：'), 'Cards must show custom values without their field label');
  await page.evaluate(() => window.paperquay.invoke('library_import_references', { format: 'ris', content: 'TY  - JOUR\nTI  - Separate field values fixture\nER  - \n' }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const second = page.locator('[data-paper-row-id]').filter({ hasText: 'Separate field values fixture' });
  await second.getByRole('button', { name: '编辑文献信息', exact: true }).click();
  assert.equal(await editor.getByRole('textbox', { name: 'URL', exact: true }).count(), 0);
  assert.equal(await editor.getByRole('textbox', { name: '中文标题', exact: true }).inputValue(), '');
  await editor.getByRole('textbox', { name: '中文标题', exact: true }).fill('第二篇文献独立的中文标题');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await second.getByText('第二篇文献独立的中文标题', { exact: true }).waitFor();
  await row().getByText('第一篇文献的中文标题', { exact: true }).waitFor();
  await page.reload();
  await row().getByText('第一篇文献的中文标题', { exact: true }).waitFor();
  await row().getByRole('button', { name: '编辑文献信息', exact: true }).click();
  assert.equal(await editor.getByRole('textbox', { name: 'URL', exact: true }).count(), 0);
  await editor.getByRole('combobox', { name: '恢复项目', exact: true }).selectOption('url');
  await editor.getByRole('textbox', { name: 'URL', exact: true }).waitFor();
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  const otherId = await second.getAttribute('data-paper-row-id');
  await page.evaluate(paperId => window.paperquay.invoke('library_delete_paper', { request: { paperId, deleteFiles: false } }), otherId);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  console.log('PASS shared custom fields: Chinese title displayed, URL hide/restore, per-paper values and application reload.');
}

async function evidencePdf(file) {
  const stream = 'BT /F1 18 Tf 50 740 Td (Highly accurate protein structure) Tj 0 -24 Td (prediction with AlphaFold) Tj /F1 10 Tf 0 -36 Td (John Jumper and colleagues) Tj 0 -25 Td (Nature 596 583-589 2021) Tj 0 -30 Td (https://doi.org/10.1038/s41586-021-03819-2) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Title (Highly accurate protein structure) /Author (MDPI) /CreationDate (D:20261102000000) >>'];
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${start}\n%%EOF`;
  await fs.writeFile(file, text);
}

async function verifyLiveMetadata(app, page, home) {
  const file = path.join(home, 'short-title-bad-author.pdf'); await evidencePdf(file);
  // Stub only the native file chooser. PDF parsing, registry request and SQLite save are real.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  await page.getByRole('button', { name: '我的文库', exact: true }).click();
  await page.getByRole('button', { name: '导入 PDF', exact: true }).click();
  const confirm = page.getByRole('button', { name: '确认导入', exact: true });
  await confirm.waitFor();
  try { await page.getByText(/已核对：Crossref/).waitFor({ timeout: 25000 }); } catch (error) { console.log('METADATA_IMPORT_FAILURE', (await page.locator('body').innerText()).slice(-6000)); throw error; }
  await confirm.click({ timeout: 30000 });
  const title = 'Highly accurate protein structure prediction with AlphaFold';
  await page.locator('[data-paper-row-id]').filter({ hasText: title }).waitFor({ timeout: 15000 });
  const paper = await page.evaluate(async () => (await window.paperquay.invoke('library_list_papers')).find(p => p.doi === '10.1038/s41586-021-03819-2'));
  assert.equal(paper.title, title); assert(paper.authors.length > 10); assert(paper.authors.some(author => /Jumper/.test(author.name)));
  assert(!paper.authors.some(author => author.name === 'MDPI')); assert.equal(paper.publication, 'Nature'); assert.equal(paper.year, '2021'); assert.equal(paper.volume, '596'); assert.match(paper.publishedDate, /^2021-/);
  console.log('PASS real packaged PDF import + Crossref: full title/authors/journal/year/volume/date/DOI corrected from MDPI and 2026 PDF creation date.');
}
module.exports = { verifyMetadataFields, verifyLiveMetadata };

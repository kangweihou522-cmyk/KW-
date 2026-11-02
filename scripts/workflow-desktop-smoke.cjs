const assert = require('node:assert/strict');
const path = require('node:path');

async function verifyNotesPreview(page, paper, home) {
  // Work on a separate standalone note, leaving the report/version checks intact.
  const note = await page.evaluate(paperId => window.paperquay.invoke('notes_create', { request: { paperId, type: 'standalone', title: '预览验证笔记', content: '用户编辑的正文 n=20。', contentText: '用户编辑的正文 n=20。', tags: ['重点', '方法'] } }), paper.id);
  await page.evaluate(note => window.dispatchEvent(new CustomEvent('paperquay:note-changed', { detail: { action: 'created', noteId: note.id, note, updatedAt: note.updatedAt } })), note);
  await page.getByRole('button', { name: '笔记', exact: true }).last().click();
  const sidebar = page.locator('[data-reader-notes]');
  // A newly created note may be picked by the existing note list or via its chip.
  const chip = sidebar.getByRole('button', { name: note.title, exact: true });
  await chip.waitFor(); await chip.click();
  await sidebar.locator('[data-note-preview]').getByRole('heading', { name: note.title, exact: true }).waitFor();
  assert.equal(await sidebar.getByRole('button', { name: 'Save', exact: true }).isVisible(), false);
  assert.equal(await sidebar.getByText('摘录', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(home, 'notes-preview-before-edit.png') });
  await sidebar.getByText('重点', { exact: true }).waitFor();
  await sidebar.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await sidebar.locator('.tiptap[contenteditable=true]').fill('保存之后直接预览，新内容 n=21。');
  await sidebar.getByRole('button', { name: 'Save', exact: true }).click();
  await sidebar.locator('[data-note-preview]').waitFor();
  await sidebar.getByText('保存之后直接预览，新内容 n=21。', { exact: true }).waitFor();
  const saved = await page.evaluate(id => window.paperquay.invoke('notes_get', { id }), note.id);
  assert(saved.contentText.includes('n=21')); assert.deepEqual(saved.tags, note.tags);
  await page.screenshot({ path: path.join(home, 'notes-saved-preview.png') });
  console.log('PASS actual saved-note preview: user tags/content, edit-only toolbar, save returns to preview and persists new content.');
}

async function verifyPreparation(page, app, paper, home) {
  // Stub only model inference. Real IPC, PDF.js, disk cache and SQLite still run.
  // Native model inference is verified separately by the Windows Hy-MT2 job.
  await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'); const Quality = require(app.isPackaged ? './electron/backend/qualityTranslation.cjs' : './backend/qualityTranslation.cjs').QualityTranslation;
    globalThis.workflowOriginalTranslate = Quality.prototype.translate;
    globalThis.workflowModelCalls = 0;
    Quality.prototype.translate = async () => { globalThis.workflowModelCalls++; return '测试离线译文：样本量为20，未证明因果关系。'; };
  });
  try {
    await page.getByRole('button', { name: '我的文库', exact: true }).first().click();
    const card = page.locator(`[data-paper-row-id="${paper.id}"]`);
    if (await card.count()) await card.first().click();
    const details = page.locator('[data-paper-details]');
    await details.getByRole('button', { name: '文档处理', exact: true }).click();
    await page.getByRole('button', { name: '全文翻译', exact: true }).last().click();
    await details.getByText('处理完成', { exact: true }).waitFor({ timeout: 30000 });
    await details.getByRole('button', { name: '查看全文译文', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '全文译文', exact: true });
    await preview.getByText('测试离线译文：样本量为20，未证明因果关系。', { exact: true }).first().waitFor();
    await preview.getByRole('button', { name: '关闭全文译文', exact: true }).click();
    const before = await app.evaluate(() => globalThis.workflowModelCalls);
    const cached = await page.evaluate(async p => window.paperquay.invoke('selection_translate', { text: 'sample size was 20.', source: 'English', target: 'Chinese', provider: 'offline-quality', documentId: `native-library:${p.id}`, requestId: 'workflow-cache' }), paper);
    assert.equal(cached.cached, true); assert.equal(cached.cacheMatch, 'paragraph');
    assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), before);
    await details.getByRole('button', { name: '一键处理文献', exact: true }).click();
    await details.getByText('结果已保留，可再次点击继续', { exact: true }).waitFor({ timeout: 45000 });
    const completed = await page.evaluate(paperId => window.paperquay.invoke('paper_prepare_status', { paperId }), paper.id);
    assert.equal(completed.steps.parse.status, 'done'); assert.equal(completed.steps.overview.status, 'done'); assert.equal(completed.steps.translation.status, 'done');
    assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), before);

    await page.screenshot({ path: path.join(home, 'document-preparation.png') });
    console.log('PASS real PDF preparation UI/IPC/storage with a stubbed model: full translation preview and subsequent selection share one cache.');
  } finally {
    await app.evaluate(({ app }) => { const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'); const Quality = require(app.isPackaged ? './electron/backend/qualityTranslation.cjs' : './backend/qualityTranslation.cjs').QualityTranslation; Quality.prototype.translate = globalThis.workflowOriginalTranslate; });
  }
}
module.exports = { verifyNotesPreview, verifyPreparation };

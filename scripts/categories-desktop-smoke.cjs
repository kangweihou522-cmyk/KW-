const assert = require('node:assert/strict');
const path = require('node:path');

async function verifyPaperCategories(page, paper, home) {
  const snapshot = () => page.evaluate(async paperId => ({
    paper: (await window.paperquay.invoke('library_list_papers')).find(p => p.id === paperId),
    notes: await window.paperquay.invoke('notes_list', { request: { paperId } }),
    overview: await window.paperquay.invoke('paper_document_get', { paperId }),
    translations: await window.paperquay.invoke('paper_translation_get', { paperId }),
  }), paper.id);
  const before = await snapshot();
  const groups = await page.evaluate(async () => {
    const create = request => window.paperquay.invoke('library_create_category', { request });
    const parent = await create({ name: '辣椒素' });
    return { parent, first: await create({ name: '辣椒素', parentId: parent.id }), second: await create({ name: '畜牧生产' }), third: await create({ name: '待精读' }) };
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const row = page.locator(`[data-paper-row-id="${paper.id}"]`);
  const category = id => page.locator(`[data-paperquay-category-drop-id="${id}"]`);
  const dialog = page.getByRole('dialog', { name: '管理文献分类', exact: true });
  const open = async () => { await row.getByRole('button', { name: '管理文献分类', exact: true }).click(); await dialog.waitFor(); };
  const firstBox = () => dialog.getByRole('checkbox', { name: '辣椒素 / 辣椒素', exact: true });
  const secondBox = () => dialog.getByRole('checkbox', { name: '畜牧生产', exact: true });
  await open(); await firstBox().check(); await secondBox().check();
  await dialog.getByRole('button', { name: '保存分类', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await row.locator('[data-paper-categories]').getByText('畜牧生产', { exact: true }).waitFor();
  await page.reload(); await row.waitFor();
  await open(); assert(await firstBox().isChecked()); assert(await secondBox().isChecked()); await page.keyboard.press('Escape');
  if (await category(groups.parent.id).getAttribute('aria-expanded') === 'false') await category(groups.parent.id).dblclick();
  await category(groups.first.id).click(); await row.waitFor();
  await category(groups.second.id).click(); await row.waitFor();
  assert.equal(await row.count(), 1);
  await category(groups.parent.id).getByText('1', { exact: true }).waitFor();

  await category(groups.first.id).click(); await open(); await firstBox().uncheck();
  await dialog.getByRole('button', { name: '保存分类', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await row.waitFor({ state: 'detached' });
  await category(groups.second.id).click(); await row.waitFor();

  // Real pointer drag through the existing sorting/category drag handle.
  const handle = await row.locator('[data-paper-sort-handle]').boundingBox();
  const target = await category(groups.third.id).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 24 }); await page.mouse.up();
  await page.getByText('已添加到分类：待精读，原有分类保留', { exact: true }).waitFor();
  await category(groups.second.id).click(); await row.waitFor();
  await category(groups.third.id).click(); await row.waitFor();
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '管理分类（可多选）', exact: true }).click();
  assert(await secondBox().isChecked()); assert(await dialog.getByRole('checkbox', { name: '待精读', exact: true }).isChecked());
  await secondBox().uncheck(); await dialog.getByRole('checkbox', { name: '待精读', exact: true }).uncheck();
  await dialog.getByRole('button', { name: '保存分类', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /^未分类/ }).click(); await row.waitFor();

  // Importing the same file into two groups must add memberships, not records.
  for (const targetCategoryId of [groups.first.id, groups.second.id]) {
    const [result] = await page.evaluate(args => window.paperquay.invoke('library_import_pdfs', { request: args }), { paths: [paper.attachments.find(a => a.kind === 'pdf').storedPath], targetCategoryId });
    assert.equal(result.status, 'duplicate'); assert.equal(result.paper.id, paper.id);
  }
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await category(groups.second.id).click(); await row.waitFor();
  await row.locator('[data-paper-categories]').getByText('辣椒素 / 辣椒素', { exact: true }).waitFor();
  await row.locator('[data-paper-categories]').getByText('畜牧生产', { exact: true }).waitFor();
  const after = await snapshot();
  assert.deepEqual(new Set(after.paper.categoryIds), new Set([groups.first.id, groups.second.id]));
  assert.deepEqual(after.paper.attachments, before.paper.attachments);
  assert.equal(after.paper.aiSummary, before.paper.aiSummary); assert.equal(after.paper.userNote, before.paper.userNote);
  assert.deepEqual(after.notes, before.notes); assert.deepEqual(after.overview, before.overview); assert.deepEqual(after.translations, before.translations);
  assert.equal(await page.evaluate(async () => (await window.paperquay.invoke('library_list_papers')).length), 1);
  await page.screenshot({ path: path.join(home, 'paper-in-multiple-categories.png') });
  await page.getByRole('button', { name: /^所有文献/ }).click();
  console.log('PASS actual multi-category UI/SQLite: select two groups, reload, filter both, uncheck one, real drag adds another, context menu, Uncategorized, duplicate import; one shared PDF, notes, overview and cached translations.');
}
module.exports = { verifyPaperCategories };

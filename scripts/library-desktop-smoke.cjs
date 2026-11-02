const assert = require('node:assert/strict');
const path = require('node:path');

async function verifyLibraryMetadata(page, paper) {
  const row = page.locator(`[data-paper-row-id="${paper.id}"]`);
  await row.getByRole('button', { name: '编辑文献信息', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑文献信息', exact: true });
  for (const [label, value] of [['期刊', 'Fictional Journal'], ['卷', '13'], ['期', '2'], ['页码 / 文章编号', '112–124'], ['出版日期', '2025-03-12'], ['DOI', '10.0000/fictional-evidence']]) await editor.getByLabel(label, { exact: true }).fill(value);
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await row.getByText('Fictional Journal', { exact: true }).waitFor();
  await row.getByRole('button', { name: '编辑影响因子', exact: true }).click();
  const factor = page.getByRole('dialog', { name: '编辑影响因子', exact: true });
  await factor.getByLabel('影响因子', { exact: true }).fill('12.3');
  await factor.getByRole('button', { name: '保存', exact: true }).click();
  await row.getByRole('button', { name: '编辑影响因子', exact: true }).filter({ hasText: '12.3' }).waitFor();
  await row.getByRole('button', { name: '添加标签', exact: true }).click();
  const tags = page.getByRole('dialog', { name: '添加标签', exact: true });
  for (const name of ['益生菌', '屏障功能', '待精读']) {
    const search = tags.getByRole('textbox', { name: '搜索或新建标签', exact: true });
    await search.fill(name); await search.press('Enter');
    assert(await tags.getByRole('checkbox', { name, exact: true }).isChecked());
  }
  await tags.getByRole('button', { name: '应用（3）', exact: true }).click();
  await row.getByRole('button', { name: '移除标签：待精读', exact: true }).waitFor();
  await row.getByRole('button', { name: '移除标签：待精读', exact: true }).click();
  await row.getByRole('button', { name: '移除标签：待精读', exact: true }).waitFor({ state: 'detached' });
  await row.getByRole('button', { name: '添加标签', exact: true }).click();
  assert(await tags.getByRole('checkbox', { name: '益生菌', exact: true }).isChecked());
  assert(await tags.getByRole('checkbox', { name: '屏障功能', exact: true }).isChecked());
  await page.keyboard.press('Escape');
  const filter = page.getByRole('combobox', { name: '按标签筛选', exact: true });
  await filter.selectOption({ label: '屏障功能' });
  await row.waitFor(); await filter.selectOption('');
  const saved = await page.evaluate(async id => (await window.paperquay.invoke('library_list_papers')).find(value => value.id === id), paper.id);
  assert.equal(saved.impactFactor, 12.3); assert.equal(saved.volume, '13'); assert.equal(saved.issue, '2');
  assert.deepEqual(saved.tags.map(value => value.name), ['益生菌', '屏障功能']);
  const content = await row.innerText();
  assert(content.includes('2025-03-12')); assert(content.includes('13(2)')); assert(content.includes('112–124'));
  assert(!content.includes(paper.attachments[0].storedPath)); assert(!content.includes('阅读热力'));
  assert(!(await page.locator('[data-paper-details]').innerText()).includes('年度期刊指标'));
  console.log('PASS library UI: journal/volume/issue/date/DOI, manual IF, multi-tag create/select/remove/filter and SQLite persistence.');
}

async function verifyLibraryOverview(page, paper, home, app) {
  await page.getByRole('button', { name: '我的文库', exact: true }).click();
  const overview = page.locator('[data-ai-overview]');
  async function add(title, content) {
    await overview.getByRole('button', { name: '添加 AI 概览栏目', exact: true }).click();
    await overview.getByRole('textbox', { name: 'AI 概览栏目标题', exact: true }).fill(title);
    await overview.getByRole('textbox', { name: 'AI 概览栏目内容', exact: true }).fill(content);
    await overview.getByRole('button', { name: '保存', exact: true }).click();
    await overview.getByRole('tab', { name: title, exact: true }).waitFor();
    await overview.getByRole('tabpanel').getByText(content, { exact: true }).waitFor();
  }
  await add('要点', '原始要点，保留其他栏目。');
  await add('重点', '核查图2与补充表S1 [PDF Page 3]');
  let titles = await overview.getByRole('tab').allTextContents();
  assert.equal(titles.indexOf('重点'), titles.indexOf('要点') + 1);
  await overview.getByRole('button', { name: '编辑概览栏目', exact: true }).click();
  await overview.getByRole('textbox', { name: 'AI 概览栏目内容', exact: true }).fill('修订后的重点：n=21 [PDF Page 4]');
  await overview.getByRole('button', { name: '保存', exact: true }).click();
  await overview.getByRole('tabpanel').getByText('修订后的重点：n=21 [PDF Page 4]', { exact: true }).waitFor();
  await add('临时栏目', '这部分将删除');
  await overview.getByRole('button', { name: '编辑概览栏目', exact: true }).click();
  await overview.getByRole('button', { name: '删除 AI 概览栏目', exact: true }).click();
  await overview.getByRole('button', { name: '保存', exact: true }).click();
  await overview.getByRole('tab', { name: '临时栏目', exact: true }).waitFor({ state: 'detached' });
  await overview.getByRole('button', { name: '完整报告与历史版本', exact: true }).click();
  const report = page.getByRole('dialog', { name: '文献报告', exact: true });
  await report.getByRole('button', { name: '手工编辑', exact: true }).click();
  await report.getByRole('textbox', { name: '报告：重点', exact: true }).fill('从报告编辑器同步的重点 [PDF Page 5]\n\n');
  await report.getByRole('button', { name: '保存报告', exact: true }).click();
  await report.getByText('已保存到本地，历史版本保留。阅读和编辑无需请求模型。', { exact: true }).waitFor();
  await report.getByRole('button', { name: '关闭', exact: true }).click();
  await overview.getByRole('tab', { name: '重点', exact: true }).click();
  await overview.getByRole('tabpanel').getByText('从报告编辑器同步的重点 [PDF Page 5]', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '我的文库', exact: true }).click();
  await overview.getByRole('tab', { name: '重点', exact: true }).click();
  await overview.getByRole('tabpanel').getByText('从报告编辑器同步的重点 [PDF Page 5]', { exact: true }).waitFor();
  const saved = await page.evaluate(async id => ({ paper: (await window.paperquay.invoke('library_list_papers')).find(value => value.id === id), notes: await window.paperquay.invoke('notes_list', { request: { paperId: id } }) }), paper.id);
  assert.match(saved.paper.aiSummary, /## 重点\n从报告编辑器同步的重点/);
  assert(!saved.paper.aiSummary.includes('临时栏目'));
  const note = saved.notes.find(value => value.tags.includes('本地编辑报告'));
  assert(note.contentText.includes('从报告编辑器同步的重点'));
  const versions = await page.evaluate(id => window.paperquay.invoke('notes_versions', { id }), note.id);
  assert(versions.some(version => version.note.contentText.includes('修订后的重点：n=21')));
  await page.screenshot({ path: path.join(home, 'library-overview.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 780));
  await page.waitForTimeout(300);
  const dimensions = await page.locator('.pq-library-workspace').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, right: element.querySelector('[data-paper-details]').getBoundingClientRect().right, viewport: window.innerWidth }));
  assert(dimensions.content <= dimensions.width + 1, `Small window overflow: ${JSON.stringify(dimensions)}`);
  assert(dimensions.right <= dimensions.viewport, 'Overview is clipped at minimum window size.');
  await overview.getByRole('tab', { name: '重点', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  console.log('PASS custom overview UI: 要点→重点 tab order, add/edit/delete, report sync, history and full application reload.');
}
module.exports = { verifyLibraryMetadata, verifyLibraryOverview };

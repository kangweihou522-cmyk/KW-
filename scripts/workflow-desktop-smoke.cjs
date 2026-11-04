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
    globalThis.workflowOriginalFetch = globalThis.fetch;
    // Only local model inference is stubbed; IPC, stages and SQLite are real.
    globalThis.fetch = async (url, init) => {
      const endpoint = String(url);
      if (/^http:\/\/(?:127\.0\.0\.1|localhost):11434\//.test(endpoint) && init?.body) {
        const body = JSON.parse(init.body); const prompt = body.messages?.[0]?.content || '';
        if (prompt.includes('evidence-grounded scientific reading report') || prompt.includes('全文证据报告')) {
          const report = prompt.includes('全文证据报告')
            ? { overview: '根据论文证据概括。'.repeat(90) }
            : { title: '虚构研究', abstract: '二十个样本，未证明因果关系。', overview: '全文证据：虚构研究使用二十个样本，未证明因果关系。', keyFindings: ['n=20'], limitations: '仅供交互测试' };
          return new Response(JSON.stringify(endpoint.endsWith('/api/chat') ? { done: true, done_reason: 'stop', message: { content: JSON.stringify(report) } } : { choices: [{ message: { content: JSON.stringify(report) } }] }), { headers: { 'Content-Type': 'application/json' } });
        }
      }
      return globalThis.workflowOriginalFetch(url, init);
    };
    globalThis.workflowModelCalls = 0;
    Quality.prototype.translate = async (text, options = {}) => { globalThis.workflowModelCalls++; if (text === 'The sample size was 20.') return '样本量为20。'; if (text === 'The study does not establish causality.') return '该研究未建立因果关系。'; if (text === 'fictional-paper') return '虚构论文'; if (text === 'sample') return '样本'; if (text === 'control') return '对照'; if (text === 'treatment') { globalThis.workflowOldSelectionStarted = true; options.onDelta?.('旧选区'); await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => { globalThis.workflowOldSelectionCancelled = true; reject(new Error('请求已取消')); }, { once: true }); }); } return '测试离线译文：样本量为20，未证明因果关系。'; };
  });
  try {
    await page.evaluate(paperId => window.paperquay.invoke('library_update_paper', { request: { paperId, abstractText: 'The sample size was 20. The study does not establish causality.' } }), paper.id);
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
    const cached = await page.evaluate(async p => window.paperquay.invoke('selection_translate', { text: 'The sample size was 20.', source: 'English', target: 'Chinese', provider: 'offline-quality', documentId: `native-library:${p.id}`, requestId: 'workflow-cache' }), paper);
    assert.equal(cached.cached, true); assert.equal(cached.cacheMatch, 'exact');
    assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), before);
    await details.getByRole('button', { name: '一键处理文献', exact: true }).click();
    await details.getByText('结果已保留，可再次点击继续', { exact: true }).waitFor({ timeout: 45000 });
    const completed = await page.evaluate(paperId => window.paperquay.invoke('paper_prepare_status', { paperId }), paper.id);
    assert.equal(completed.steps.parse.status, 'done'); assert.equal(completed.steps.overview.status, 'done'); assert.equal(completed.steps.translation.status, 'done');
    assert.equal(completed.steps.personal.status, 'done', JSON.stringify(completed.steps.personal));
    assert.equal(completed.steps.abstract.status, 'done'); assert.equal(completed.steps.title.status, 'done');
    await details.locator('[data-personal-overview]').getByText('样本量为20。该研究未建立因果关系。', { exact: true }).waitFor();
    const autoFilled = await page.evaluate(paperId => window.paperquay.invoke('paper_document_get', { paperId }), paper.id);
    assert.equal(autoFilled.content.find(s => s.id === 'overview').content, '真实数据库交互验证：我的手工概览');
    assert.equal(autoFilled.content.find(s => s.title === '研究设计').content, 'n=20，原PDF与笔记均保留');
    await card.getByText('第一篇文献的中文标题', { exact: true }).waitFor();
    // Clear only fixture fields after confirming manual content is preserved.
    await page.evaluate(async ({ paperId, document }) => {
      const settings = await window.paperquay.invoke('library_get_settings');
      const current = (await window.paperquay.invoke('library_list_papers')).find(p => p.id === paperId);
      const field = settings.metadataLayout.customFields.find(f => f.label === '中文标题');
      const customFields = { ...current.customFields }; delete customFields[field.id];
      await window.paperquay.invoke('library_update_paper', { request: { paperId, customFields, metadataLayout: { hiddenFields: settings.metadataLayout.hiddenFields.filter(id => id !== field.id), customFields: settings.metadataLayout.customFields.filter(f => f.id !== field.id) } } });
      await window.paperquay.invoke('paper_document_save', { paperId, content: document.content.map(s => s.id === 'overview' ? { ...s, content: '' } : s), expectedVersion: document.version, sourceId: 'workflow-empty-overview' });
      window.dispatchEvent(new CustomEvent('paperdesk:personal-overview-updated', { detail: { paperId } }));
    }, { paperId: paper.id, document: autoFilled });
    await details.getByRole('button', { name: '一键处理文献', exact: true }).click();
    await details.locator('[data-personal-overview]').getByText(/^根据论文证据概括。/).waitFor({ timeout: 45000 });
    await card.getByText('虚构论文', { exact: true }).waitFor();
    await card.getByRole('button', { name: '编辑文献信息', exact: true }).click();
    const metadataEditor = page.getByRole('dialog', { name: '编辑文献信息', exact: true });
    assert.equal(await metadataEditor.getByRole('textbox', { name: '中文标题', exact: true }).inputValue(), '虚构论文');
    await metadataEditor.getByRole('button', { name: '取消', exact: true }).click();
    const generated = await page.evaluate(paperId => window.paperquay.invoke('paper_document_get', { paperId }), paper.id);
    const length = Array.from(generated.content.find(s => s.id === 'overview').content.replace(/\s/g, '')).length;
    assert.equal(length, 810);
    assert.equal(generated.content.find(s => s.id === 'abstract').content, autoFilled.content.find(s => s.id === 'abstract').content);
    const overviewHistory = await page.evaluate(paperId => window.paperquay.invoke('paper_document_history', { paperId }), paper.id);
    assert(overviewHistory.some(version => version.content.some(s => s.content === '真实数据库交互验证：我的手工概览')));
    console.log(`PASS automatic original-abstract translation, Chinese title and ${length}-character overview without a length gate; manual fields and history retained.`);
    const afterAutofill = await app.evaluate(() => globalThis.workflowModelCalls);
    assert.equal(afterAutofill, before + 1, 'Only the cleared Chinese title should require new translation; the abstract uses full-text sentence cache.');
    const request = { text: 'sample', source: 'English', target: 'Chinese', provider: 'offline-quality', documentId: `native-library:${paper.id}`, pageIndex: 0 };
    const word = await page.evaluate(args => window.paperquay.invoke('selection_translate', { ...args, requestId: 'word-first' }), request);
    assert.equal(word.translation, '样本'); assert.equal(word.cached, false); assert(word.reference?.sourceText.includes('The sample size'));
    const repeated = await page.evaluate(args => window.paperquay.invoke('selection_translate', { ...args, requestId: 'word-repeat' }), request);
    assert.equal(repeated.cached, true); assert.equal(await app.evaluate(() => globalThis.workflowModelCalls), afterAutofill + 1);


    await page.screenshot({ path: path.join(home, 'document-preparation.png') });
    await card.first().dblclick();
    const highlighter = page.getByLabel('高亮', { exact: true }); if (await highlighter.getAttribute('aria-pressed') === 'true') await highlighter.click();
    async function selectWord(word) {
      const span = page.locator('.textLayer span').filter({ hasText: word === 'sample' ? 'The sample size was 20.' : 'The treatment reduced blood pressure' }).first();
      await span.waitFor();
      await span.evaluate((element, word) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) { const start = node.textContent.indexOf(word); if (start < 0) continue;
          const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          const rect = range.getBoundingClientRect(); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.top + rect.height / 2 })); break;
        }
      }, word);
    }
    const sidebar = page.locator('.pq-reader-assistant');
    await selectWord('sample'); await sidebar.locator('[data-selection-translation]').getByText('样本', { exact: true }).waitFor();
    const reference = sidebar.locator('[data-selection-reference]'); await reference.waitFor(); assert.equal(await reference.getAttribute('open'), null);
    assert.equal((await sidebar.locator('[data-selection-translation]').innerText()).trim(), '样本');
    await selectWord('treatment');
    for (let i = 0; i < 80 && !(await app.evaluate(() => !!globalThis.workflowOldSelectionStarted)); i++) await page.waitForTimeout(50);
    assert(await app.evaluate(() => !!globalThis.workflowOldSelectionStarted));
    await selectWord('sample'); await sidebar.locator('[data-selection-translation]').getByText('样本', { exact: true }).waitFor();
    assert(await app.evaluate(() => !!globalThis.workflowOldSelectionCancelled));
    await page.screenshot({ path: path.join(home, 'precise-word-translation.png') });
    console.log('PASS exact-word UI: only selected word in main result, folded cached context, rapid reselection cancels stale inference.');
    await require('./layout-desktop-smoke.cjs').verifyPdfSelectionAndDpi(page, app, home);
    await page.getByRole('button', { name: '我的文库', exact: true }).click();

    console.log('PASS real PDF preparation UI/IPC/storage with a stubbed model: full translation preview and subsequent selection share one cache.');
  } finally {
    await app.evaluate(({ app }) => { const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'); const Quality = require(app.isPackaged ? './electron/backend/qualityTranslation.cjs' : './backend/qualityTranslation.cjs').QualityTranslation; Quality.prototype.translate = globalThis.workflowOriginalTranslate; globalThis.fetch = globalThis.workflowOriginalFetch; });
  }
}
module.exports = { verifyNotesPreview, verifyPreparation };

async function verifyAttachmentFolder(page, app, paper, home) {
  const fs = require('node:fs/promises'); const file = path.join(home, 'supplement-folder-check.csv'); await fs.writeFile(file, 'group,n\ncontrol,20\n');
  const updated = await page.evaluate(({ paperId, file }) => window.paperquay.invoke('library_add_supplement', { paperId, paths: [file] }), { paperId: paper.id, file });
  const attachment = updated.attachments.find(item => item.kind === 'supplement' && item.fileName === path.basename(file)); assert(attachment);
  await app.evaluate(({ shell }) => { globalThis.folderSmokeOriginal = shell.showItemInFolder; globalThis.folderSmokePaths = []; shell.showItemInFolder = file => { globalThis.folderSmokePaths.push(file); }; });
  try {
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.locator(`[data-paper-row-id="${paper.id}"]`).click();
    await page.getByRole('button', { name: '补充材料', exact: true }).click();
    await page.getByRole('button', { name: `打开所在文件夹：${attachment.fileName}`, exact: true }).click();
    assert.deepEqual(await app.evaluate(() => globalThis.folderSmokePaths), [attachment.storedPath]);
    assert.equal(await fs.readFile(attachment.storedPath, 'utf8'), 'group,n\ncontrol,20\n');
    const notesBefore = await page.evaluate(paperId => window.paperquay.invoke('notes_list', { request: { paperId } }), paper.id);
    await page.getByRole('button', { name: `移除补充材料：${attachment.fileName}`, exact: true }).click();
    await page.getByRole('button', { name: `打开 ${attachment.fileName}`, exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '补充材料', exact: true }).click();
    await page.getByRole('button', { name: '补充材料', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: `移除补充材料：${attachment.fileName}`, exact: true }).count(), 0);
    const saved = await page.evaluate(async paperId => (await window.paperquay.invoke('library_list_papers')).find(item => item.id === paperId), paper.id);
    assert(!saved.attachments.some(item => item.id === attachment.id)); assert(saved.attachments.some(item => item.kind === 'pdf'));
    assert.equal(await fs.readFile(file, 'utf8'), 'group,n\ncontrol,20\n');
    assert.equal(await fs.readFile(attachment.storedPath, 'utf8'), 'group,n\ncontrol,20\n');
    assert.deepEqual(await page.evaluate(paperId => window.paperquay.invoke('notes_list', { request: { paperId } }), paper.id), notesBefore);
    await page.keyboard.press('Escape'); console.log('PASS supplementary folder action and removal: attachment unlinked persistently; main PDF, files and notes retained.');
  } finally { await app.evaluate(({ shell }) => { shell.showItemInFolder = globalThis.folderSmokeOriginal; }); }
}
module.exports.verifyAttachmentFolder = verifyAttachmentFolder;

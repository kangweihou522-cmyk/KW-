const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');

async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperdesk-multicategory-'));
  const appPaths = { dataDir, libraryPath: path.join(dataDir, 'library.json'), libraryDatabasePath: path.join(dataDir, 'library.sqlite') };
  let store = createLibraryStore(appPaths); let api = createLibraryCommands({ appPaths, store });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const parent = await api.library_create_category({ request: { name: '辣椒素' } });
  const first = await api.library_create_category({ request: { name: '辣椒素', parentId: parent.id } });
  const second = await api.library_create_category({ request: { name: '畜牧生产' } });
  const third = await api.library_create_category({ request: { name: '待精读' } });
  const file = path.join(dataDir, 'paper.pdf'); fs.writeFileSync(file, '%PDF-1.7\nfixture for category membership');
  const [result] = await api.library_import_pdfs({ request: { paths: [file], importMode: 'copy', targetCategoryId: first.id } });
  assert.equal(result.status, 'imported', result.message);
  const paper = result.paper;
  return { appPaths, first, second, third, parent, paper, file, get api() { return api; }, get store() { return store; }, reopen() { store.close(); store = createLibraryStore(appPaths); api = createLibraryCommands({ appPaths, store }); } };
}

test('one paper belongs to multiple groups after restart, counts once per parent, and retains all other data', async t => {
  const f = await fixture(t);
  await f.api.library_update_paper({ request: { paperId: f.paper.id, userNote: '我的笔记', aiSummary: '手工概览' } });
  const before = (await f.api.library_list_papers({}))[0];
  await f.api.library_update_paper_categories({ request: { paperId: f.paper.id, addCategoryIds: [f.second.id, f.parent.id], removeCategoryIds: [] } });
  // The existing drag/agent command must also add, not replace, membership.
  await f.api.library_assign_paper_category({ request: { paperId: f.paper.id, categoryId: f.second.id } });
  f.reopen();
  for (const categoryId of [f.first.id, f.second.id, f.parent.id]) assert.equal((await f.api.library_list_papers({ request: { categoryId } })).length, 1);
  assert.equal((await f.api.library_list_papers({})).length, 1);
  const categories = await f.api.library_list_categories();
  assert.equal(categories.find(c => c.id === f.parent.id).paperCount, 1);
  const current = (await f.api.library_list_papers({}))[0];
  const { categoryIds, updatedAt, ...unchanged } = current; const { categoryIds: oldIds, updatedAt: oldDate, ...old } = before;
  assert.deepEqual(unchanged, old); assert.equal(new Set(categoryIds).size, 3);
  assert(fs.existsSync(current.attachments[0].storedPath));
});

test('removing membership preserves other groups, deleting a group preserves the paper, clearing all returns Uncategorized', async t => {
  const f = await fixture(t);
  await f.api.library_assign_paper_category({ request: { paperId: f.paper.id, categoryId: f.second.id } });
  await f.api.library_update_paper_categories({ request: { paperId: f.paper.id, addCategoryIds: [], removeCategoryIds: [f.first.id] } });
  assert.equal((await f.api.library_list_papers({ request: { categoryId: f.first.id } })).length, 0);
  assert.equal((await f.api.library_list_papers({ request: { categoryId: f.second.id } })).length, 1);
  await f.api.library_delete_category({ categoryId: f.second.id });
  const uncategorized = (await f.api.library_list_categories()).find(c => c.systemKey === 'uncategorized');
  assert.equal((await f.api.library_list_papers({ request: { categoryId: uncategorized.id } })).length, 1);
  assert(fs.existsSync(f.paper.attachments[0].storedPath));
});

test('membership deltas preserve a concurrently added group and reject invalid/system groups atomically', async t => {
  const f = await fixture(t);
  await f.api.library_assign_paper_category({ request: { paperId: f.paper.id, categoryId: f.third.id } });
  // Dialog originally showed only first; third was added after it opened.
  const result = await f.api.library_update_paper_categories({ request: { paperId: f.paper.id, addCategoryIds: [f.second.id], removeCategoryIds: [f.first.id] } });
  assert.deepEqual(new Set(result.categoryIds), new Set([f.third.id, f.second.id]));
  const system = (await f.api.library_list_categories()).find(c => c.isSystem);
  for (const id of [system.id, 'does-not-exist']) {
    await assert.rejects(f.api.library_update_paper_categories({ request: { paperId: f.paper.id, addCategoryIds: [id], removeCategoryIds: [f.second.id] } }), /系统分组/);
    await assert.rejects(f.api.library_assign_paper_category({ request: { paperId: f.paper.id, categoryId: id } }), /系统分组/);
  }
  assert.deepEqual((await f.api.library_list_papers({}))[0].categoryIds, result.categoryIds);
});

test('importing the same PDF into another group reuses the paper and attachment while adding that group', async t => {
  const f = await fixture(t);
  const [result] = await f.api.library_import_pdfs({ request: { paths: [f.file], importMode: 'copy', targetCategoryId: f.second.id } });
  assert.equal(result.status, 'duplicate'); assert.equal(result.paper.id, f.paper.id);
  assert.deepEqual(new Set(result.paper.categoryIds), new Set([f.first.id, f.second.id]));
  assert.deepEqual(result.paper.attachments, f.paper.attachments);
  assert.equal((await f.api.library_list_papers({})).length, 1);
});

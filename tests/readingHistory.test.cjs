const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ReadingHistory } = require('../electron/backend/readingHistory.cjs');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-history-'));
  const appPaths = { dataDir, notesDatabasePath: path.join(dataDir, 'notes.sqlite') };
  const noteStore = createNoteStore(appPaths);
  let library = { papers: [{ id: 'one', aiSummary: 'First' }, { id: 'two', aiSummary: 'Other paper' }] };
  const store = { load: () => structuredClone(library), save: async value => { library = structuredClone(value); } };
  const context = { appPaths, noteStore, store };
  context.readingHistory = new ReadingHistory(context);
  t.after(async () => { noteStore.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const request = { paperId: 'one', title: 'Report', type: 'standalone', content: 'First', contentText: 'First', tags: ['读书报告', '文献报告'] };
  return { context, request, commands: createNoteCommands(context), paper: () => store.load().papers[0] };
}

test('overview saves survive a new history instance, reject stale writers and restore the previous version', async t => {
  const { context, paper } = await fixture(t);
  const history = context.readingHistory;
  await history.saveOverview({ paperId: 'one', content: 'Second', expectedOverview: 'First' });
  await assert.rejects(history.saveOverview({ paperId: 'one', content: 'Stale', expectedOverview: 'First' }), /其他窗口/);
  assert.equal(paper().aiSummary, 'Second');
  const reopened = new ReadingHistory(context), versions = reopened.list('one');
  assert.equal(versions.length, 1);
  await reopened.restore({ paperId: 'one', id: versions[0].id, expectedOverview: 'Second' });
  assert.equal(paper().aiSummary, 'First');
  assert.equal(context.store.load().papers[1].aiSummary, 'Other paper');
  assert.ok(reopened.list('one').some(version => version.overview === 'Second'));
});

test('report edits sync matching overviews and leave independently edited overviews intact', async t => {
  const { context, commands, request, paper } = await fixture(t);
  const first = commands.notes_save_chatgpt_report({ request });
  const second = await commands.notes_save_chatgpt_report({ request: { ...request, content: 'Second', contentText: 'Second' }, expectedUpdatedAt: first.updatedAt, expectedContent: first.content });
  assert.equal(paper().aiSummary, 'Second');
  assert.equal(second.readingOverview.aiSummary, 'Second');
  await context.readingHistory.saveOverview({ paperId: 'one', content: 'My overview', expectedOverview: 'Second' });
  await commands.notes_update({ id: second.id, patch: { content: 'Third', contentText: 'Third' } });
  assert.equal(paper().aiSummary, 'My overview');
});

test('report restoration rejects stale content, retains the current report and cannot restore another paper', async t => {
  const { context, commands, request } = await fixture(t);
  const first = commands.notes_save_chatgpt_report({ request });
  const second = await commands.notes_save_chatgpt_report({ request: { ...request, content: 'Second', contentText: 'Second' }, expectedUpdatedAt: first.updatedAt, expectedContent: first.content });
  const version = context.readingHistory.list('one').find(item => item.reportText === 'First');
  await assert.rejects(context.readingHistory.restore({ paperId: 'one', id: version.id, target: 'report', expectedReportUpdatedAt: first.updatedAt, expectedReportContent: first.content }), /已被更新/);
  assert.equal(context.noteStore.getNote({ id: second.id }).contentText, 'Second');
  await assert.rejects(context.readingHistory.restore({ paperId: 'two', id: version.id, target: 'report' }));
  const result = await context.readingHistory.restore({ paperId: 'one', id: version.id, target: 'report', expectedReportUpdatedAt: second.updatedAt, expectedReportContent: second.content });
  assert.equal(result.note.id, first.id);
  assert.equal(result.note.contentText, 'First');
  assert.ok(context.readingHistory.list('one').some(item => item.reportText === 'Second'));
});

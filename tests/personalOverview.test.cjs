const test = require('node:test');
const assert = require('node:assert/strict');
const { neededFields, fillBlankSections, validatePersonalOverview, countCharacters } = require('../electron/backend/personalOverview.cjs');

test('auto-fill merges against the latest version and preserves manual edits, custom sections and deleted sections', () => {
  const before = { version: 0, content: null };
  assert.deepEqual(neededFields(before), ['overview', 'abstract']);
  let latest = { version: 2, content: [{ id: 'overview', title: '我的概括', content: '推理期间刚保存的内容' }, { id: 'abstract', title: '摘要', content: '' }, { id: 'custom', title: '重点', content: '我的重点' }] };
  const store = { getDocument: () => latest, saveDocument: request => { assert.equal(request.expectedVersion, 2); latest = { version: 3, content: request.content }; return latest; } };
  assert.deepEqual(fillBlankSections(store, 'paper', { overview: '生成的概括', abstract: '生成的摘要' }).filled, ['abstract']);
  assert.deepEqual(latest.content.map(s => s.content), ['推理期间刚保存的内容', '生成的摘要', '我的重点']);
  assert(!latest.content.some(s => s.id === 'team'));
  assert.deepEqual(neededFields({ content: [], version: 1 }), []);
});

test('unpublished drafts prevent auto-fill and word count rejects short, long or empty model output', () => {
  assert.deepEqual(neededFields({ content: null, drafts: [{ content: [] }] }), []);
  const store = { getDocument: () => ({ content: null, drafts: [{ content: [] }] }), saveDocument: () => assert.fail('draft overwritten') };
  assert.deepEqual(fillBlankSections(store, 'paper', { abstract: '摘要' }).filled, []);
  assert.equal(countCharacters('中 文\n，12'), 5);
  assert.throws(() => validatePersonalOverview({ overview: '短内容' }, ['overview']), /1000–1500/);
  assert.throws(() => validatePersonalOverview({ overview: '文'.repeat(1501) }, ['overview']), /1000–1500/);
  assert.throws(() => validatePersonalOverview({ abstract: '' }, ['abstract']), /有效摘要/);
  assert.equal(validatePersonalOverview({ overview: '文'.repeat(1000) }, ['overview']).overview.length, 1000);
});

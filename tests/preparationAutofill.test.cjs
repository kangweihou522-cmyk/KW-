const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { titleField, chineseTitleRequest, extractAbstract, translateAbstract } = require('../electron/backend/preparationAutofill.cjs');
const { TranslationMemory } = require('../electron/backend/translationMemory.cjs');

test('abstract extraction respects column bounds, spaced headings, and introduction/keyword boundaries', () => {
  const pages = [[
    { content: 'A B S T R A C T', bbox: [310, 100, 400, 115] },
    { content: 'Keywords: do not translate these keywords', bbox: [60, 120, 160, 130] },
    { content: 'The sample size was 20.', bbox: [310, 125, 500, 140] },
    { content: 'The study does not establish causality.', bbox: [310, 145, 510, 160] },
    { content: '1. Introduction', bbox: [60, 200, 200, 215] },
    { content: 'Unselected introduction about 384 chickens.', bbox: [310, 220, 510, 235] },
  ]];
  const result = extractAbstract(pages);
  assert.equal(result.text, 'The sample size was 20. The study does not establish causality.');
  assert(!result.text.includes('384')); assert(!result.text.includes('Keywords'));
  const inline = extractAbstract([[{ content: 'Abstract: The sample size was 20. The study does not establish causality.' }, { content: 'Keywords: sample' }, { content: 'Unselected content' }]]);
  assert.equal(inline.text, result.text);
  for (const label of ['ABSTRACT:', 'SUMMARY:', 'A B S T R A C T:']) {
    assert.equal(extractAbstract([[{ content: label }, { content: result.text }, { content: 'Keywords: sample' }]]).text, result.text);
  }
  assert.equal(extractAbstract([[{ content: `ABSTRACT: ${result.text}` }, { content: 'Keywords: sample' }]]).text, result.text);
});

test('abstract extraction uses source metadata when no reliable PDF abstract is found, not generated summaries', () => {
  const source = 'The sample size was 20. The study does not establish causality.';
  assert.equal(extractAbstract([[{ content: '1. Introduction' }, { content: 'Only introduction body.' }]], `<jats:p>${source}</jats:p>`).text, source);
  assert.throws(() => extractAbstract([[{ content: '1. Introduction' }, { content: 'Only introduction body.' }]]), /未可靠识别/);
  assert.throws(() => extractAbstract([[{ content: 'ABSTRACT' }, { content: 'Missing a reliable boundary and possibly incomplete text.' }]]), /未可靠识别/);
  const structured = extractAbstract([[{ content: 'ABSTRACT' }, { content: 'Background: We studied 20 samples. Methods: The controls were predefined. Results: No causal relationship was established.' }, { content: 'Keywords: control' }]]);
  assert(structured.text.startsWith('Background:'));
  assert.equal(extractAbstract([], '<p>The sample size was 20, and P &lt; 0.05 did not establish causality.</p>').text, 'The sample size was 20, and P < 0.05 did not establish causality.');
});

test('Chinese title reuses an existing field, preserves manual values and other fields, and never replaces original title', () => {
  const library = { settings: { metadataLayout: { hiddenFields: ['url'], customFields: [{ id: 'custom_existing', label: '中文标题' }, { id: 'custom_other', label: '实验方法' }] } }, papers: [{ id: 'p', title: 'Effects on broiler growth', customFields: { custom_other: '手工方法' } }] };
  assert.equal(titleField(library).id, 'custom_existing');
  const request = chineseTitleRequest(library, 'p', 'Effects on broiler growth', '对肉鸡生长的影响');
  assert.equal(request.customFields.custom_existing, '对肉鸡生长的影响'); assert.equal(request.customFields.custom_other, '手工方法');
  assert.equal(request.title, undefined); assert.deepEqual(request.metadataLayout, library.settings.metadataLayout);
  library.papers[0].customFields.custom_existing = '推理期间手工写入的标题';
  assert.equal(chineseTitleRequest(library, 'p', 'Effects on broiler growth', '生成的标题'), null);
  assert.throws(() => chineseTitleRequest(library, 'p', 'Old title', '译文'), /原标题已修改/);
});

test('Chinese title adds exactly one field when missing and avoids colliding with a differently named custom field', () => {
  const library = { settings: { metadataLayout: { hiddenFields: [], customFields: [{ id: 'custom_chinese_title', label: '其他项目' }] } }, papers: [{ id: 'p', title: 'Original title', customFields: { custom_chinese_title: '原有内容' } }] };
  const request = chineseTitleRequest(library, 'p', 'Original title', '原始标题');
  const added = request.metadataLayout.customFields.find(f => f.label === '中文标题');
  assert(added); assert.notEqual(added.id, 'custom_chinese_title'); assert.equal(request.customFields.custom_chinese_title, '原有内容');
});

test('abstract translation reuses full-text sentence caches and directly keeps an already Chinese abstract', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-abstract-')); t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const context = { appPaths: { dataDir }, qualityTranslation: { translate: async text => { calls++; return text.includes('20') ? '样本量为20。' : '该研究未建立因果关系。'; } } };
  const memory = new TranslationMemory(context);
  const abstract = { text: 'The sample size was 20. The study does not establish causality.', pageIndex: 0 };
  for (const text of ['The sample size was 20.', 'The study does not establish causality.']) await memory.translate(text, { documentId: 'p', pageIndex: 0, source: 'English', target: 'Chinese', background: true });
  const result = await translateAbstract(abstract, memory, { documentId: 'p' });
  assert.equal(result.translation, '样本量为20。该研究未建立因果关系。'); assert.equal(result.cached, 2); assert.equal(calls, 2);
  assert.equal((await translateAbstract({ text: result.translation }, memory, { documentId: 'p' })).translation, result.translation); assert.equal(calls, 2);
});

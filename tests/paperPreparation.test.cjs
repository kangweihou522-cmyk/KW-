const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { createPreparationCommands, translationUnits } = require('../electron/backend/paperPreparation.cjs');
const { TranslationMemory } = require('../electron/backend/translationMemory.cjs');
const { validateMetadata } = require('../electron/backend/localMetadata.cjs');
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-preparation-')); t.after(() => fs.rm(dataDir, { force: true, recursive: true }));
  const pdfPath = path.join(dataDir, 'paper.pdf'); await fs.writeFile(pdfPath, 'PDF fixture');
  let paper = { id: 'test', title: 'Complete paper title', aiSummary: '', authors: [], attachments: [{ kind: 'pdf', storedPath: pdfPath }] }; let parses = 0; let calls = 0; let summaries = 0;
  let personal = { version: 0, content: null, drafts: [] }; let settings = {};
  paper.abstractText = 'The sample size was 20. The second page reports no causal relationship.';
  const context = { appPaths: { dataDir }, store: { load: () => ({ settings: structuredClone(settings), papers: [structuredClone(paper)] }) }, noteStore: { getDocument: (id) => id === '__translation__' ? { content: [] } : structuredClone(personal), saveDocument: request => { assert.equal(request.expectedVersion, personal.version); personal = { ...personal, content: request.content, version: personal.version + 1 }; return structuredClone(personal); }, listNotes: () => [] }, qualityTranslation: { lock: { model: { sha256: 'test-model' } }, translate: async () => { calls++; return '译文 n=20。'; } } };
  context.translationMemory = new TranslationMemory(context);
  const commands = {
    run_mineru_cloud_parse: async () => { parses++; return { contentJsonText: JSON.stringify([[{ content: 'Complete paper title. doi: 10.1234/paper. The sample size was 20.' }], [{ content: 'The second page reports no causal relationship.' }]]), markdownText: '# Page 1\nThe sample size was 20.\n# Page 2\nNo causal relationship.', warnings: [], contentJsonPath: 'cached.json' }; },
    lookup_literature_metadata: async () => { throw new Error('Registry unavailable'); },
    library_update_paper: async ({ request }) => { paper = { ...paper, ...request }; if (request.metadataLayout) settings.metadataLayout = request.metadataLayout; },
    summarize_document_openai_compatible: async () => { summaries++; return { overview: '本地概览', background: '背景', keyFindings: ['n=20'], takeaways: [] }; },
    summarize_personal_overview_local: async () => ({ overview: '论文概括。'.repeat(162) }),
    notes_save_chatgpt_report: async () => ({}),
  };
  const api = createPreparationCommands(context, commands);
  const untilDone = async () => { for (let i = 0; i < 200; i++) { const state = await api.paper_prepare_status({ paperId: 'test' }); if (!state?.running) return state; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('preparation did not finish'); };
  return { api, commands, context, untilDone, get counts() { return { parses, calls, summaries }; }, get paper() { return paper; } };
}
test('one-click processing preserves successful stages on registry failure, resumes cached translation and does not overwrite an edited overview', async t => {
  const f = await fixture(t); await f.api.paper_prepare_start({ paperId: 'test' });
  const first = await f.untilDone(); assert.equal(first.status, 'partial'); assert.equal(first.steps.metadata.status, 'error'); assert.equal(first.steps.translation.status, 'done'); assert.equal(first.steps.overview.status, 'done');
  assert.equal(first.steps.personal.status, 'done');
  const personal = f.context.noteStore.getDocument('test');
  assert.equal(personal.content.find(s => s.id === 'overview').content.length, 810);
  assert.match(personal.content.find(s => s.id === 'abstract').content, /译文 n=20/);
  assert.equal(first.steps.title.status, 'done'); assert.equal(first.steps.abstract.status, 'done');
  assert.equal(f.paper.aiSummary.includes('本地概览'), true);
  await f.commands.library_update_paper({ request: { aiSummary: '我的手工概览' } });
  await f.api.paper_prepare_start({ paperId: 'test' }); await f.untilDone();
  assert.equal(f.counts.parses, 1); assert.equal(f.counts.summaries, 1); assert.equal(f.paper.aiSummary, '我的手工概览');
  assert.equal((await f.api.paper_translation_get({ paperId: 'test' })).units.length, first.completed);
});
test('pause, resume, duplicate start and stop preserve completed chunks', async t => {
  const f = await fixture(t); let release; let started;
  const ready = new Promise(resolve => { started = resolve; });
  f.context.qualityTranslation.translate = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  await f.api.paper_prepare_start({ paperId: 'test', mode: 'translation' }); await ready;
  await f.api.paper_prepare_control({ paperId: 'test', action: 'pause' }); release('第一段');
  for (let i = 0; i < 200 && (await f.api.paper_prepare_status({ paperId: 'test' })).completed < 1; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const same = await f.api.paper_prepare_start({ paperId: 'test' }); assert.equal(same.paused, true); assert.equal(same.completed, 1);
  await f.api.paper_prepare_control({ paperId: 'test', action: 'stop' }); assert.equal((await f.untilDone()).status, 'stopped');
  f.context.qualityTranslation.translate = async () => '剩余段落';
  await f.api.paper_prepare_start({ paperId: 'test', mode: 'translation' }); const final = await f.untilDone(); assert.equal(final.cached, 1); assert.equal(final.completed, final.total); assert(final.completed >= 2);
});
test('source-verified local metadata rejects invented author, year, DOI and publisher-as-author', () => {
  const result = validateMetadata({ title: 'Complete paper title', authors: ['Jane Smith', 'MDPI', 'Invented Person'], year: '2026', doi: '10.9999/invented', publication: 'Journal of Evidence' }, 'Complete paper title\nJane Smith\nJournal of Evidence\n2024');
  assert.deepEqual(result.authors, ['Jane Smith']); assert.equal(result.year, undefined); assert.equal(result.doi, undefined); assert.equal(result.title, 'Complete paper title');
});
test('translation paragraph grouping preserves page boundaries and PDF hyphenation', () => {
  const units = translationUnits([[{ content: 'The treat-' }, { content: 'ment reduced pressure.' }], [{ content: 'Different page.' }]]);
  assert.equal(units[0].text, 'The treatment reduced pressure.'); assert.equal(units[1].pageIndex, 1);
});
test('next-page prefetch shares persistent memory with subsequent reading and prepared text restores without re-parsing', async t => {
  const f = await fixture(t); f.context.qualityTranslation.status = async () => ({ ready: true });
  await f.api.paper_translation_prefetch({ paperId: 'test', pageIndex: 0, requestId: 'prefetch' });
  const source = await f.api.paper_prepared_source({ paperId: 'test' }); assert.equal(source.pages.length, 2);
  const cached = await f.context.translationMemory.translate('The second page reports no causal relationship.', { documentId: 'native-library:test', source: 'English' });
  assert.equal(cached.cacheMatch, 'exact'); assert.deepEqual(f.counts, { parses: 1, calls: 1, summaries: 0 });
});

test('a failed overview model does not block original-abstract translation or Chinese title, and is not called twice', async t => {
  const f = await fixture(t); let attempts = 0;
  f.commands.summarize_document_openai_compatible = async () => { attempts++; throw new Error('概览模型调用失败'); };
  await f.api.paper_prepare_start({ paperId: 'test' }); const state = await f.untilDone();
  assert.equal(state.steps.overview.status, 'error'); assert.equal(state.steps.personal.status, 'error');
  assert.equal(state.steps.title.status, 'done'); assert.equal(state.steps.abstract.status, 'done'); assert.equal(attempts, 1);
  assert(f.paper.customFields.custom_chinese_title);
  assert(f.context.noteStore.getDocument('test').content.find(s => s.id === 'abstract').content.includes('译文'));
  assert.equal(state.steps.translation.status, 'done');
});

test('unidentified original abstract leaves that field alone while title and any-length overview still fill', async t => {
  const f = await fixture(t);
  await f.commands.library_update_paper({ request: { abstractText: '' } });
  f.commands.summarize_personal_overview_local = async () => ({ overview: '研究未证明因果关系。' });
  await f.api.paper_prepare_start({ paperId: 'test' }); const state = await f.untilDone();
  assert.equal(state.steps.abstract.status, 'error'); assert.equal(state.steps.title.status, 'done'); assert.equal(state.steps.personal.status, 'done');
  const sections = f.context.noteStore.getDocument('test').content;
  assert.equal(sections.find(s => s.id === 'overview').content, '研究未证明因果关系。'); assert.equal(sections.find(s => s.id === 'abstract').content, '');
});

test('selected title and abstract run without metadata, overview or full translation', async t => {
  const f = await fixture(t);
  f.commands.lookup_literature_metadata = async () => { assert.fail('unselected metadata ran'); };
  f.commands.summarize_personal_overview_local = async () => { assert.fail('unselected personal overview ran'); };
  await f.api.paper_prepare_start({ paperId: 'test', selectedSteps: ['abstract', 'title', 'abstract'] });
  const state = await f.untilDone();
  assert.equal(state.status, 'done'); assert.deepEqual(state.selectedSteps, ['title', 'abstract']);
  assert.deepEqual(Object.keys(state.steps), ['parse', 'title', 'abstract']);
  assert.equal(f.counts.summaries, 0); assert.equal(f.paper.aiSummary, '');
  assert(f.paper.customFields.custom_chinese_title);
  assert.equal(await f.api.paper_translation_get({ paperId: 'test' }), null);
});

test('personal overview alone analyzes evidence but does not save the unselected AI overview or translate', async t => {
  const f = await fixture(t);
  await f.api.paper_prepare_start({ paperId: 'test', selectedSteps: ['personal'] });
  const state = await f.untilDone();
  assert.equal(state.status, 'done'); assert.deepEqual(Object.keys(state.steps), ['parse', 'personal']);
  assert.deepEqual(f.counts, { parses: 1, calls: 0, summaries: 1 });
  assert.equal(f.paper.aiSummary, ''); assert.equal(f.paper.customFields, undefined);
  const content = f.context.noteStore.getDocument('test').content;
  assert.equal(content.find(s => s.id === 'overview').content.length, 810);
  assert.equal(content.find(s => s.id === 'abstract').content, '');
});

for (const step of ['parse', 'metadata', 'overview', 'translation']) test(`only selected ${step} and required parsing execute`, async t => {
  const f = await fixture(t);
  await f.api.paper_prepare_start({ paperId: 'test', selectedSteps: [step] });
  const state = await f.untilDone();
  assert.deepEqual(Object.keys(state.steps), step === 'parse' ? ['parse'] : ['parse', step]);
  assert.equal(f.counts.calls > 0, step === 'translation');
  assert.equal(f.counts.summaries, step === 'overview' ? 1 : 0);
  assert.equal(f.context.noteStore.getDocument('test').content, null);
});

test('empty and unknown selections are rejected before any processing', async t => {
  const f = await fixture(t);
  for (const selectedSteps of [[], ['bogus'], ['title', 'bogus'], 'translation', null]) {
    await assert.rejects(f.api.paper_prepare_start({ paperId: 'test', selectedSteps }), /至少选择/);
  }
  assert.deepEqual(f.counts, { parses: 0, calls: 0, summaries: 0 });
  assert.equal(await f.api.paper_prepare_status({ paperId: 'test' }), null);
});

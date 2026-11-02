const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
const { metadataAddress } = require('../electron/backend/metadataHttp.cjs');

const doi = '10.1234/fixture';
const record = { DOI: doi, title: ['Effects of dietary supplementation on growth performance'], author: Array.from({ length: 12 }, (_, i) => ({ given: `Author${i + 1}`, family: 'Tests' })), 'container-title': ['Journal of Evidence'], volume: '105', issue: '2', page: 'e123', published: { 'date-parts': [[2024, 3, 12]] }, issued: { 'date-parts': [[2024]] } };
async function fixture(t, json) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-registry-'));
  const appPaths = { dataDir, configPath: path.join(dataDir, 'config.json'), libraryPath: path.join(dataDir, 'library.json'), libraryDatabasePath: path.join(dataDir, 'library.sqlite') };
  const store = createLibraryStore(appPaths);
  const commands = createLibraryCommands({ appPaths, store, metadataJson: json });
  t.after(async () => { store.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { commands, store };
}

test('DOI lookup corrects truncated metadata with the complete formal record and bypasses generic fetch', async t => {
  let calls = 0;
  const f = await fixture(t, async url => { calls++; assert.equal(new URL(url).hostname, 'api.crossref.org'); assert(!url.includes('private PDF text')); return { message: record }; });
  const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error('Generic fetch is deliberately local-only.'); };
  try {
    const result = await f.commands.lookup_literature_metadata({ request: { doi: `https://doi.org/${doi}`, title: 'Effects of dietary supplementation', firstPageText: `private PDF text ${record.title[0]} ${doi}` } });
    assert.equal(result.verified, true); assert.equal(result.matchedBy, 'doi'); assert.equal(result.title, record.title[0]);
    assert.equal(result.authors.length, 12); assert.equal(result.publication, 'Journal of Evidence'); assert.equal(result.volume, '105'); assert.equal(result.issue, '2'); assert.equal(result.year, '2024'); assert.equal(result.publishedDate, '2024-03-12');
    await f.commands.lookup_literature_metadata({ request: { doi } }); assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('wrong returned DOI and a DOI belonging to a cited paper cannot silently replace this paper', async t => {
  const a = await fixture(t, async () => ({ message: { ...record, DOI: '10.1234/other' } }));
  assert.equal(await a.commands.lookup_literature_metadata({ request: { doi } }), null);
  const b = await fixture(t, async () => ({ message: record }));
  assert.equal(await b.commands.lookup_literature_metadata({ request: { doi, title: 'Completely unrelated quantum computing methods', firstPageText: 'Completely unrelated quantum computing methods. A citation appears here.' } }), null);
});

test('title-only lookup accepts a unique close match and rejects unrelated or ambiguous top results', async t => {
  for (const [items, expected] of [[[record], true], [[{ ...record, title: ['Another completely different article'] }], false], [[record, { ...record, DOI: '10.1234/duplicate' }], false]]) {
    const f = await fixture(t, async () => ({ message: { items } }));
    const result = await f.commands.lookup_literature_metadata({ request: { title: record.title[0] } });
    assert.equal(!!result, expected);
  }
});

test('network failures are distinct from a registry record not found', async t => {
  const f = await fixture(t, async () => { throw new Error('Registry connection failed'); });
  await assert.rejects(f.commands.lookup_literature_metadata({ request: { doi } }), /connection failed/);
  const missing = await fixture(t, async () => { const error = new Error('Not found'); error.status = 404; throw error; });
  assert.equal(await missing.commands.lookup_literature_metadata({ request: { doi } }), null);
  for (const url of ['http://api.crossref.org/works', 'https://example.invalid/works', 'https://user:password@api.crossref.org/works']) assert.throws(() => metadataAddress(url), /来源/);
});

test('shared field layout and separate per-paper values survive snapshots without clearing hidden URLs', async t => {
  const f = await fixture(t, async () => ({ message: record }));
  const paths = ['one.pdf', 'two.pdf'].map(name => path.join(f.store.load().settings.storageDir, name));
  await fs.mkdir(path.dirname(paths[0]), { recursive: true });
  await Promise.all(paths.map((file, i) => fs.writeFile(file, `%PDF-1.4 fixture ${i}`)));
  const imported = await f.commands.library_import_pdfs({ request: { paths, importMode: 'keep' } });
  const [a, b] = imported.map(item => item.paper);
  const metadataLayout = { hiddenFields: ['url'], customFields: [{ id: 'custom_chinese', label: '中文标题' }] };
  await f.commands.library_update_paper({ request: { paperId: a.id, url: 'https://example.invalid/retained', metadataLayout, customFields: { custom_chinese: '第一篇中文标题' } } });
  await f.commands.library_update_paper({ request: { paperId: b.id, customFields: { custom_chinese: '第二篇中文标题' } } });
  const snapshot = path.join(path.dirname(f.store.load().settings.storageDir), 'snapshot.sqlite'); f.store.snapshotTo(snapshot);
  const saved = f.store.loadFromSnapshot(snapshot);
  assert.deepEqual(saved.settings.metadataLayout, metadataLayout);
  assert.equal(saved.papers.find(p => p.id === a.id).customFields.custom_chinese, '第一篇中文标题');
  assert.equal(saved.papers.find(p => p.id === b.id).customFields.custom_chinese, '第二篇中文标题');
  assert.equal(saved.papers.find(p => p.id === a.id).url, 'https://example.invalid/retained');
  await assert.rejects(f.commands.library_update_paper({ request: { paperId: a.id, metadataLayout: { hiddenFields: ['title'], customFields: [] } } }), /项目/);
});

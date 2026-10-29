import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const {
  createReferenceExchangeCommands, parseEndNoteXml, parseRis,
  exportEndNoteXml, exportRis, normalizeMetrics,
} = require('../electron/backend/referenceExchangeCommands.cjs');

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-reference-'));
  const appPaths = {
    dataDir, configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
  };
  const store = createLibraryStore(appPaths);
  const opened = [];
  const commands = createReferenceExchangeCommands({ store, appPaths,
    shell: { async openPath(value) { opened.push(value); return ''; } },
  });
  t.after(async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { commands, store, appPaths, opened };
}

const exampleXml = `<?xml version="1.0" encoding="UTF-8"?><xml><records><record>
  <titles><title>Controls &amp; evidence</title><secondary-title>Journal of Tests</secondary-title></titles>
  <contributors><authors><author>李明</author><author>Smith, Alice</author></authors></contributors>
  <dates><year>2024</year></dates><electronic-resource-num>https://doi.org/10.1234/TEST</electronic-resource-num>
  <abstract>Abstract &lt;without executable HTML&gt;</abstract><research-notes>My appraisal\nSecond line</research-notes>
  <keywords><keyword>control</keyword><keyword>证据</keyword></keywords>
  <urls><web-urls><url>https://example.invalid/paper</url></web-urls></urls>
</record></records></xml>`;

test('EndNote XML and RIS preserve metadata and manual notes through the real SQLite library', async (t) => {
  const { commands, store } = await fixture(t);
  assert.deepEqual(await commands.library_import_references({ format: 'endnote-xml', content: exampleXml }),
    { imported: 1, skipped: 0, warnings: [] });
  const paper = store.load().papers[0];
  assert.equal(paper.title, 'Controls & evidence');
  assert.equal(paper.doi, '10.1234/test');
  assert.equal(paper.year, '2024');
  assert.equal(paper.publication, 'Journal of Tests');
  assert.deepEqual(paper.authors.map((author) => author.name), ['李明', 'Smith, Alice']);
  assert.equal(paper.userNote, 'My appraisal\nSecond line');
  assert.deepEqual(paper.keywords, ['control', '证据']);
  const xml = await commands.library_export_references({ format: 'endnote-xml' });
  const fromXml = parseEndNoteXml(xml)[0];
  const ris = await commands.library_export_references({ format: 'ris' });
  const fromRis = parseRis(ris)[0];
  for (const record of [fromXml, fromRis]) {
    assert.equal(record.title, paper.title);
    assert.equal(record.userNote, paper.userNote);
    assert.equal(record.doi, paper.doi);
    assert.equal(record.publication, paper.publication);
    assert.deepEqual(record.authors, paper.authors.map((author) => author.name));
  }
  assert.equal((await commands.library_import_references({ format: 'ris', content: ris })).skipped, 1);
  assert.equal(store.load().papers.length, 1);
});

test('local EndNote attachment references and supplements copy safely while retaining the main PDF', async (t) => {
  const { commands, store, appPaths, opened } = await fixture(t);
  const endnoteFolder = path.join(appPaths.dataDir, 'EndNote PDF');
  await mkdir(endnoteFolder);
  const originalPdf = path.join(endnoteFolder, 'paper.pdf');
  await writeFile(originalPdf, '%PDF-1.4\nlocal original\n');
  const xml = exampleXml.replace('</record>', '<urls><pdf-urls><url>internal-pdf://paper.pdf</url></pdf-urls></urls></record>');
  await commands.library_import_references({ format: 'endnote-xml', content: xml, attachmentBaseDir: endnoteFolder });
  const paper = store.load().papers[0];
  assert.equal(paper.attachments.length, 1);
  assert.equal(paper.attachments[0].kind, 'pdf');
  assert.notEqual(paper.attachments[0].storedPath, originalPdf);
  const supplement = path.join(appPaths.dataDir, 'supporting data.csv');
  await writeFile(supplement, 'group,n\ncontrol,20\n');
  const stale = store.load();
  stale.papers[0].aiSummary = 'Old report without supplementary evidence';
  await store.save(stale);
  await commands.library_add_supplement({ paperId: paper.id, paths: [supplement] });
  const persisted = store.load().papers[0];
  assert.equal(persisted.aiSummary, null, 'new evidence invalidates the persisted old report');
  assert.equal(persisted.attachments.length, 2);
  const attachment = persisted.attachments.find((item) => item.kind === 'supplement');
  assert.equal(await readFile(attachment.storedPath, 'utf8'), 'group,n\ncontrol,20\n');
  assert.equal(await readFile(originalPdf, 'utf8'), '%PDF-1.4\nlocal original\n');
  const refreshed = store.load();
  refreshed.papers[0].aiSummary = 'Report that already includes the supplement';
  await store.save(refreshed);
  await commands.library_add_supplement({ paperId: paper.id, paths: [supplement] });
  assert.equal(store.load().papers[0].attachments.length, 2, 'content hash prevents duplicate attachments');
  assert.equal(store.load().papers[0].aiSummary, 'Report that already includes the supplement', 'unchanged duplicate does not invalidate a current report');
  assert.deepEqual(await commands.open_library_attachment({ paperId: paper.id, attachmentId: attachment.id }), { opened: true });
  assert.deepEqual(opened, [attachment.storedPath]);
  await assert.rejects(commands.open_library_attachment({ paperId: paper.id, attachmentId: 'arbitrary-path' }), /未找到/);
  const executable = path.join(appPaths.dataDir, 'untrusted.exe');
  await writeFile(executable, 'not an allowed attachment');
  await assert.rejects(commands.library_add_supplement({ paperId: paper.id, paths: [executable] }), /请选择本地/);
  assert.equal(store.load().papers[0].attachments.length, 2);
});

test('EndNote imports never resolve remote attachment URLs or XML entities', async (t) => {
  const { commands, store } = await fixture(t);
  assert.throws(() => parseEndNoteXml('<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///etc/passwd">]><xml><record><title>&x;</title></record></xml>'), /DTD/);
  const ris = 'TY  - JOUR\nTI  - Remote attachment\nL1  - https://example.invalid/private.pdf\nER  - \n';
  const result = await commands.library_import_references({ format: 'ris', content: ris });
  assert.equal(result.imported, 1);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(store.load().papers[0].attachments, []);
  assert.throws(() => parseRis('TY  - JOUR\nTI  - Incomplete\n'), /ER/);
});

test('journal metrics persist annual source and unknown fields independently without inventing values', async (t) => {
  const { commands, appPaths } = await fixture(t);
  const csv = 'journal,issn,year,source,category,impactFactor,jcrQuartile,casPartition\n"Journal, Tests",1234-567X,2023,Imported data,Medicine,,Q2,\n"Journal, Tests",1234-567X,2024,Imported data,Medicine,3.2,Q1,2\n';
  assert.deepEqual(await commands.library_import_journal_metrics({ content: csv, format: 'csv' }), { imported: 2, total: 2 });
  const rows = await commands.library_get_journal_metrics({ issn: '1234-567x' });
  assert.deepEqual(rows.map((row) => row.year), [2024, 2023]);
  assert.equal(rows[0].impactFactor, 3.2);
  assert.equal(rows[1].impactFactor, null);
  assert.equal(rows[1].casPartition, null);
  assert.equal(rows[1].source, 'Imported data');
  const onDisk = JSON.parse(await readFile(path.join(appPaths.dataDir, 'journal-metrics.json'), 'utf8'));
  assert.equal(onDisk.length, 2);
  const selectedYear = await commands.library_get_journal_metrics({ journal: 'Journal, Tests', year: 2023 });
  assert.equal(selectedYear.length, 1);
  assert.equal(selectedYear[0].jcrQuartile, 'Q2');
  assert.throws(() => normalizeMetrics([{ journal: 'Tests', year: 2024, impactFactor: 3.2 }]), /年度及数据来源/);
  assert.throws(() => normalizeMetrics([{ journal: 'Tests', year: 2024, source: 'User', jcrQuartile: 'Q7' }]), /Q1/);
  assert.throws(() => normalizeMetrics([{ journal: 'Tests', year: 2024, source: 'User', impactFactor: -1 }]), /影响因子/);
  assert.deepEqual(await commands.library_get_journal_metrics({ journal: 'Unknown' }), []);
});

test('reveal PDF resolves only a registered paper attachment and rejects missing files', async (t) => {
  const { store, appPaths } = await fixture(t);
  const file = path.join(appPaths.dataDir, 'test 科研.pdf');
  await writeFile(file, '%PDF-1.7\n');
  await createReferenceExchangeCommands({ store, appPaths }).library_import_references({ format: 'ris', content: `TY  - JOUR\nTI  - Reveal test\nL1  - ${file}\nER  - \n` });
  const paper = store.load().papers[0];
  const revealed = [];
  const commands = createReferenceExchangeCommands({ store, appPaths, shell: { showItemInFolder: (value) => revealed.push(value) } });
  await commands.library_reveal_pdf({ paperId: paper.id, path: '/unregistered.pdf' });
  assert.deepEqual(revealed, [paper.attachments[0].storedPath]);
  await assert.rejects(commands.library_reveal_pdf({ paperId: 'missing' }), /未登记/);
  await rm(paper.attachments[0].storedPath);
  await assert.rejects(commands.library_reveal_pdf({ paperId: paper.id }), /不存在/);
});

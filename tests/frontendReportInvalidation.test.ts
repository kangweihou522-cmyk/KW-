import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { buildPaperSummarySourceKey } from '../src/features/reader/documentReaderSummarySource.ts';

test('adding saved supplements invalidates report work without re-parsing the unchanged main PDF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paperdesk-revision-ui-'));
  try {
    const outfile = join(directory, 'shared.mjs');
    await build({ bundle: true, entryPoints: ['src/features/reader/readerShared.ts'], format: 'esm', outfile, platform: 'node' });
    const shared = await import(pathToFileURL(outfile).href);
    const paper = { id: 'paper-1', title: 'Paper', year: '2025', authors: [], attachments: [{ id: 'main', kind: 'pdf', storedPath: '/papers/main.pdf', originalPath: '/papers/main.pdf', fileName: 'main.pdf', missing: false }] };
    const before = shared.createNativeLibraryWorkspaceItem(paper);
    const after = shared.createNativeLibraryWorkspaceItem({ ...paper, attachments: [...paper.attachments, { id: 'supplement', kind: 'supplement', storedPath: '/papers/supplement.csv', fileName: 'supplement.csv', contentHash: 'known-file-hash', fileSize: 50 }] });
    assert.equal(before.itemKey, 'paper-1');
    assert.notEqual(before.reportRevision, after.reportRevision);
    assert.equal(shared.getAutoParseAttemptKey(before), shared.getAutoParseAttemptKey(after));
    assert.notEqual(shared.getAutoSummaryAttemptKey(before, 'mineru-markdown', 'Chinese', true), shared.getAutoSummaryAttemptKey(after, 'mineru-markdown', 'Chinese', true));
    const options = { promptVersion: 'test', summaryLanguage: 'Chinese', summarySourceMode: 'mineru-markdown' as const, pdfSource: null, pdfPath: '/papers/main.pdf', currentPdfName: 'main.pdf', mineruPath: '/cache/full.md', currentJsonName: 'content.json', blockCount: 2 };
    assert.notEqual(buildPaperSummarySourceKey({ ...options, item: before }), buildPaperSummarySourceKey({ ...options, item: after }));
    assert.equal(shared.DEFAULT_SETTINGS.autoMineruParse, true);
    assert.equal(shared.DEFAULT_SETTINGS.autoGenerateSummary, true);
    assert.equal(shared.DEFAULT_SETTINGS.summarySourceMode, 'mineru-markdown');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { paperDoi, isPublisherAuthor } from '../src/utils/bibliographicEvidence.ts';
import { mergeRemoteMetadataIntoDraft } from '../src/features/literature/importMetadata.ts';

test('PDF evidence recognizes footer DOIs and does not label a publisher as an author', () => {
  assert.equal(paperDoi('Full paper title\n' + 'Abstract '.repeat(500) + 'https://doi.org/10.1016/j.psj.2026.106648.'), '10.1016/j.psj.2026.106648');
  assert.equal(paperDoi('doi: 10.1002/(SICI)1099-1234(1999)1:2'), '10.1002/(sici)1099-1234(1999)1:2');
  assert(isPublisherAuthor('MDPI')); assert(isPublisherAuthor('Elsevier B.V.')); assert(!isPublisherAuthor('Kangwei Hou'));
});

test('a verified record replaces PDF guesses but retains fields manually edited in the import dialog', () => {
  const draft = { path: '/papers/short.pdf', title: 'Effect of Dietary Supplementation', authors: 'MDPI', year: '2026', publication: '', doi: '10.1234/test', url: '', abstractText: '', categoryId: '' };
  const metadata = { source: 'crossref', verified: true, title: 'Effect of Dietary Supplementation on Growth and Intestinal Barrier Function', authors: ['Alice Tests', 'Bob Tests'], year: '2023', publication: 'Journal of Tests', volume: '12', publishedDate: '2023-04-05', doi: '10.1234/test', url: null, abstractText: null };
  const filled = mergeRemoteMetadataIntoDraft(draft, metadata);
  assert.equal(filled.title, metadata.title); assert.equal(filled.authors, 'Alice Tests; Bob Tests'); assert.equal(filled.year, '2023'); assert.equal(filled.volume, '12');
  const manual = mergeRemoteMetadataIntoDraft({ ...draft, title: '我的手工标题', manualFields: ['title'] }, metadata);
  assert.equal(manual.title, '我的手工标题'); assert.equal(manual.authors, 'Alice Tests; Bob Tests');
});

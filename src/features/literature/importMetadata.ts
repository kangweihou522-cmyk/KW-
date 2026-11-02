import type { LocalPdfMetadataPreview, MetadataLookupResult } from '../../types/metadata';
import { getFileNameFromPath } from '../../utils/text.ts';
import type { ImportDraftItem } from './importTypes';

const GENERIC_TITLE_TOKENS = [
  'untitled',
  'document',
  'article',
  'paper',
  'pdf',
  'download',
  '中国知网',
  'cnki',
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTitleKey(value: string): string {
  return normalizeWhitespace(value)
    .toLocaleLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeAuthors(authors: string[]): string {
  return authors
    .map((author) => normalizeWhitespace(author))
    .filter(Boolean)
    .join(', ');
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function draftText(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

function titleLooksGeneric(title: string): boolean {
  const normalized = normalizeWhitespace(title).toLocaleLowerCase();

  if (!normalized || normalized.length < 6) {
    return true;
  }

  return GENERIC_TITLE_TOKENS.some((token) => normalized.includes(token));
}

export function canAutoReplaceTitle(currentTitle: string, path: string): boolean {
  const normalizedCurrent = normalizeTitleKey(currentTitle);

  if (!normalizedCurrent) {
    return true;
  }

  return (
    normalizedCurrent === normalizeTitleKey(titleFromPdfPath(path)) ||
    titleLooksGeneric(currentTitle)
  );
}

function selectTitle(
  currentTitle: string,
  path: string,
  candidateTitle: string | null | undefined,
): string {
  if (!hasValue(candidateTitle)) {
    return currentTitle;
  }

  const normalizedCandidate = normalizeWhitespace(candidateTitle);

  if (normalizeTitleKey(currentTitle) === normalizeTitleKey(normalizedCandidate)) {
    return normalizedCandidate;
  }

  return canAutoReplaceTitle(currentTitle, path) ? normalizedCandidate : currentTitle;
}

export function titleFromPdfPath(path: string): string {
  return getFileNameFromPath(path).replace(/\.pdf$/i, '') || 'Untitled PDF';
}

export function mergeLocalPdfMetadataIntoDraft(
  draft: ImportDraftItem,
  metadata: LocalPdfMetadataPreview,
): ImportDraftItem {
  const nextAuthors = normalizeAuthors(metadata.authors);

  const next = {
    ...draft,
    firstPageText: metadata.firstPageText || '',
    evidenceTitle: metadata.title,
    title: selectTitle(draft.title, draft.path, metadata.title),
    authors: draft.authors.trim() || nextAuthors || draft.authors,
    year: draft.year.trim() || normalizeWhitespace(metadata.year ?? '') || draft.year,
    publication:
      draft.publication.trim() ||
      normalizeWhitespace(metadata.publication ?? '') ||
      draft.publication,
    doi: draft.doi.trim() || normalizeWhitespace(metadata.doi ?? '') || draft.doi,
  };
  for (const key of draft.manualFields || []) if (key in draft) Object.assign(next, { [key]: draft[key as keyof ImportDraftItem] });
  return next;
}

export function mergeRemoteMetadataIntoDraft(
  draft: ImportDraftItem,
  metadata: MetadataLookupResult,
): ImportDraftItem {
  const nextAuthors = normalizeAuthors(metadata.authors);
  if (metadata.verified) {
    const next = { ...draft };
    const manual = new Set(draft.manualFields || []);
    for (const key of ['title', 'year', 'publication', 'volume', 'issue', 'pages', 'publishedDate', 'doi'] as const) {
      if (!manual.has(key) && metadata[key]?.trim()) next[key] = metadata[key]!.trim();
    }
    if (!manual.has('authors') && metadata.authors.length) { next.authors = metadata.authors.join('; '); next.resolvedAuthors = metadata.authors; }
    return next;
  }


  return {
    ...draft,
    volume: draft.volume || metadata.volume || null,
    issue: draft.issue || metadata.issue || null,
    pages: draft.pages || metadata.pages || null,
    publishedDate: draft.publishedDate || metadata.publishedDate || null,
    title: selectTitle(draft.title, draft.path, metadata.title),
    authors: draft.authors.trim() || nextAuthors || draft.authors,
    year: draft.year.trim() || normalizeWhitespace(metadata.year ?? '') || draft.year,
    publication:
      draft.publication.trim() ||
      normalizeWhitespace(metadata.publication ?? '') ||
      draft.publication,
    doi: draft.doi.trim() || normalizeWhitespace(metadata.doi ?? '') || draft.doi,
    url: draftText(draft.url).trim() || normalizeWhitespace(metadata.url ?? '') || draftText(draft.url),
    abstractText:
      draftText(draft.abstractText).trim() ||
      normalizeWhitespace(metadata.abstractText ?? '') ||
      draftText(draft.abstractText),
  };
}

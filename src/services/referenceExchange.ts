import { invoke } from '../platform/electron/core';
import type { LiteraturePaper } from '../types/library';
import { emitLibraryDataChanged } from '../features/literature/libraryEvents';

export type ReferenceFormat = 'ris' | 'endnote-xml';

export interface JournalMetric {
  journal: string;
  issn: string | null;
  year: number;
  source: string;
  category: string | null;
  impactFactor: number | null;
  jcrQuartile: string | null;
  casPartition: number | null;
  updatedAt: number;
}

export async function importReferences(format: ReferenceFormat, content: string, attachmentBaseDir = '') {
  const result = await invoke<{ imported: number; skipped: number; warnings: string[] }>('library_import_references', { format, content, attachmentBaseDir });
  emitLibraryDataChanged();
  return result;
}

export function exportReferences(format: ReferenceFormat, paperIds?: string[]) {
  return invoke<string>('library_export_references', { format, paperIds });
}

export async function addPaperSupplements(paperId: string, paths: string[]) {
  const result = await invoke<LiteraturePaper>('library_add_supplement', { paperId, paths });
  emitLibraryDataChanged();
  return result;
}

export async function importJournalMetrics(content: string, format: 'json' | 'csv') {
  const result = await invoke<{ imported: number; total: number }>('library_import_journal_metrics', { content, format });
  emitLibraryDataChanged();
  return result;
}

export function getJournalMetrics(journal = '', year: number | null = null) {
  return invoke<JournalMetric[]>('library_get_journal_metrics', { journal, year });
}

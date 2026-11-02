import { invoke } from '../platform/electron/core.ts';
import type { WorkspaceItem } from '../types/reader';
export async function readPreparedSource(item: WorkspaceItem) {
  if (item.source !== 'native-library' || typeof window === 'undefined' || !window.paperquay) return null;
  return invoke<{ pages: unknown; markdown: string; jsonPath: string; warnings: string[] } | null>('paper_prepared_source', { paperId: item.itemKey }).catch(() => null);
}

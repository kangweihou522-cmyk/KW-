import { extractLocalPdfMetadataPreview } from './pdfMetadata';
import { invoke } from '../platform/electron/core';
import type {
  MetadataLookupRequest,
  MetadataLookupResult,
} from '../types/metadata';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function lookupLiteratureMetadata(
  request: MetadataLookupRequest,
): Promise<MetadataLookupResult | null> {
  try {
    let prepared = request;
    if (request.path && request.firstPageText === undefined) {
      const local = await extractLocalPdfMetadataPreview(request.path).catch(() => null);
      if (local) prepared = { ...request, doi: local.doi || request.doi, title: local.title || request.title, evidenceTitle: local.title, firstPageText: local.firstPageText || '' };
    }
    return await invoke<MetadataLookupResult | null>('lookup_literature_metadata', { request: prepared });
  } catch (error) {
    throw new Error(toErrorMessage(error, '自动补全文献元数据失败'));
  }
}

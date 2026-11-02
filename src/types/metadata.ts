export interface MetadataLookupRequest {
  doi?: string | null;
  title?: string | null;
  path?: string | null;
  firstPageText?: string | null;
  evidenceTitle?: string | null;
}

export interface MetadataLookupResult {
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publishedDate?: string | null;
  verified?: boolean;
  matchedBy?: 'doi' | 'title';
  source: string;
  doi: string | null;
  title: string | null;
  authors: string[];
  year: string | null;
  publication: string | null;
  url: string | null;
  abstractText: string | null;
}

export interface LocalPdfMetadataPreview {
  title: string | null;
  authors: string[];
  year: string | null;
  publication: string | null;
  doi: string | null;
  firstPageText: string | null;
}

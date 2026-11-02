export interface ImportDraftItem {
  path: string;
  title: string;
  authors: string;
  year: string;
  publication: string;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publishedDate?: string | null;
  doi: string;
  url: string;
  abstractText: string;
  categoryId: string;
}

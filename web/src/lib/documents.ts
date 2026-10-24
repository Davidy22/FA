export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_INPUT_ACCEPT = '.pdf,.doc,.docx,.odt,.pages';

type DocumentFormat = 'pdf' | 'doc' | 'docx' | 'odt' | 'pages';

const EXTENSIONS = new Set<DocumentFormat>(['pdf', 'doc', 'docx', 'odt', 'pages']);

/** Browsers disagree about Office MIME types, so the extension is the reliable hint. */
export function documentFormat(file: Pick<File, 'name' | 'type'>): DocumentFormat | null {
  const extension = file.name.split('.').pop()?.toLowerCase() as DocumentFormat | undefined;
  if (extension && EXTENSIONS.has(extension)) return extension;
  if (file.type === 'application/pdf') return 'pdf';
  return null;
}

export function convertedPdfName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '').trim() || 'document';
  return `${base}.pdf`;
}

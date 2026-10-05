import type { StatusFilter } from '../pages/Records.tsx';

export interface DocumentsSearch {
  mode?: 'text' | 'titles';
  q?: string | undefined;
  words?: string;
  title?: string;
  status?: StatusFilter;
}

/** Distinct source and title searches survive navigation without sharing their filters. */
export function validateDocumentsSearch(search: Record<string, unknown>): DocumentsSearch {
  return {
    ...(search.mode === 'text' || search.mode === 'titles' ? { mode: search.mode } : {}),
    ...(typeof search.q === 'string' && search.q.trim() ? { q: search.q.trim() } : {}),
    ...(typeof search.words === 'string' ? { words: search.words } : {}),
    ...(typeof search.title === 'string' ? { title: search.title } : {}),
    ...(search.status === 'current' ||
    search.status === 'draft' ||
    search.status === 'active' ||
    search.status === 'archived'
      ? { status: search.status }
      : {}),
  };
}

export type DocumentSection = number | 'unavailable';

/** Preserve an invalid requested target as unavailable rather than displaying section zero. */
export function validateDocumentSection(value: unknown): DocumentSection | undefined {
  if (value === undefined) return undefined;
  const section = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof section === 'number' && Number.isSafeInteger(section) && section >= 0
    ? section
    : 'unavailable';
}

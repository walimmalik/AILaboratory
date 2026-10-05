import { ExactSourceReference, libraryRead } from '@ailab/schema';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api.ts';
import {
  type DocumentsSearch,
  validateDocumentSection,
  validateDocumentsSearch,
} from './document-search.ts';

export interface ExactInstructionsSearch {
  source?: ExactSourceReference;
  passage?: string;
  section?: number;
  back?: DocumentsSearch;
  error?: string;
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Invalid pins remain invalid; this route never opens current discovery. */
export function validateExactInstructionsSearch(
  search: Record<string, unknown>,
): ExactInstructionsSearch {
  const back = decoded(search.back);
  const result: ExactInstructionsSearch = {
    ...(back && typeof back === 'object' && !Array.isArray(back)
      ? { back: validateDocumentsSearch(back as Record<string, unknown>) }
      : {}),
  };
  const source = ExactSourceReference.safeParse(decoded(search.source));
  if (!source.success)
    return { ...result, error: 'This link is missing a valid exact source reference.' };
  if (
    (search.passage !== undefined && search.section !== undefined) ||
    search.document !== undefined ||
    search.pages !== undefined ||
    search.passages !== undefined
  )
    return { ...result, error: 'This link contains conflicting text selections.' };
  if (
    search.passage !== undefined &&
    (typeof search.passage !== 'string' || !search.passage.trim())
  )
    return { ...result, error: 'This link contains an invalid passage selection.' };
  const section = validateDocumentSection(search.section);
  if (section === 'unavailable')
    return { ...result, error: 'This link contains an invalid section selection.' };
  return {
    ...result,
    source: source.data,
    ...(typeof search.passage === 'string' ? { passage: search.passage } : {}),
    ...(section !== undefined ? { section } : {}),
  };
}

export function exactInstructionsSearch(
  source: ExactSourceReference,
  selection: { passage: string } | { section: number } | Record<string, never> = {},
  back?: DocumentsSearch,
): ExactInstructionsSearch {
  return { source, ...selection, ...(back ? { back } : {}) };
}

type Selection = { passages: string[] } | { section: number } | Record<string, never>;

/** Both outline and text requests include every pin and their own selection in the cache key. */
export function exactSourceQuery(
  source: ExactSourceReference | undefined,
  selection: Selection = {},
) {
  return queryOptions({
    queryKey: ['library', 'exact', source, selection],
    retry: false,
    queryFn: async () => {
      if (!source) throw new Error('An exact source reference is required.');
      const result = await api.run(libraryRead, { source, ...selection });
      const resolved = result.source;
      if (
        !resolved ||
        resolved.document !== source.document ||
        resolved.version !== source.version ||
        resolved.file !== source.file ||
        resolved.sha256 !== source.sha256 ||
        resolved.parse.status !== source.parse.status ||
        (source.parse.status === 'parsed' &&
          resolved.parse.status === 'parsed' &&
          resolved.parse.snapshot !== source.parse.snapshot)
      )
        throw new Error('The response does not match this exact source reference.');
      return result;
    },
  });
}

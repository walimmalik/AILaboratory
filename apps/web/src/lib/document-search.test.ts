import { describe, expect, it } from 'vitest';
import { validateDocumentSection, validateDocumentsSearch } from './document-search.ts';

describe('document route search validation', () => {
  it('keeps text, editable words, title filters and mode distinct through URL serialization', () => {
    const state = {
      mode: 'titles',
      q: ' 450 ',
      words: ' 450 ',
      title: 'ELISA',
      status: 'archived',
    };
    expect(validateDocumentsSearch(JSON.parse(JSON.stringify(state)))).toEqual({
      ...state,
      q: '450',
    });
    for (const status of ['current', 'draft', 'active', 'archived'])
      expect(validateDocumentsSearch({ status })).toEqual({ status });
    expect(
      validateDocumentsSearch({ mode: 'invalid', q: [], words: 3, title: {}, status: 'unknown' }),
    ).toEqual({});
    expect(validateDocumentsSearch({ words: 'new words' })).toEqual({ words: 'new words' });
  });

  it('validates section indexes and retains invalid requests as unavailable', () => {
    expect(validateDocumentSection(undefined)).toBeUndefined();
    for (const value of [0, 2, '0', '2'])
      expect(validateDocumentSection(value)).toBe(Number(value));
    for (const value of [
      -1,
      1.5,
      '',
      'bad',
      null,
      true,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      'unavailable',
    ])
      expect(validateDocumentSection(value)).toBe('unavailable');
  });
});

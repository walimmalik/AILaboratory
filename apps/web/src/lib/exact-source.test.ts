import { type ExactSourceReference, libraryRead } from '@ailab/schema';
import { QueryClient } from '@tanstack/react-query';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import {
  exactInstructionsSearch,
  exactSourceQuery,
  validateExactInstructionsSearch,
} from './exact-source.ts';

vi.mock('../api.ts', () => ({ api: { run: vi.fn() } }));
const source: ExactSourceReference = {
  document: 'doc_00000000000000000000000001',
  version: 1,
  file: 'fil_00000000000000000000000001',
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Edition A',
  printedRevision: 'A',
};

beforeEach(() => {
  vi.mocked(api.run).mockReset();
});

describe('exact instruction links', () => {
  it('round trips every source pin, passage and search context through router serialization', () => {
    const search = exactInstructionsSearch(
      source,
      { passage: 'snapshot-passage-7' },
      {
        mode: 'text',
        q: 'amber',
        words: 'amber',
        title: 'manual',
        status: 'draft',
      },
    );
    expect(
      validateExactInstructionsSearch(defaultParseSearch(defaultStringifySearch(search))),
    ).toEqual(search);
    expect(
      validateExactInstructionsSearch({ source: JSON.stringify(source), section: '0' }),
    ).toEqual({ source, section: 0 });
  });

  it.each([
    {},
    { source: '{broken' },
    { source: { ...source, version: 0 } },
    { source: { ...source, file: 'wrong' } },
    { source: { ...source, sha256: 'wrong' } },
    { source: { ...source, parse: { status: 'parsed', snapshot: 'wrong' } } },
    { source, passage: '' },
    { source, passage: ['p'] },
    { source, section: -1 },
    { source, passage: 'p', section: 0 },
    { source, document: source.document },
    { source, pages: { from: 1, to: 2 } },
    { source, passages: ['p'] },
  ])('preserves malformed or contradictory requests as errors: %j', (search) => {
    const result = validateExactInstructionsSearch(search);
    expect(result.error).toBeTruthy();
    expect(result.source).toBeUndefined();
  });

  it('retains an unavailable attachment rather than manufacturing a parsed identity', () => {
    const unavailable = {
      ...source,
      parse: { status: 'unavailable', reason: 'No readable text.' },
    };
    expect(validateExactInstructionsSearch({ source: unavailable })).toEqual({
      source: unavailable,
    });
  });
});

describe('exact source requests and cache identity', () => {
  it('calls only the exact operation selector and accepts server-authoritative display metadata', async () => {
    const resolved = { ...source, title: 'Historical title', printedRevision: 'Printed A' };
    vi.mocked(api.run).mockResolvedValue({ source: resolved, passages: [] } as never);
    const client = new QueryClient();
    const result = await client.fetchQuery(exactSourceQuery(source, { passages: ['p-1'] }));
    expect(api.run).toHaveBeenCalledWith(libraryRead, { source, passages: ['p-1'] });
    expect(result.source).toEqual(resolved);
    client.clear();
  });

  it('separates outline, passage, section, version, file, digest and snapshot caches', async () => {
    vi.mocked(api.run).mockImplementation(
      async (_operation, input) =>
        ({ source: (input as { source: ExactSourceReference }).source }) as never,
    );
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const sources = [
      source,
      { ...source, version: 2 },
      { ...source, file: 'fil_00000000000000000000000002' },
      { ...source, sha256: 'c'.repeat(64) },
      { ...source, parse: { status: 'parsed' as const, snapshot: 'd'.repeat(64) } },
    ];
    for (const pin of sources) await client.fetchQuery(exactSourceQuery(pin));
    await client.fetchQuery(exactSourceQuery(source, { passages: ['p-1'] }));
    await client.fetchQuery(exactSourceQuery(source, { section: 0 }));
    await client.fetchQuery(exactSourceQuery(source));
    expect(api.run).toHaveBeenCalledTimes(7);
    client.clear();
  });

  it.each([
    { ...source, document: 'doc_00000000000000000000000002' },
    { ...source, version: 2 },
    { ...source, file: 'fil_00000000000000000000000002' },
    { ...source, sha256: 'c'.repeat(64) },
    { ...source, parse: { status: 'parsed', snapshot: 'd'.repeat(64) } },
    { ...source, parse: { status: 'unavailable', reason: 'Not parsed.' } },
    undefined,
  ])(
    'rejects a contradictory server response instead of rendering current text',
    async (resolved) => {
      vi.mocked(api.run).mockResolvedValue({ source: resolved } as never);
      const client = new QueryClient();
      await expect(client.fetchQuery(exactSourceQuery(source))).rejects.toThrow('does not match');
      expect(api.run).toHaveBeenCalledTimes(1);
      client.clear();
    },
  );

  it.each([
    'Wrong document version',
    'File digest differs',
    'Missing snapshot',
    'Missing passage',
    'Foreign lab',
  ])('propagates %s without a discovery retry', async (message) => {
    vi.mocked(api.run).mockRejectedValue(new Error(message));
    const client = new QueryClient();
    await expect(client.fetchQuery(exactSourceQuery(source, { passages: ['p'] }))).rejects.toThrow(
      message,
    );
    expect(api.run).toHaveBeenCalledOnce();
    client.clear();
  });
});

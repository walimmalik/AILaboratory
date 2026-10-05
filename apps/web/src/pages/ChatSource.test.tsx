import type { ExactSourceReference } from '@ailab/schema';
import { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import type { exactSourceQuery } from '../lib/exact-source.ts';
import { ChatSourceContext } from './ChatSource.tsx';

const fixture = vi.hoisted(() => ({
  source: undefined as ExactSourceReference | undefined,
  error: undefined as Error | undefined,
  query: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  queryOptions: (options: unknown) => options,
  useQuery: (options: unknown) => {
    fixture.query(options);
    return { data: fixture.source ? { source: fixture.source } : undefined, error: fixture.error };
  },
}));
vi.mock('../api.ts', () => ({ api: { run: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search }: { children: ReactNode; search: unknown }) => (
    <a href={`/?pin=${encodeURIComponent(JSON.stringify(search))}`}>{children}</a>
  ),
}));
const source: ExactSourceReference = {
  document: 'doc_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
  version: 4,
  file: 'fil_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Spoofed title',
  printedRevision: 'Spoofed revision',
};
beforeEach(() => {
  fixture.source = undefined;
  fixture.error = undefined;
  fixture.query.mockClear();
  vi.mocked(api.run).mockReset();
});
it('keeps lost-access labels generic and places the source diagnostic inside the disclosure', () => {
  fixture.error = new Error('The selected file SHA256 does not match the exact reference');
  const markup = renderToStaticMarkup(<ChatSourceContext historical selection={{ source }} />);
  expect(markup.split('<details>')[0]).toContain('Selected instructions');
  expect(markup.split('<details>')[0]).toContain('This exact source could not be checked');
  expect(markup.split('<details>')[0]).not.toContain('SHA256');
  expect(markup.split('<details>')[1]).toContain(fixture.error.message);
});
it('resolves historical labels from a cold cache and deduplicates repeated identities despite different client labels', async () => {
  const client = new QueryClient();
  const canonical = { ...source, title: 'Retained method', printedRevision: 'Edition 2' };
  vi.mocked(api.run).mockResolvedValue({ source: canonical });
  renderToStaticMarkup(<ChatSourceContext historical selection={{ source, passage: 'one' }} />);
  renderToStaticMarkup(
    <ChatSourceContext
      historical
      selection={{
        source: {
          ...source,
          title: 'Another spoofed title',
          printedRevision: 'Another spoofed edition',
        },
        section: 0,
      }}
    />,
  );
  const first = fixture.query.mock.calls[0]?.[0] as ReturnType<typeof exactSourceQuery>;
  const second = fixture.query.mock.calls[1]?.[0] as ReturnType<typeof exactSourceQuery>;
  expect(first.queryKey).toEqual(second.queryKey);
  const [resolved] = await Promise.all([client.fetchQuery(first), client.fetchQuery(second)]);
  expect(api.run).toHaveBeenCalledOnce();
  fixture.source = resolved.source;
  const markup = renderToStaticMarkup(<ChatSourceContext historical selection={{ source }} />);
  expect(markup).toContain('Retained method');
  expect(markup).toContain('Edition 2');
  expect(markup.replace(/<a[^>]*>/g, '<a>')).not.toContain('Spoofed');
  await client.fetchQuery(fixture.query.mock.calls[2]?.[0] as ReturnType<typeof exactSourceQuery>);
  expect(api.run).toHaveBeenCalledOnce();
  client.clear();
});
it('shows canonical labels for current chat context with an inspectable complete source and section zero', () => {
  fixture.source = { ...source, title: 'Retained method', printedRevision: 'Edition 2' };
  const markup = renderToStaticMarkup(<ChatSourceContext selection={{ source, section: 0 }} />);
  expect(markup).toContain('Selected source for chat');
  expect(markup).toContain('Retained method');
  expect(markup).toContain('Edition 2');
  expect(markup).toContain('section 1');
  expect(markup).toContain(source.document);
  expect(markup).toContain(source.sha256);
  expect(markup).toContain('Source reference');
  expect(fixture.query).toHaveBeenCalledWith(expect.objectContaining({ staleTime: 60_000 }));
});
it('marks an unchecked saved message association without trusting labels', () => {
  const markup = renderToStaticMarkup(
    <ChatSourceContext
      historical
      selection={{
        source: { ...source, parse: { status: 'unavailable', reason: 'Spoofed reason' } },
      }}
    />,
  );
  expect(markup).toContain('Source selected for this message');
  expect(markup).toContain('Selected instructions');
  expect(markup).toContain('Text remains unchecked');
  const text = markup.replace(/<a[^>]*>/g, '<a>');
  expect(text).not.toContain('Spoofed');
  expect(fixture.query).toHaveBeenCalledWith(expect.objectContaining({ retryOnMount: false }));
});

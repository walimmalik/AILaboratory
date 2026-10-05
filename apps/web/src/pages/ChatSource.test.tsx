import type { ExactSourceReference } from '@ailab/schema';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatSourceContext } from './ChatSource.tsx';

const fixture = vi.hoisted(() => ({
  source: undefined as ExactSourceReference | undefined,
  query: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: unknown) => {
    fixture.query(options);
    return { data: fixture.source ? { source: fixture.source } : undefined };
  },
}));
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
  fixture.query.mockClear();
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
  expect(fixture.query).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
});
it('marks a saved message association without trusting labels or automatically re-reading historical sources', () => {
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
  expect(fixture.query).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
});

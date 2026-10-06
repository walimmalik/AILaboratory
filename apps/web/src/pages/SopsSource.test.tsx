import type { Citation, ExactSourceReference, SopAttributes } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Cites, InstructionsUsed } from './Sops.tsx';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string;
    params?: { id: string };
    search?: Record<string, unknown>;
    children: ReactNode;
  }) => (
    <a
      href={`${params ? `/records/${params.id}` : to}${search ? defaultStringifySearch(search) : ''}`}
    >
      {children}
    </a>
  ),
}));
const exact: ExactSourceReference = {
  document: `doc_${'0'.repeat(26)}`,
  version: 2,
  file: `fil_${'1'.repeat(26)}`,
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Coating instructions',
  printedRevision: 'Edition B',
};
const source = { document: exact.document, revision: 'unrelated free text', exact };
const cite: Citation = {
  document: exact.document,
  passage: 'wash-2',
  page: 3,
  quote: 'Wash twice.',
};
function html(node: ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
}
function selection(markup: string) {
  const href = markup.match(/href="(\/library\/instructions[^"]*)"/)?.[1];
  expect(href).toBeDefined();
  return defaultParseSearch(href?.slice(href.indexOf('?')).replaceAll('&amp;', '&') ?? '');
}

it('opens the full persisted instructions identity, without deriving an edition from free text', () => {
  const markup = html(<InstructionsUsed source={source} />);
  expect(markup).toContain('Instructions used:');
  expect(markup).toContain('Coating instructions');
  expect(markup).toContain('Edition B');
  expect(selection(markup)).toEqual({ source: exact });
  expect(markup).not.toContain('unrelated free text');
});

it('opens a cited passage using the same saved root, including its full parse identity', () => {
  const markup = html(<Cites source={source} cites={[cite]} />);
  expect(markup).toContain('Wash twice.');
  expect(markup).toContain('p. 3');
  expect(selection(markup)).toEqual({ source: exact, passage: 'wash-2' });
  expect(markup).not.toContain('/records/');
});

it('keeps unavailable text unchecked and opens only the saved file reference', () => {
  const unavailable: ExactSourceReference = {
    ...exact,
    parse: { status: 'unavailable', reason: 'converter diagnostics' },
  };
  const saved = { ...source, exact: unavailable };
  const markup = html(
    <>
      <InstructionsUsed source={saved} />
      <Cites source={saved} cites={[cite]} />
    </>,
  );
  expect(markup).toContain('Text could not be checked');
  expect(selection(markup)).toEqual({ source: unavailable });
  expect(markup).not.toContain('Open cited passage');
  expect(markup).not.toContain('converter diagnostics');
});

it('labels an unbound SOP unchecked and keeps its document link out of the exact reader', () => {
  const unbound = { document: exact.document, revision: 'Edition B' };
  const markup = html(
    <>
      <InstructionsUsed source={unbound} />
      <Cites source={unbound} cites={[cite]} />
    </>,
  );
  expect(markup).toContain('Edition not established');
  expect(markup).toContain('unchecked');
  expect(markup).toContain(`/records/${exact.document}`);
  expect(markup).not.toContain('/library/instructions');
});

it('rejects malformed or mismatched roots and never pins another document citation to them', () => {
  for (const saved of [
    { ...source, exact: { ...exact, sha256: 'corrupt' } },
    { ...source, document: `doc_${'2'.repeat(26)}` },
  ]) {
    const markup = html(<InstructionsUsed source={saved as SopAttributes['source']} />);
    expect(markup).toContain('saved instructions link is invalid');
    expect(markup).not.toContain('/library/instructions');
  }
  const markup = html(
    <Cites source={source} cites={[{ ...cite, document: `doc_${'2'.repeat(26)}` }]} />,
  );
  expect(markup).not.toContain('/library/instructions');
  expect(markup).toContain('Edition not established');
});

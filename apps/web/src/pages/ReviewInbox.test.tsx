import type { ReviewItem } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { reviewQuery } from '../queries.ts';
import { ReviewPage } from './ReviewInbox.tsx';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => (
    <a href={`/records/${params.id}`}>{children}</a>
  ),
}));
function html(unchecked: number) {
  const client = new QueryClient();
  const item: Extract<ReviewItem, { type: 'draft' }> = {
    type: 'draft',
    tier: 'to_confirm',
    at: '2026-10-06T00:00:00Z',
    record: {
      id: 'doc_fixture',
      kind: 'document',
      name: 'DOC-0003',
      label: 'Imported method',
      status: 'draft',
      version: 4,
      updatedBy: { type: 'user', userId: 'usr_fixture' },
    },
    byAgent: false,
    batchable: false,
    warnings: 0,
    sectionsToConfirm: ['Details', 'License', 'Files', 'Notes'],
    missing: [],
    blockers: [],
    assumed: 0,
    unchecked,
    ready: false,
  };
  client.setQueryData(reviewQuery.queryKey, {
    items: [item],
    counts: { total: 1, changes: 0, mentions: 0, notices: 0, needsYou: 0, drafts: { document: 1 } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ReviewPage />
    </QueryClientProvider>,
  );
}
it('counts unchecked evidence values rather than distinct sources while keeping the existing record-review route', () => {
  const markup = html(5);
  expect(markup).toContain('4 parts to confirm');
  expect(markup).toContain('5 values with evidence to review');
  expect(markup).not.toContain('5 sources');
  expect(markup).toContain('href="/records/doc_fixture"');
  expect(markup).not.toContain('Confirm ready ones');
  expect(html(1)).toContain('1 value with evidence to review');
  expect(html(0)).not.toContain('with evidence to review');
});

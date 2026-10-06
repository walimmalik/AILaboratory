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
function html(unchecked: number, drafts?: { id: string; group?: { id: string; title: string } }[]) {
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
  const items = drafts?.map((draft, index) => ({
    ...item,
    group: draft.group,
    record: {
      ...item.record,
      id: draft.id,
      name: `DOC-${String(index + 3).padStart(4, '0')}`,
      label: draft.id,
    },
  })) ?? [item];
  client.setQueryData(reviewQuery.queryKey, {
    items,
    counts: {
      total: items.length,
      changes: 0,
      mentions: 0,
      notices: 0,
      needsYou: 0,
      drafts: { document: items.length },
    },
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
  expect(markup).toContain('5 values to check');
  expect(markup).not.toContain('5 sources');
  expect(markup).toContain('href="/records/doc_fixture"');
  expect(markup).not.toContain('Confirm ready ones');
  expect(html(1)).toContain('1 value to check');
  expect(html(0)).not.toContain('values to check');
});

it('labels a shared request and a separate single draft without grouping unknown origins or granting a group confirmation', () => {
  const first = { id: 'request:first', title: 'Create A1 and A2' };
  const second = { id: 'request:second', title: 'Create B1 separately' };
  const markup = html(1, [
    { id: 'doc_a1', group: first },
    { id: 'doc_b1', group: second },
    { id: 'doc_a2', group: first },
    { id: 'doc_unknown1' },
    { id: 'doc_unknown2' },
    {
      id: 'doc_unavailable',
      group: { id: 'request:unavailable', title: 'Saved request (text unavailable)' },
    },
  ]);
  expect(markup.match(/Create A1 and A2/g)).toHaveLength(1);
  expect(markup).toContain('2 drafts from this request');
  expect(markup).toContain('Create B1 separately');
  expect(markup.match(/1 draft from this request/g)).toHaveLength(2);
  expect(markup).toContain('Saved request (text unavailable)');
  expect(markup).not.toContain('from one conversation');
  expect(markup.match(/class="group-cell"/g)).toHaveLength(3);
  for (const id of [
    'doc_a1',
    'doc_a2',
    'doc_b1',
    'doc_unknown1',
    'doc_unknown2',
    'doc_unavailable',
  ]) {
    expect(markup).toContain(`href="/records/${id}"`);
  }
  expect(markup).not.toContain('Confirm all');
});

import type { Readiness, RecordEnvelope } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ReadinessBlock } from './RecordReview.tsx';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { id: string };
    search?: { tab: string };
  }) => <a href={`/records/${params.id}${search ? `?tab=${search.tab}` : ''}`}>{children}</a>,
}));
const record = {
  id: 'doc_fixture',
  kind: 'document',
  name: 'DOC-0003',
  status: 'draft',
  attributes: {},
  evidence: {},
} as RecordEnvelope;
const readiness: Readiness = {
  recordId: record.id,
  version: 4,
  status: 'draft',
  ready: false,
  checks: [],
  missing: [],
  assumed: [],
  unchecked: ['type', 'version', 'license', 'files', 'notes'],
  notApplicable: [],
  sections: [{ id: 'fields', title: 'Document details', state: 'needs_review', fields: [] }],
};
function html(state = readiness, item = record, editing?: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ReadinessBlock
        record={item}
        readiness={state}
        titles={{ fields: 'Document details' }}
        onFix={() => {}}
        editing={editing}
      />
    </QueryClientProvider>,
  );
}
it('hands an unchecked draft from its overview to the existing field evidence without changing Confirm', () => {
  const markup = html();
  expect(markup).toContain('needs your review');
  expect(markup).toContain('5 values need checking against their sources.');
  expect(markup).toContain('href="/records/doc_fixture?tab=fields">Review values and sources');
  expect(markup).not.toContain('sources to check');
  expect(markup).toContain('Confirm DOC-0003');
  expect(markup).not.toContain('disabled=""');
  expect(html({ ...readiness, unchecked: ['files'] })).toContain(
    '1 value needs checking against its source.',
  );
});
it('keeps blockers and unsaved-edit warnings ahead of the evidence cue and preserves disabled confirmation', () => {
  const blocked = html({
    ...readiness,
    checks: [
      {
        id: 'missing',
        label: 'Missing required details',
        severity: 'blocker',
        passed: false,
        source: 'kind',
        section: 'fields',
      },
    ],
  });
  expect(blocked).toContain('1 to fix');
  expect(blocked).not.toContain('needs your review');
  expect(blocked.indexOf('Missing required details')).toBeLessThan(blocked.indexOf('5 values'));
  expect(blocked).not.toContain('Confirm DOC-0003');
  const edited = html(readiness, record, 'fields');
  expect(edited).toContain('disabled=""');
  expect(edited.indexOf('Save or cancel your edit')).toBeLessThan(edited.indexOf('5 values'));
});
it('omits empty and archived cues and preserves confirmed or changed states', () => {
  const empty = html({ ...readiness, unchecked: [] });
  expect(empty).toContain('ready to confirm');
  expect(empty).not.toContain('Review values and sources');
  const estimated = html({ ...readiness, unchecked: [], assumed: ['notes'] });
  expect(estimated.match(/One value was/g)).toHaveLength(1);
  expect(estimated).not.toContain('Review values and sources');
  const confirmed = html(
    { ...readiness, ready: true, sections: [], unchecked: [] },
    { ...record, status: 'active' },
  );
  expect(confirmed).toContain('✓ confirmed');
  expect(confirmed).not.toContain('Review values and sources');
  const changed = html(readiness, { ...record, status: 'active' });
  expect(changed).toContain('changed since it was confirmed');
  expect(changed).toContain('Confirm the changes');
  expect(changed).toContain('Review values and sources');
  const archived = html(readiness, { ...record, status: 'archived' });
  expect(archived).not.toContain('Review values and sources');
  expect(archived).not.toContain('Confirm the changes');
});

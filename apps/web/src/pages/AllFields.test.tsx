import type { FieldEvidence, Readiness, ReadinessSection, RecordEnvelope } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { AllFields } from './AllFields.tsx';

vi.mock('../assistant.tsx', () => ({ useAssistant: () => ({ show: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => (
    <a href={`/records/${params.id}`}>{children}</a>
  ),
}));
const evidence = (note?: string): FieldEvidence => ({
  source: 'assumed',
  by: { type: 'agent', agentName: 'Test agent', onBehalfOf: 'usr_fixture' },
  at: '2026-10-06T00:00:00Z',
  ...(note === undefined ? {} : { note }),
});
const field = (name: string, note?: string): ReadinessSection['fields'][number] => ({
  field: name,
  value: 'Saved value',
  state: 'unconfirmed',
  assumed: true,
  evidence: evidence(note),
});
it('mounts only the chosen workspace question editor without unrelated 400-material values or snapshots', () => {
  const subjects = Array.from({ length: 400 }, (_, index) => ({
    record: `ent_unrelated_material_${index}`,
  }));
  const record = {
    id: 'exp_fixture',
    kind: 'experiment',
    name: 'EXP-0001',
    version: 3,
    status: 'draft',
    attributes: { question: 'Which treatment changes the response?', subjects },
    evidence: {},
    reviews: {},
  } as unknown as RecordEnvelope;
  const readiness = {
    recordId: record.id,
    version: 3,
    status: 'draft',
    ready: false,
    missing: [],
    checks: [],
    assumed: [],
    unchecked: [],
    notApplicable: [],
    sections: [
      {
        id: 'question',
        title: 'Question',
        state: 'needs_review',
        fields: [{ ...field('question'), value: record.attributes.question }],
      },
      {
        id: 'subjects',
        title: 'What is tested',
        state: 'needs_review',
        fields: [{ ...field('subjects'), value: subjects }],
      },
    ],
  } as Readiness;
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AllFields
        record={record}
        readiness={readiness}
        editing="question"
        onlySection="question"
        onEdit={() => {}}
        renderValue={(value) => JSON.stringify(value)}
      />
    </QueryClientProvider>,
  );
  expect(markup).toContain('Question');
  expect(markup).not.toContain('What is tested');
  expect(markup).not.toContain('ent_unrelated_material_');
  expect(markup).not.toContain('section-subjects');
});
function html(fields: ReadinessSection['fields']) {
  const confirmed = fields.every((f) => f.state === 'confirmed');
  const record = {
    id: 'doc_fixture',
    kind: 'document',
    name: 'DOC-0003',
    status: confirmed ? 'active' : 'draft',
    attributes: Object.fromEntries(fields.map((f) => [f.field, f.value])),
    evidence: Object.fromEntries(fields.map((f) => [f.field, f.evidence])),
  } as RecordEnvelope;
  const readiness: Readiness = {
    recordId: record.id,
    version: 1,
    status: record.status,
    ready: confirmed,
    missing: [],
    checks: [],
    assumed: fields.filter((f) => f.assumed).map((f) => f.field),
    unchecked: [],
    notApplicable: [],
    sections: [
      { id: 'source', title: 'Source', state: confirmed ? 'confirmed' : 'needs_review', fields },
    ],
  };
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AllFields
        record={record}
        readiness={readiness}
        editing={undefined}
        onEdit={() => {}}
        renderValue={(value) => String(value)}
      />
    </QueryClientProvider>,
  );
  return markup.split('<details class="tech">')[0] ?? '';
}
it('shows a saved assumed explanation once for fields sharing it without inventing record links or verification', () => {
  const note = 'Reused unchanged from unconfirmed DOC-0001 version 1 at the user request.';
  const markup = html([field('files', note), field('license', note)]);
  expect(markup.match(/Reused unchanged/g)).toHaveLength(1);
  expect(markup).toContain('Files and license');
  expect(markup).toContain('unverified');
  expect(markup).not.toContain('no source given');
  expect(markup).not.toContain('href=');
  expect(markup).not.toContain('Note about');
  // The same persisted fields render their explanation after a cold read too.
  expect(html([field('files', note), field('license', note)])).toBe(markup);
});
it('keeps different explanations distinct and no-note assumptions concise', () => {
  const markup = html([
    field('files', 'Copied file choice, still unchecked.'),
    field('license', 'License has not been checked.'),
    field('version'),
  ]);
  expect(markup).toContain('Copied file choice, still unchecked.');
  expect(markup).toContain('License has not been checked.');
  expect(markup).toContain('Version entered by Test agent, unverified');
  expect(markup).not.toContain('no source given');
  expect(markup).not.toContain('Note about');
});
it('places the full long note in a closed accessible disclosure outside the source paragraph and escapes its text', () => {
  const note = `Unconfirmed explanation. ${'Check the original supplied method. '.repeat(8)}<img src=x onerror=alert(1)>`;
  const markup = html([field('version', note)]);
  expect(markup).toContain('<summary>Note about version</summary>');
  expect(markup).toContain('<p class="source-note">Unconfirmed explanation.');
  expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(markup).not.toContain('<img');
  expect(markup).not.toContain('<details open');
  expect(markup.indexOf('</p>')).toBeLessThan(markup.indexOf('<details'));
  expect(markup.match(/Unconfirmed explanation/g)).toHaveLength(1);
});
it('retains assumed history and its note without calling a confirmed value unverified', () => {
  const markup = html([
    {
      ...field('version', 'Originally copied from an unconfirmed draft.'),
      state: 'confirmed',
      assumed: false,
    },
  ]);
  expect(markup).toContain('originally assumed');
  expect(markup).toContain('Originally copied from an unconfirmed draft.');
  expect(markup).not.toContain('unverified');
});

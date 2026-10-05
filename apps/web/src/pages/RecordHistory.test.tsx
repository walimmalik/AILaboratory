import type { RecordEnvelope, RecordVersion, ScientificQuestion, SopStep } from '@ailab/schema';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ItemDiff, itemChanges } from './ItemDiff.tsx';
import { QuestionSnapshot, RecordHistory } from './RecordHistory.tsx';

vi.mock('../session.ts', () => ({ useMe: () => ({ user: { id: 'usr_scientist' } }) }));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data:
      queryKey[0] === 'record'
        ? { label: 'ELISA method source' }
        : [{ kind: 'sop', items: { steps: 'id', questions: 'id' } }],
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="/test">{children}</a>,
}));
vi.mock('../assistant.tsx', () => ({ useAssistant: () => ({ show: vi.fn() }) }));
vi.mock('./RecordActions.tsx', () => ({ RestoreVersion: () => null }));

describe('scientific question history', () => {
  it('renders the whole step array produced by an initial snapshot diff, with stored variable quantities', () => {
    const at = '2026-10-05T09:00:00Z';
    const actor = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
    const step: SopStep = {
      id: 'read',
      action: 'read',
      title: 'Read plate',
      text: 'Read using `wash_buffer` at `read_wavelength`.',
      parameters: [
        { name: 'duration', quantity: { value: '10', unit: 'min' } },
        { name: 'wavelength', variable: 'read_wavelength' },
      ],
      repeat: 3,
      uses: ['wash_buffer'],
      produces: [{ role: 'plate_read', label: 'Plate reading' }],
    };
    const snapshot: RecordEnvelope = {
      id: `sop_${'0'.repeat(26)}`,
      kind: 'sop',
      name: 'SOP-0001',
      label: 'Plate reading',
      orgId: `org_${'0'.repeat(26)}`,
      labId: `lab_${'0'.repeat(26)}`,
      status: 'draft',
      version: 1,
      attributes: {
        variables: [
          {
            name: 'read_wavelength',
            label: 'Read wavelength',
            kind: 'default',
            value: { value: '450', unit: 'nm' },
          },
        ],
        materials: [{ role: 'wash_buffer', label: 'Wash buffer', type: 'reagent' }],
        steps: [step],
      },
      evidence: {},
      reviews: {},
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      updatedBy: actor,
    };
    const changes = itemChanges(undefined, snapshot, {
      steps: 'id',
      variables: 'name',
      materials: 'role',
    });
    expect(changes.find((change) => change.path === '/steps')).toMatchObject({
      change: 'added',
      after: [step],
    });
    const html = renderToStaticMarkup(
      <ItemDiff kind="sop" before={undefined} after={snapshot} changes={changes} adjacent isNew />,
    );
    expect(html).toContain('duration: 10 min');
    expect(html).toContain('wavelength: 450 nm (Read wavelength, protocol default)');
    expect(html).toContain('Repeat 3 times');
    expect(html).toContain('Uses Wash buffer');
    expect(html).toContain('Produces Plate reading');
    expect(html).not.toContain('[object Object]');
    const removed = itemChanges(snapshot, undefined, {
      steps: 'id',
      variables: 'name',
      materials: 'role',
    });
    expect(removed.find((change) => change.path === '/steps')).toMatchObject({
      change: 'removed',
      before: [step],
    });
    const old = renderToStaticMarkup(
      <ItemDiff kind="sop" before={snapshot} after={undefined} changes={removed} adjacent />,
    );
    expect(old).toContain('wavelength: 450 nm (Read wavelength, protocol default)');
    expect(old).toContain('Repeat 3 times');
    expect(old).toContain('Uses Wash buffer');
    expect(old).not.toContain('[object Object]');
  });
  it('shows persisted document, page and quote on both a new question and its later response', () => {
    const userId = `usr_${'0'.repeat(26)}`;
    const question: ScientificQuestion = {
      id: 'wash_duration',
      question: 'Which wash duration is supported?',
      stage: { stage: 'method', reason: 'The source needs clarification' },
      disposition: { status: 'open' },
      responses: [],
      passages: [{ document: `doc_${'0'.repeat(26)}`, page: 4, quote: 'Wash for ten minutes.' }],
    };
    const initial = renderToStaticMarkup(<QuestionSnapshot question={question} />);
    expect(initial).toContain('ELISA method source');
    expect(initial).toContain('p. 4');
    expect(initial).toContain('Wash for ten minutes.');
    const base = {
      id: 'sop_cited',
      kind: 'sop',
      label: 'Cited wash',
      status: 'draft',
      version: 1,
      attributes: { questions: [question] },
      evidence: {},
      reviews: {},
    } as unknown as RecordEnvelope;
    const updated = {
      ...base,
      version: 2,
      attributes: {
        questions: [
          {
            ...question,
            responses: [
              {
                text: 'Please check the duration with the scientist',
                by: { type: 'user' as const, userId },
                at: '2026-10-05T10:00:00Z',
                version: 2,
              },
            ],
          },
        ],
      },
    };
    const versions = [base, updated].map((snapshot) => ({
      recordId: base.id,
      version: snapshot.version,
      operation: snapshot.version === 1 ? 'create' : 'update',
      actor: { type: 'user', userId },
      at: '2026-10-05T10:00:00Z',
      snapshot,
    })) as RecordVersion[];
    const response = renderToStaticMarkup(
      <RecordHistory record={updated} versions={versions} ledger={[]} selected="v2" />,
    ).split('<details class="tech">')[0];
    expect(response).toContain('Please check the duration with the scientist');
    expect(response).toContain('ELISA method source');
    expect(response).toContain('p. 4');
    expect(response).toContain('Wash for ten minutes.');
  });

  it('shows complete scientific settings for added and removed SOP steps only in the History comparison', () => {
    const step: SopStep = {
      id: 'incubate',
      action: 'incubate',
      title: 'Incubate',
      text: 'Incubate with `wash_buffer`.',
      parameters: [{ name: 'duration', quantity: { value: '10', unit: 'min' } }],
      repeat: 3,
      uses: ['wash_buffer'],
      produces: [{ role: 'washed_plate', label: 'Washed plate' }],
    };
    const full = {
      attributes: {
        steps: [step],
        materials: [{ role: 'wash_buffer', label: 'Wash buffer', type: 'reagent' }],
      },
    };
    const empty = { attributes: { steps: [], materials: [] } };
    for (const change of ['added', 'removed'] as const) {
      const before = change === 'added' ? empty : full;
      const after = change === 'added' ? full : empty;
      const html = renderToStaticMarkup(
        <ItemDiff kind="sop" before={before} after={after} adjacent />,
      );
      expect(html).toContain('duration: 10 min');
      expect(html).toContain('Repeat 3 times');
      expect(html).toContain('Uses Wash buffer');
      expect(html).toContain('Produces Washed plate');
      expect(html).not.toContain('Uses wash_buffer');
    }
    const proposal = renderToStaticMarkup(<ItemDiff kind="sop" before={empty} after={full} />);
    expect(proposal).not.toContain('duration: 10 min');
  });
  it('keeps collapsed and expanded History readable when a stored question does not match the current contract', () => {
    const record = {
      id: 'sop_historical',
      kind: 'sop',
      label: 'Historical wash',
      status: 'draft',
      version: 1,
      attributes: { questions: [{ id: 'old', question: 'Wash settings?', answer: 'Unknown' }] },
      evidence: {},
      reviews: {},
    } as unknown as RecordEnvelope;
    const version = {
      recordId: record.id,
      version: 1,
      operation: 'create',
      actor: { type: 'user', userId: 'usr_scientist' },
      at: '2026-10-05T09:00:00Z',
      snapshot: record,
    } as RecordVersion;
    const collapsed = renderToStaticMarkup(
      <RecordHistory record={record} versions={[version]} ledger={[]} />,
    );
    expect(collapsed).toContain('Scientific question comparison unavailable');
    expect(collapsed).toContain('View change');
    const expanded = renderToStaticMarkup(
      <RecordHistory record={record} versions={[version]} ledger={[]} selected="v1" />,
    );
    expect(expanded).toContain(
      'Scientific question comparison is unavailable for this historical version',
    );
    expect(expanded).toContain('Version and technical details');
    expect(expanded).toContain('Wash settings?');
    expect(expanded).toContain('Unknown');
    expect(expanded).not.toContain('No responses recorded.');
  });
  it('keeps before and after values adjacent once, while preserving proposal diff presentation', () => {
    const before = { attributes: { workingVolume: { max: { value: '300', unit: 'uL' } } } };
    const after = { attributes: { workingVolume: { max: { value: '320', unit: 'uL' } } } };
    const html = renderToStaticMarkup(
      <ItemDiff
        kind="labware_type"
        before={before}
        after={after}
        adjacent
        caption="What changed"
        labels={{ '/workingVolume/max': 'Maximum working volume' }}
      />,
    );
    expect(html).toContain('Maximum working volume');
    expect(html).toContain('Before → After');
    expect(html.match(/300 µL/g)).toHaveLength(1);
    expect(html.match(/320 µL/g)).toHaveLength(1);
    expect(html.match(/<td>/g)).toHaveLength(1);
    expect(html).not.toContain('title="/workingVolume/max"');
    const proposal = renderToStaticMarkup(
      <ItemDiff kind="labware_type" before={before} after={after} />,
    );
    expect(proposal).toContain('What would change');
    expect(proposal).toContain('class="was"');
    expect(proposal).toContain('class="now"');
    expect(proposal.match(/<td>/g)).toHaveLength(2);
  });
  it('shows an open question and its response with readable attribution, without exposing actor or question IDs', () => {
    const question: ScientificQuestion = {
      id: 'wash_volume_conflict',
      question: 'Which wash volume should we use?',
      stage: { stage: 'method', reason: 'The two sources disagree' },
      disposition: { status: 'open' },
      responses: [
        {
          text: 'I do not know yet',
          by: { type: 'user', userId: 'usr_scientist' },
          at: '2026-10-05T09:00:00Z',
          version: 2,
        },
      ],
    };
    const html = renderToStaticMarkup(<QuestionSnapshot question={question} />);
    expect(html).toContain(question.question);
    expect(html).toContain('I do not know yet');
    expect(html).toContain('you');
    expect(html).toContain('v2');
    expect(html).toContain('open');
    expect(html).toContain('The two sources disagree');
    expect(html).not.toContain('usr_scientist');
    expect(html).not.toContain('wash_volume_conflict');
    expect(html).not.toContain('<a');
    expect(
      renderToStaticMarkup(<QuestionSnapshot question={{ ...question, responses: [] }} />),
    ).toContain('No responses recorded.');
  });
});

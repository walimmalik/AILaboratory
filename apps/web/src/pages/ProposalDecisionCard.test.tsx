import {
  type Proposal,
  proposalsApprove,
  type ReviewItem,
  SopDefaultDecisionPreview,
} from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { conversationQuery, decidedProposalsQuery, reviewQuery } from '../queries.ts';
import { ConversationMessages } from './AssistantPanel.tsx';
import { decideSupported, ProposalDecisionCard, publishDecision } from './ProposalDecisionCard.tsx';
import { PendingProposal } from './ReviewInbox.tsx';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params?: { id: string } }) => (
    <a href={params ? `/records/${params.id}` : '/review'}>{children}</a>
  ),
}));
const at = '2026-10-06T00:00:00Z';
const id = 'sop_00000000000000000000000000';
const quantity = (value: string) => ({ value, unit: 'uL' });
const readiness = {
  recordId: id,
  version: 1,
  status: 'draft',
  sections: [],
  checks: [
    {
      id: 'q',
      label: 'Method question answered',
      source: 'Method',
      severity: 'blocker',
      passed: false,
      message: 'Choose a temperature',
    },
  ],
  ready: false,
  missing: ['Method needs review'],
  assumed: [],
  unchecked: [],
  notApplicable: [],
};
const section = [
  { name: 'well_volume', label: 'Well volume', kind: 'default', value: quantity('80') },
  {
    name: 'wash_volume',
    label: 'Wash volume',
    kind: 'default',
    value: quantity('300'),
    note: 'Keep this other estimate',
  },
];
function proposal(): Proposal {
  const preview = SopDefaultDecisionPreview.parse({
    type: 'sop_volume_default',
    target: { id, name: 'SOP-0001', label: 'Coating', version: 1 },
    variable: {
      name: 'well_volume',
      label: 'Well volume',
      path: '/variables/well_volume/value',
      before: quantity('100'),
      after: quantity('80'),
    },
    reason: 'Use the chosen planning default',
    changes: [
      {
        path: '/variables/well_volume/value',
        change: 'changed',
        before: quantity('100'),
        after: quantity('80'),
      },
    ],
    before: { target: { id, version: 1 }, reads: [], readiness },
    after: { target: { id, version: 2 }, reads: [], readiness },
    evidence: {
      path: '/variables/well_volume',
      after: { source: 'person', by: 'applying_person' },
    },
    confirmation: {
      by: 'applying_person',
      section: {
        id: 'variables',
        title: 'Values',
        before: {
          variables: section.map((v) =>
            v.name === 'well_volume' ? { ...v, value: quantity('100') } : v,
          ),
        },
        after: { variables: section },
      },
      evidence: {
        variables: {
          source: 'stated',
          by: { type: 'user', userId: 'usr_00000000000000000000000000' },
          note: 'Original section request',
        },
        '/variables/wash_volume': {
          source: 'assumed',
          by: { type: 'agent', agentName: 'Test', onBehalfOf: 'usr_00000000000000000000000000' },
          note: 'Other value is not checked',
        },
      },
      assumed: ['/variables/wash_volume'],
      unchecked: ['variables'],
    },
    questions: [
      { id: 'temperature', question: 'Which temperature?', stage: 'method', status: 'open' },
    ],
    remainingQuestions: 1,
    resultingStatus: 'draft',
    finalConfirmation: 'separate',
    scientificValidation: 'not_claimed',
  });
  return {
    id: 'prp_00000000000000000000000000',
    operationId: 'records.update',
    input: {},
    preview,
    decision: {
      origin: { type: 'unknown' },
      reads: [],
      writes: [],
      sources: [],
      scope: { type: 'operation_change' },
      previewIdentity: { digest: 'a'.repeat(64), preparedAt: at },
    },
    status: 'pending',
    proposedBy: { type: 'agent', agentName: 'Test', onBehalfOf: 'usr_00000000000000000000000000' },
    proposedAt: at,
  };
}
function render(node: ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());

it('shows exact quantities and the entire Values review, including other estimates, evidence and remaining questions', () => {
  const markup = render(<PendingProposal proposal={proposal()} />);
  expect(markup).toContain('100 µL → 80 µL');
  expect(markup).toContain('whole Values section');
  for (const text of [
    'Wash volume',
    '300 µL',
    'unverified estimate',
    'Other value is not checked',
    'Original section request',
    'Values section has a source to check',
    'Which temperature?',
    'Method needs review',
    'final confirmation is separate',
  ])
    expect(markup).toContain(text);
  expect(markup).toContain('Apply decision');
});

it('retains ordinary proposals and does not treat their envelope as a supported decision', () => {
  const ordinary = {
    ...proposal(),
    decision: undefined,
    preview: {
      id,
      kind: 'sop',
      version: 2,
      label: 'Coating',
      name: 'SOP-0001',
      attributes: {},
      evidence: {},
    },
  } as Proposal;
  const markup = render(<PendingProposal proposal={ordinary} />);
  expect(markup).toContain('Confirm change');
  expect(markup).not.toContain('Apply decision');
});

it('submits the shown digest, publishes pending refreshed data to both caches and uses the new token only on another call', async () => {
  const original = proposal();
  if (!original.decision) throw new Error('Fixture requires decision metadata');
  const refreshed = {
    ...original,
    previewStatus: 'refreshed' as const,
    decision: {
      ...original.decision,
      previewIdentity: { digest: 'b'.repeat(64), preparedAt: at },
    },
    preview: { ...(original.preview as object), reason: 'Changed review scope' },
  };
  const run = vi
    .spyOn(api, 'run')
    .mockResolvedValueOnce(refreshed)
    .mockResolvedValueOnce({ ...refreshed, status: 'approved' });
  const client = new QueryClient();
  client.setQueryData(decidedProposalsQuery.queryKey, [original]);
  const item = { type: 'change', proposal: original } as ReviewItem;
  const counts = { total: 1, changes: 1, mentions: 0, notices: 0, needsYou: 1, drafts: {} };
  client.setQueryData(reviewQuery.queryKey, { items: [item], counts });
  client.setQueryData(['review', 'kind', 'sop'], []);
  const returned = await decideSupported(original, true, ' reviewed ');
  publishDecision(client, returned);
  expect(run).toHaveBeenCalledExactlyOnceWith(proposalsApprove, {
    id: original.id,
    reason: 'reviewed',
    expectedPreview: 'a'.repeat(64),
  });
  expect(client.getQueryData(decidedProposalsQuery.queryKey)).toEqual([]);
  expect(client.getQueryData(reviewQuery.queryKey)).toEqual({
    items: [{ ...item, proposal: refreshed }],
    counts,
  });
  expect(client.getQueryData(['review', 'kind', 'sop'])).toEqual([]);
  const markup = render(<ProposalDecisionCard proposal={original} />, client);
  expect(markup).toContain('Nothing was applied');
  expect(markup).toContain('Changed review scope');
  expect(markup).not.toContain('Decision applied');
  await decideSupported(returned, true, '');
  expect(run).toHaveBeenLastCalledWith(proposalsApprove, {
    id: original.id,
    expectedPreview: 'b'.repeat(64),
  });
  const approved = {
    ...refreshed,
    status: 'approved' as const,
    receipt: { output: {}, recordIds: [id], committedAt: at },
  };
  publishDecision(client, approved);
  expect(client.getQueryData(reviewQuery.queryKey)).toEqual({ items: [], counts });
  expect(client.getQueryData(decidedProposalsQuery.queryKey)).toEqual([approved]);
  const acknowledged = render(<ProposalDecisionCard proposal={original} />, client);
  expect(acknowledged).toContain('Decision applied');
  expect(acknowledged).not.toContain('Apply decision');
});

it('disables both controls during assistant work and shows the persisted approved receipt after reload', () => {
  const pending = render(<ProposalDecisionCard proposal={proposal()} busy />);
  expect(pending.match(/disabled=""/g)).toHaveLength(2);
  const approved = {
    ...proposal(),
    status: 'approved' as const,
    receipt: {
      output: {
        id,
        kind: 'sop',
        label: 'Coating',
        name: 'SOP-0001',
        status: 'draft',
        version: 2,
        orgId: 'org_00000000000000000000000000',
        labId: 'lab_00000000000000000000000000',
        attributes: { variables: section },
        evidence: {},
        reviews: {},
        createdAt: at,
        updatedAt: at,
        createdBy: { type: 'user', userId: 'usr_00000000000000000000000000' },
        updatedBy: { type: 'user', userId: 'usr_00000000000000000000000000' },
      },
      recordIds: [id],
      committedAt: at,
    },
  };
  const markup = render(<ProposalDecisionCard proposal={approved} />);
  expect(markup).toContain('Decision applied');
  expect(markup).toContain('Open saved SOP');
  expect(markup).toContain('Recorded well volume: 80 µL · still draft');
  expect(markup).not.toContain('Apply decision');
});

it('Review waits for the actual producing conversation, not just the visible panel busy flag', () => {
  const p = proposal();
  if (!p.decision) throw new Error('Fixture requires metadata');
  const conversation = 'cnv_00000000000000000000000000';
  p.decision.origin = { type: 'user_message', conversation, message: 'ask' };
  const client = new QueryClient();
  client.setQueryData(conversationQuery(conversation).queryKey, {
    id: conversation,
    status: 'running',
    agentName: 'Test',
    title: 'Planning default',
    provider: 'test',
    model: 'test',
    createdAt: at,
    updatedAt: at,
    messages: [],
  });
  expect(render(<ProposalDecisionCard proposal={p} />, client).match(/disabled=""/g)).toHaveLength(
    2,
  );
  client.setQueryData(conversationQuery(conversation).queryKey, {
    id: conversation,
    status: 'idle',
    agentName: 'Test',
    title: 'Planning default',
    provider: 'test',
    model: 'test',
    createdAt: at,
    updatedAt: at,
    messages: [],
  });
  expect(render(<ProposalDecisionCard proposal={p} />, client)).not.toContain('disabled=""');
});

it('chat binds the shared card to the persisted proposal, including the durable decided state', () => {
  const p = proposal();
  const messages = [
    {
      id: 'tool',
      role: 'tool' as const,
      at,
      toolCallId: 'call',
      operationId: 'review.prepare_decision',
      outcome: 'proposed' as const,
      result: { proposal: p },
    },
  ];
  const approved = {
    ...p,
    status: 'approved' as const,
    receipt: { output: {}, recordIds: [id], committedAt: at },
  };
  const markup = render(
    <ol>
      <ConversationMessages
        messages={messages}
        agentName="Test"
        running={false}
        review={[{ type: 'change', proposal: p } as ReviewItem]}
        decided={[approved]}
      />
    </ol>,
  );
  expect(markup).toContain('Default change: SOP-0001');
  expect(markup).toContain('Decision applied');
  expect(markup.match(/Default change: SOP-0001/g)).toHaveLength(1);
  expect(markup).not.toContain('Review 1 proposed change');
});

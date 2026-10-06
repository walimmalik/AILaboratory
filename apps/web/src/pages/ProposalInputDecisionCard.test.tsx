import {
  type Proposal,
  proposalsApprove,
  type ReviewItem,
  SopInputDecisionPreview,
} from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { reviewQuery } from '../queries.ts';
import { ConversationMessages } from './AssistantPanel.tsx';
import {
  DecisionPreviewNotice,
  decideSupported,
  ProposalDecisionCard,
  previewNotice,
  publishDecision,
} from './ProposalDecisionCard.tsx';
import { PendingProposal } from './ReviewInbox.tsx';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params?: { id: string } }) => (
    <a href={params ? `/records/${params.id}` : '/review'}>{children}</a>
  ),
}));
const at = '2026-10-06T00:00:00Z';
const id = 'sop_00000000000000000000000000';
const user = { type: 'user' as const, userId: 'usr_00000000000000000000000000' };
const input = {
  name: 'count',
  label: 'Sample count',
  kind: 'input',
  value: '1',
  min: '1',
  max: '100',
  note: 'Choose for this experiment',
};
const question = {
  id: 'count',
  about: { variable: 'count' },
  question: 'How many samples?',
  stage: {
    stage: 'experiment',
    reason: 'Chosen per experiment',
    binding: { type: 'input', variable: 'count' },
  },
  responses: [{ text: 'The experiment owner will choose.', by: user, at, version: 1 }],
  disposition: { status: 'open' },
};
const action = {
  type: 'defer',
  sop: id,
  expectedVersion: 1,
  question: 'count',
  reason: 'Keep sample count explicit',
  obligation: {
    stage: 'experiment',
    condition: 'Provide sample count for each experiment.',
    binding: { type: 'input', variable: 'count' },
  },
};
const readiness = {
  recordId: id,
  version: 1,
  status: 'draft',
  ready: false,
  sections: [],
  checks: [
    {
      id: 'check',
      label: 'Declared input exists',
      source: 'Experiment rules',
      severity: 'blocker',
      passed: true,
    },
  ],
  missing: ['Final SOP review remains'],
  assumed: [],
  unchecked: [],
  notApplicable: [],
};
function proposal(): Proposal {
  const preview = SopInputDecisionPreview.parse({
    type: 'sop_experiment_input',
    target: { id, name: 'SOP-0001', label: 'Coating', version: 1 },
    question,
    input,
    reason: action.reason,
    acceptance: { status: 'deferred', by: 'applying_person', proposedBy: user, action },
    before: { target: { id, version: 1 }, reads: [], readiness },
    after: { target: { id, version: 2 }, reads: [], readiness },
    changedPath: '/questions/count/disposition',
    consequence: 'Still required for every experiment.',
    methodChanges: 'none',
    sectionConfirmations: 'unchanged',
    resultingStatus: 'draft',
    finalConfirmation: 'separate',
    scientificValidation: 'not_claimed',
  });
  return {
    id: 'prp_00000000000000000000000000',
    operationId: 'sops.answer_question',
    input: preview.acceptance.action,
    preview,
    decision: {
      origin: { type: 'unknown' },
      reads: [],
      writes: [],
      sources: [],
      scope: { type: 'question_disposition', disposition: preview.acceptance.action },
      previewIdentity: { digest: 'a'.repeat(64), preparedAt: at },
    },
    status: 'pending',
    proposedBy: user,
    proposedAt: at,
  };
}
function render(node: ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function savedRecord(p: Proposal, accepted = true) {
  return {
    id,
    kind: 'sop',
    label: 'Coating',
    name: 'SOP-0001',
    status: 'draft',
    version: 2,
    orgId: 'org_00000000000000000000000000',
    labId: 'lab_00000000000000000000000000',
    attributes: {
      variables: [input],
      questions: [
        {
          ...question,
          disposition: accepted
            ? { status: 'deferred', proposal: p.id, proposedBy: user, acceptedBy: user, at, action }
            : { status: 'open' },
        },
      ],
    },
    evidence: {},
    reviews: {},
    createdAt: at,
    updatedAt: at,
    createdBy: user,
    updatedBy: user,
  };
}
afterEach(() => vi.restoreAllMocks());

it('shows the exact open question, saved responses, bound input and retained obligation without claiming resolution or whole-section review', () => {
  const markup = render(<PendingProposal proposal={proposal()} />);
  for (const text of [
    'Accept as an experiment input',
    'How many samples?',
    'The experiment owner will choose.',
    'Sample count',
    'Minimum: 1',
    'Maximum: 100',
    'Provide sample count for each experiment.',
    'Still required for every experiment.',
    'method and its section reviews stay unchanged',
    'final confirmation is separate',
    'Declared input exists',
    'Final SOP review remains',
  ])
    expect(markup).toContain(text);
  expect(markup).not.toContain('Values included in this review');
  expect(markup).not.toContain('Recorded well volume');
  expect(markup).toContain('Apply decision');
});

it('derives accepted display only from the actual saved deferred disposition and matching receipt proposal after reload', () => {
  const p = proposal();
  const approved = {
    ...p,
    status: 'approved' as const,
    receipt: { output: savedRecord(p), recordIds: [id], committedAt: at },
  };
  const markup = render(<ProposalDecisionCard proposal={approved} />);
  expect(markup).toContain('Accepted as an experiment input: How many samples?');
  expect(markup).toContain('SOP still draft');
  expect(markup).not.toContain('Apply decision');
  const missing = render(
    <ProposalDecisionCard
      proposal={{ ...approved, receipt: { ...approved.receipt, output: savedRecord(p, false) } }}
    />,
  );
  expect(missing).toContain('saved input acceptance is unavailable');
  expect(missing).not.toContain('Accepted as an experiment input:');
  const rejected = render(<ProposalDecisionCard proposal={{ ...p, status: 'rejected' }} />);
  expect(rejected).toContain('Decision rejected');
  expect(rejected).not.toContain('Accepted as an experiment input:');
});

it('retains neutral refresh feedback across refetch and submits the displayed input preview digest on the next action', async () => {
  const p = proposal();
  if (!p.decision) throw new Error('Metadata required');
  const refreshed = {
    ...p,
    decision: { ...p.decision, previewIdentity: { digest: 'b'.repeat(64), preparedAt: at } },
    previewStatus: 'refreshed' as const,
  };
  const notice = previewNotice(refreshed);
  const { previewStatus: _responseOnly, ...refetched } = refreshed;
  const client = new QueryClient();
  const counts = { total: 1, changes: 1, mentions: 0, notices: 0, needsYou: 1, drafts: {} };
  client.setQueryData(reviewQuery.queryKey, {
    counts,
    items: [{ type: 'change', tier: 'needs_you', at, proposal: p }],
  });
  publishDecision(client, refreshed);
  client.setQueryData(reviewQuery.queryKey, {
    counts,
    items: [{ type: 'change', tier: 'needs_you', at, proposal: refetched }],
  });
  expect(render(<DecisionPreviewNotice notice={notice} proposal={refetched} />)).toContain(
    'review this decision',
  );
  expect(render(<ProposalDecisionCard proposal={p} />, client)).toContain('Sample count');
  const run = vi.spyOn(api, 'run').mockResolvedValueOnce(refetched);
  await decideSupported(refetched, true, 'reviewed');
  expect(run).toHaveBeenCalledExactlyOnceWith(proposalsApprove, {
    id: p.id,
    reason: 'reviewed',
    expectedPreview: 'b'.repeat(64),
  });
  expect(render(<ProposalDecisionCard proposal={p} busy />).match(/disabled=""/g)).toHaveLength(2);
});

it('uses the same persisted input card in chat as Review, without a competing generic approval link', () => {
  const p = proposal();
  const item = { type: 'change', tier: 'needs_you', at, proposal: p } as ReviewItem;
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
  const markup = render(
    <ol>
      <ConversationMessages messages={messages} agentName="Test" running={false} review={[item]} />
    </ol>,
  );
  expect(markup.match(/Experiment input decision: SOP-0001/g)).toHaveLength(1);
  expect(markup).toContain('Accept as an experiment input');
  expect(markup).not.toContain('Review 1 proposed change');
});

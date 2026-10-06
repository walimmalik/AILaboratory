import {
  type Proposal,
  proposalsApprove,
  type ReviewItem,
  SopMaterialDecisionPreview,
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
const material = {
  role: 'plate',
  label: 'Assay plate',
  type: 'labware',
  requirements: '96 wells; high binding. <check against the choice>',
  cite: [
    { document: 'doc_00000000000000000000000000', page: 2, quote: 'Use a high-binding plate.' },
  ],
};
const question = {
  id: 'plate',
  about: { material: 'plate' },
  question: 'Which assay plate will this experiment use?',
  stage: {
    stage: 'experiment',
    reason: 'Chosen for each experiment',
    binding: { type: 'material_role', role: 'plate' },
  },
  responses: [{ text: 'We have not selected a plate.', by: user, at, version: 1 }],
  disposition: { status: 'open' },
};
const action = {
  type: 'defer',
  sop: id,
  expectedVersion: 1,
  question: 'plate',
  reason: 'Keep the choice explicit',
  obligation: {
    stage: 'experiment',
    condition: 'Choose Assay plate explicitly for each experiment.',
    binding: { type: 'material_role', role: 'plate' },
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
      label: 'Declared role exists',
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
  const preview = SopMaterialDecisionPreview.parse({
    type: 'sop_experiment_material',
    target: { id, name: 'SOP-0001', label: 'Coating', version: 1 },
    question,
    material,
    reason: action.reason,
    acceptance: { status: 'deferred', by: 'applying_person', proposedBy: user, action },
    before: { target: { id, version: 1 }, reads: [], readiness },
    after: { target: { id, version: 2 }, reads: [], readiness },
    changedPath: '/questions/plate/disposition',
    consequence: 'Still requires an explicit material choice for the experiment.',
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
function savedRecord(p: Proposal, deferred = true, defaulted = false) {
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
      materials: [
        { ...material, ...(defaulted ? { default: 'lwt_00000000000000000000000000' } : {}) },
      ],
      questions: [
        {
          ...question,
          disposition: deferred
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

it('shows the whole declared material and exact question/response, without selecting or validating a material', () => {
  const markup = render(<PendingProposal proposal={proposal()} />);
  for (const text of [
    'Accept as an experiment material choice',
    'Which assay plate will this experiment use?',
    'We have not selected a plate.',
    'Assay plate',
    'labware',
    '96 wells; high binding.',
    '&lt;check against the choice&gt;',
    'Use a high-binding plate.',
    'page 2',
    'Choose Assay plate explicitly for each experiment.',
    'Still requires an explicit material choice for the experiment.',
    'No actual material is selected',
    'requirements still need checking',
    'method and its section reviews stay unchanged',
    'final confirmation is separate',
    'Declared role exists',
  ])
    expect(markup).toContain(text);
  expect(markup).not.toContain('Values included in this review');
  expect(markup).not.toContain('Existing default:');
  expect(markup).not.toContain('href="/records/doc_');
  expect(markup).toContain('Apply decision');
});

it('uses an actual matching deferred receipt for accepted display and keeps missing/open/defaulted and rejected results honest', () => {
  const p = proposal();
  const approved = {
    ...p,
    status: 'approved' as const,
    receipt: { output: savedRecord(p), recordIds: [id], committedAt: at },
  };
  const markup = render(<ProposalDecisionCard proposal={approved} />);
  expect(markup).toContain('Accepted as an experiment material choice: Which assay plate');
  expect(markup).toContain('SOP still draft');
  expect(markup).not.toContain('Apply decision');
  for (const output of [
    savedRecord(p, false),
    savedRecord(p, true, true),
    savedRecord({ ...p, id: 'prp_11111111111111111111111111' }),
  ]) {
    const unavailable = render(
      <ProposalDecisionCard proposal={{ ...approved, receipt: { ...approved.receipt, output } }} />,
    );
    expect(unavailable).toContain('saved material-choice acceptance is unavailable');
    expect(unavailable).not.toContain('Accepted as an experiment material choice:');
  }
  const rejected = render(<ProposalDecisionCard proposal={{ ...p, status: 'rejected' }} />);
  expect(rejected).toContain('Decision rejected');
  expect(rejected).not.toContain('Accepted as an experiment material choice:');
});

it('retains material refresh feedback through plain refetch and uses the displayed new digest on the next action', async () => {
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
  expect(render(<ProposalDecisionCard proposal={p} />, client)).toContain('Assay plate');
  const run = vi.spyOn(api, 'run').mockResolvedValueOnce(refetched);
  await decideSupported(refetched, true, 'reviewed');
  expect(run).toHaveBeenCalledExactlyOnceWith(proposalsApprove, {
    id: p.id,
    reason: 'reviewed',
    expectedPreview: 'b'.repeat(64),
  });
  expect(render(<ProposalDecisionCard proposal={p} busy />).match(/disabled=""/g)).toHaveLength(2);
});

it('binds the same persisted material decision in chat and Review without a competing generic link', () => {
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
  expect(markup.match(/Experiment material decision: SOP-0001/g)).toHaveLength(1);
  expect(markup).toContain('Accept as an experiment material choice');
  expect(markup).not.toContain('Review 1 proposed change');
});

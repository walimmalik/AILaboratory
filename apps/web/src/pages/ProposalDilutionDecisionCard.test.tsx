import { type Proposal, proposalsApprove, SopDilutionDecisionPreview } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { reviewQuery } from '../queries.ts';
import {
  DecisionPreviewNotice,
  decideSupported,
  ProposalDecisionCard,
  previewNotice,
  publishDecision,
} from './ProposalDecisionCard.tsx';

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
const at = '2026-10-06T00:00:00Z';
const id = `sop_${'0'.repeat(26)}`;
const user = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
const quantity = (value: string) => ({ value, unit: 'mL' });
const source = {
  document: `doc_${'0'.repeat(26)}`,
  version: 2,
  file: `fil_${'0'.repeat(26)}`,
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Retained dilution',
  printedRevision: 'Edition B',
};
const completion = {
  type: 'dilution_final_volume',
  step: 'dilute',
  variable: 'final_volume',
  factor: { variable: 'factor', value: '10' },
  sample: { variable: 'sample', expression: 'final_volume / factor' },
  diluent: { variable: 'diluent', expression: 'final_volume - sample' },
  value: quantity('5'),
  source,
  passage: 'passage-2',
  quote: 'Dilute 1:10 to 5 mL. Keep cold.',
  associationDigest: 'c'.repeat(64),
};
const question = {
  id: 'final-volume',
  about: { step: 'dilute', variable: 'final_volume' },
  question: 'Which final volume was omitted?',
  stage: { stage: 'method', reason: 'Missing source transcription' },
  responses: [{ text: 'Please use the retained instructions.', by: user, at, version: 1 }],
  disposition: { status: 'open' },
};
const otherQuestion = {
  ...question,
  id: 'temperature',
  question: 'Which temperature?',
  responses: [],
};
const variables = [
  { name: 'final_volume', label: 'Final volume', kind: 'default', value: quantity('5') },
  {
    name: 'wash_volume',
    label: 'Wash volume',
    kind: 'default',
    value: quantity('0.3'),
    note: 'Other estimate still needs checking',
  },
];
const readiness = {
  recordId: id,
  version: 1,
  status: 'draft',
  ready: false,
  sections: [],
  checks: [
    {
      id: 'arithmetic',
      label: 'Dilution arithmetic agrees',
      source: 'Calculator',
      severity: 'blocker',
      passed: true,
    },
  ],
  missing: ['Which temperature?'],
  assumed: [],
  unchecked: [],
  notApplicable: [],
};
function proposal(): Proposal {
  const action = {
    type: 'resolve',
    sop: id,
    expectedVersion: 1,
    question: question.id,
    reason: 'Complete the source transcription',
    basis: { type: 'evidence', sources: [source], records: [] },
    affected: [{ id, version: 1, paths: ['/variables/final_volume/value'] }],
    completion,
  };
  const preview = SopDilutionDecisionPreview.parse({
    type: 'sop_dilution_final_volume',
    target: { id, name: 'SOP-0001', label: 'Dilution', version: 1 },
    reason: action.reason,
    before: { target: { id, version: 1 }, reads: [], readiness },
    after: { target: { id, version: 2 }, reads: [], readiness },
    evidence: {
      path: '/variables/final_volume',
      after: { source: 'datasheet', by: 'applying_person' },
    },
    confirmation: {
      by: 'applying_person',
      section: {
        id: 'variables',
        title: 'Values',
        before: {
          variables: variables.map((v) =>
            v.name === 'final_volume' ? { ...v, value: undefined } : v,
          ),
        },
        after: { variables },
      },
      evidence: {
        '/variables/wash_volume': { source: 'assumed', by: user, note: 'Original estimate' },
      },
      assumed: ['/variables/wash_volume'],
      unchecked: ['/variables/wash_volume'],
    },
    remainingQuestions: 1,
    resultingStatus: 'draft',
    finalConfirmation: 'separate',
    scientificValidation: 'not_claimed',
    question,
    step: {
      id: 'dilute',
      action: 'manual',
      title: 'Dilute the sample',
      text: 'Follow retained dilution instructions.',
      parameters: [],
    },
    completion,
    changes: [{ path: '/variables/final_volume/value', change: 'added', after: quantity('5') }],
    passage: {
      text: 'Dilute 1:10 to 5 mL. Keep cold.\nCheck source conditions.',
      heading: ['Method', 'Dilution'],
      page: 4,
    },
    warnings: ['Cold handling remains to check'],
    calculation: {
      before: { status: 'missing', waitsOn: ['final_volume'] },
      after: {
        status: 'calculated',
        final: quantity('5'),
        sample: quantity('0.5'),
        diluent: quantity('4.5'),
        recomposed: quantity('5'),
        factor: '10',
      },
    },
    acceptance: {
      status: 'resolved',
      by: 'applying_person',
      proposedBy: user,
      action,
      relationship:
        'The applying person accepts that this retained quotation supplies this declared dilution final volume.',
    },
  });
  return {
    id: `prp_${'0'.repeat(26)}`,
    operationId: 'sops.answer_question',
    input: action,
    preview,
    decision: {
      origin: { type: 'unknown' },
      reads: [],
      writes: [],
      sources: [],
      scope: { type: 'question_disposition', disposition: preview.acceptance.action },
      previewIdentity: { digest: 'd'.repeat(64), preparedAt: at },
    },
    status: 'pending',
    proposedBy: user,
    proposedAt: at,
  };
}
function render(node: ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function savedRecord(p: Proposal) {
  const preview = SopDilutionDecisionPreview.parse(p.preview);
  return {
    id,
    kind: 'sop',
    label: 'Dilution',
    name: 'SOP-0001',
    status: 'draft',
    version: 2,
    orgId: `org_${'0'.repeat(26)}`,
    labId: `lab_${'0'.repeat(26)}`,
    attributes: {
      variables,
      questions: [
        {
          ...question,
          disposition: {
            status: 'resolved',
            proposal: p.id,
            proposedBy: user,
            acceptedBy: user,
            at,
            action: preview.acceptance.action,
            recheck: { version: 2, checks: [{ id: 'arithmetic', passed: true }], at },
          },
        },
        otherQuestion,
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

it('shows exact retained source, selected question, unchanged factor and supplied calculation separately from assay validity', () => {
  const p = proposal();
  const markup = render(<ProposalDecisionCard proposal={p} />);
  for (const words of [
    'Missing → 5 mL',
    'Dilute the sample',
    'Which final volume was omitted?',
    'Please use the retained instructions.',
    'Dilution factor unchanged: 10',
    'Calculated sample: 0.5 mL',
    'Diluent: 4.5 mL',
    'Recomposed volume: 5 mL',
    'Check source conditions.',
    'Cold handling remains to check',
    'you accept that this retained quotation supplies this final volume',
    'does not establish full assay validity or physical feasibility',
    'Only this selected method question',
    'whole Values section',
    'Wash volume',
    'unverified estimate',
    'source needs checking',
    'Which temperature?',
    '1 open',
    'final confirmation is separate',
  ])
    expect(markup).toContain(words);
  const href = markup.match(/href="(\/library\/instructions[^"]*)"/)?.[1];
  expect(defaultParseSearch(href?.slice(href.indexOf('?')).replaceAll('&amp;', '&') ?? '')).toEqual(
    { source, passage: completion.passage },
  );
  expect(markup).toContain(`#sop-question-${question.id}`);
  expect(markup).not.toContain('Accepted as an experiment');
});

it('displays producer quantities directly rather than recomputing them in the UI', () => {
  const p = proposal();
  const preview = SopDilutionDecisionPreview.parse(p.preview);
  if (preview.calculation.after.status !== 'calculated') throw new Error('Calculated fixture');
  preview.calculation.after.sample = { value: '321', unit: 'uL' };
  expect(render(<ProposalDecisionCard proposal={{ ...p, preview }} />)).toContain(
    'Calculated sample: 321 µL',
  );
});

it('derives selected resolution from matching actual receipt and refuses missing, mismatched or incomplete saved outcomes', () => {
  const p = proposal();
  const saved = savedRecord(p);
  const approved = {
    ...p,
    status: 'approved' as const,
    receipt: { output: saved, recordIds: [id], committedAt: at },
  };
  const markup = render(<ProposalDecisionCard proposal={approved} />);
  expect(markup).toContain('Resolved selected method question: Which final volume was omitted?');
  expect(markup).toContain('Recorded final volume: 5 mL');
  expect(markup).toContain('SOP still draft');
  expect(markup).not.toContain('Resolved selected method question: Which temperature?');
  expect(markup).not.toContain('Apply decision');
  const preview = SopDilutionDecisionPreview.parse(p.preview);
  const wrongCompletion = {
    ...saved,
    attributes: {
      ...saved.attributes,
      questions: saved.attributes.questions.map((q) => ({
        ...q,
        disposition: {
          ...q.disposition,
          action: {
            ...preview.acceptance.action,
            completion: { ...preview.completion, associationDigest: 'f'.repeat(64) },
          },
        },
      })),
    },
  };
  expect(
    render(
      <ProposalDecisionCard
        proposal={{ ...approved, receipt: { ...approved.receipt, output: wrongCompletion } }}
      />,
    ),
  ).toContain('saved method resolution is unavailable');
  for (const output of [
    { ...saved, id: `sop_${'1'.repeat(26)}` },
    savedRecord({ ...p, id: `prp_${'1'.repeat(26)}` }),
    { ...saved, attributes: { ...saved.attributes, variables: [] } },
    { ...saved, attributes: { ...saved.attributes, questions: [question] } },
  ])
    expect(
      render(
        <ProposalDecisionCard
          proposal={{ ...approved, receipt: { ...approved.receipt, output } }}
        />,
      ),
    ).toContain('saved method resolution is unavailable');
  expect(render(<ProposalDecisionCard proposal={{ ...p, status: 'approved' }} />)).toContain(
    'saved result is unavailable',
  );
});

it('retains refreshed feedback through cache refetch and submits only the new viewed digest on another action', async () => {
  const p = proposal();
  if (!p.decision) throw new Error('Metadata');
  const refreshed = {
    ...p,
    decision: { ...p.decision, previewIdentity: { digest: 'e'.repeat(64), preparedAt: at } },
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
  const run = vi.spyOn(api, 'run').mockResolvedValueOnce(refetched);
  await decideSupported(refetched, true, 'reviewed');
  expect(run).toHaveBeenCalledExactlyOnceWith(proposalsApprove, {
    id: p.id,
    reason: 'reviewed',
    expectedPreview: 'e'.repeat(64),
  });
  expect(render(<ProposalDecisionCard proposal={p} busy />).match(/disabled=""/g)).toHaveLength(2);
});

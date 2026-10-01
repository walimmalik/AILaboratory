import { z } from 'zod';
import { ActivityEntry, defineContract, Proposal, ProposalStatus } from '../operation.ts';

const ProposalId = z.string().regex(/^prp_[0-9A-HJKMNP-TV-Z]{26}$/);

export const proposalsList = defineContract({
  id: 'proposals.list',
  verbs: { done: 'looked at the proposals', intent: 'look at the proposals' },
  summary: 'List changes agents proposed, newest first',
  effect: 'read',
  input: z.object({ status: ProposalStatus.optional() }),
  output: z.object({ proposals: z.array(Proposal) }),
});

export const proposalsApprove = defineContract({
  id: 'proposals.approve',
  verbs: { done: 'confirmed a proposed change', intent: 'confirm a proposed change' },
  summary: "Approve an agent's proposed change and apply it (people only)",
  effect: 'write',
  input: z.object({ id: ProposalId, reason: z.string().min(1).optional() }),
  output: Proposal,
});

export const proposalsReject = defineContract({
  id: 'proposals.reject',
  verbs: { done: 'rejected a proposed change', intent: 'reject a proposed change' },
  summary: "Reject an agent's proposed change (people only)",
  effect: 'write',
  input: z.object({ id: ProposalId, reason: z.string().min(1).optional() }),
  output: Proposal,
});

export const activityList = defineContract({
  id: 'activity.list',
  verbs: { done: 'read the activity ledger', intent: 'read the activity ledger' },
  summary: "Read the lab's activity ledger, newest first",
  effect: 'read',
  input: z.object({
    limit: z.number().int().min(1).max(200).optional(),
    before: z.iso.datetime().optional(),
    since: z.iso.datetime().optional().describe('Only entries after this time'),
    record: z.string().optional().describe('Only entries that touched this record ID'),
    conversation: z
      .string()
      .optional()
      .describe('Only what an assistant conversation did, and the asks that started it'),
    actor: z
      .enum(['people', 'agents'])
      .optional()
      .describe('Only what people did, or only what agents did'),
    mine: z.boolean().optional().describe('Only what you did, or agents did for you'),
  }),
  output: z.object({ entries: z.array(ActivityEntry) }),
});

/** One operation in a change set; string values `$N.path` read step N's output (1-based). */
export const ChangeStep = z.strictObject({
  operation: z.string().min(1).describe('An operation ID, e.g. records.create'),
  input: z
    .record(z.string(), z.unknown())
    .describe('Its input. "$1.id" anywhere in it is replaced by the id step 1 returned'),
});

export const changesApply = defineContract({
  id: 'changes.apply',
  verbs: { done: 'made a set of changes', intent: 'make a set of changes' },
  summary:
    'Run several operations as one change, in order and all or nothing (plan 004e R2, ADR 0051). Later steps can use earlier outputs as "$1.id". When any step needs a person, an agent gets one proposal for the whole set',
  effect: 'write',
  input: z.object({
    steps: z.array(ChangeStep).min(1).max(50),
    reason: z.string().min(1).optional().describe('Why, in a sentence, for the person reviewing'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        operation: z.string(),
        /** The input as run, with references filled in. */
        input: z.unknown(),
        output: z.unknown(),
      }),
    ),
  }),
});

import { z } from 'zod';
import { Sha256 } from '../files.ts';
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
  summary:
    'Apply a proposed change (people only). Prepared draft-volume, experiment input/material-role or bounded exact-source dilution final-volume decisions require the digest shown in expectedPreview. Dilution completion accepts the shown quotation-to-field relationship and literal source-number/arithmetic checks, changes only its missing default/citation/evidence and selected question, and reviews the disclosed whole Values section; it does not validate the full assay. Experiment obligations still require explicit downstream choices. The SOP remains draft. Changed meaning returns the same pending proposal with previewStatus refreshed; an old token returns previewStatus stale. Neither applies the change: review the returned preview and click again with its current digest. Approved retries return the durable receipt',
  effect: 'write',
  input: z.strictObject({
    id: ProposalId,
    reason: z.string().min(1).optional(),
    expectedPreview: Sha256.optional().describe(
      'The exact decision.previewIdentity.digest shown to the person; required for a pending prepared decision',
    ),
  }),
  output: Proposal.extend({
    previewStatus: z
      .enum(['stale', 'refreshed'])
      .optional()
      .describe('Only returned while still pending: no scientific change was applied'),
  }),
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
        /** A calculator step's handle, for `calculated` evidence in a later step ("$1.calculation"). */
        calculation: z.string().optional(),
      }),
    ),
  }),
});

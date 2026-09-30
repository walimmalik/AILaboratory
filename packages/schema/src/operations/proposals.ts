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
  }),
  output: z.object({ entries: z.array(ActivityEntry) }),
});

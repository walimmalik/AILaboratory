import { activityList, proposalsApprove, proposalsList, proposalsReject } from '@ailab/schema';
import { listActivity } from './activity.ts';
import { OperationError, toErrorBody } from './errors.ts';
import { decideProposal, findProposal, listProposals, toProposal } from './proposal-store.ts';
import { implement } from './registry.ts';

/** What each approval's applied run touched, by proposal, until its ledger entry is written. */
const applied = new Map<string, string[]>();

export const proposalOperations = [
  implement(proposalsList, {
    run: async (ctx, input, deps) => ({
      proposals: await listProposals(deps.db, ctx, input.status),
    }),
  }),
  implement(proposalsApprove, {
    actors: 'people',
    agentPolicy: 'direct',
    // The records the applied run touched, not the proposal's preview, whose new records were
    // rolled back and got other IDs when they were made for real.
    touches: (_input, output) => {
      if (!output) return [];
      const ids = applied.get(output.id) ?? [];
      applied.delete(output.id);
      return ids;
    },
    outcome: (output) => (output.status === 'approved' ? 'approved' : 'failed'),
    run: async (ctx, input, deps) => {
      const row = await findProposal(deps.db, ctx, input.id, { forUpdate: true });
      if (row.status !== 'pending') {
        throw new OperationError('invalid_state', `Proposal ${row.id} is already ${row.status}`);
      }
      // The approver reviewed the change, so it confirms the sections it touches (ADR 0021).
      const agentCtx = { ...ctx, actor: row.proposedBy, approvedBy: ctx.actor };
      let ran: Awaited<ReturnType<typeof deps.registry.execute>>;
      try {
        ran = await deps.registry.execute(
          agentCtx,
          row.operationId,
          row.input,
          { approvedProposalId: row.id },
          deps.db,
        );
      } catch (error) {
        return decideProposal(deps.db, row.id, {
          status: 'failed',
          decidedBy: ctx.actor,
          reason: input.reason,
          error: toErrorBody(error),
        });
      }
      const decided = await decideProposal(deps.db, row.id, {
        status: 'approved',
        decidedBy: ctx.actor,
        reason: input.reason,
      });
      if (ran.status === 'done') {
        applied.set(decided.id, deps.registry.touchedBy(row.operationId, row.input, ran.output));
      }
      return decided;
    },
  }),
  implement(proposalsReject, {
    actors: 'people',
    agentPolicy: 'direct',
    outcome: () => 'rejected',
    run: async (ctx, input, deps) => {
      const row = await findProposal(deps.db, ctx, input.id, { forUpdate: true });
      if (row.status !== 'pending') {
        throw new OperationError('invalid_state', `Proposal ${row.id} is already ${row.status}`);
      }
      return decideProposal(deps.db, row.id, {
        status: 'rejected',
        decidedBy: ctx.actor,
        reason: input.reason,
      });
    },
  }),
  implement(activityList, {
    run: async (ctx, input, deps) => ({
      entries: await listActivity(deps.db, ctx, input),
    }),
  }),
];

export { toProposal };

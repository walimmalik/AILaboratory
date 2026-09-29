import { activityList, proposalsApprove, proposalsList, proposalsReject } from '@ailab/schema';
import { listActivity } from './activity.ts';
import { OperationError, toErrorBody } from './errors.ts';
import { decideProposal, findProposal, listProposals, toProposal } from './proposal-store.ts';
import { implement } from './registry.ts';

export const proposalOperations = [
  implement(proposalsList, {
    run: async (ctx, input, deps) => ({
      proposals: await listProposals(deps.db, ctx, input.status),
    }),
  }),
  implement(proposalsApprove, {
    actors: 'people',
    agentPolicy: 'direct',
    touches: (_input, output) => {
      const preview = output?.preview as { id?: string } | undefined;
      return preview?.id ? [preview.id] : [];
    },
    outcome: (output) => (output.status === 'approved' ? 'approved' : 'failed'),
    run: async (ctx, input, deps) => {
      const row = await findProposal(deps.db, ctx, input.id, { forUpdate: true });
      if (row.status !== 'pending') {
        throw new OperationError('invalid_state', `Proposal ${row.id} is already ${row.status}`);
      }
      // The approver reviewed the change, so it confirms the sections it touches (ADR 0021).
      const agentCtx = { ...ctx, actor: row.proposedBy, approvedBy: ctx.actor };
      try {
        await deps.registry.execute(
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
      return decideProposal(deps.db, row.id, {
        status: 'approved',
        decidedBy: ctx.actor,
        reason: input.reason,
      });
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
      entries: await listActivity(deps.db, ctx, { limit: input.limit, before: input.before }),
    }),
  }),
];

export { toProposal };

import {
  activityList,
  proposalsApprove,
  proposalsList,
  proposalsReject,
  ScientificDecisionMetadata,
} from '@ailab/schema';
import { and, eq } from 'drizzle-orm';
import { conversations } from '../db/schema.ts';
import type { RecordContext } from '../records/service.ts';
import { revalidateSopDefaultDecision } from '../review/sop-default-decision.ts';
import {
  executeSopInputDecision,
  revalidateSopInputDecision,
} from '../review/sop-input-decision.ts';
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
    replayed: async (ctx, input, deps) => {
      const row = await findProposal(deps.db, ctx, input.id, { forUpdate: true });
      return row.status === 'approved' && row.receipt !== null;
    },
    // The records the applied run touched, not the proposal's preview, whose new records were
    // rolled back and got other IDs when they were made for real.
    touches: (_input, output) => output?.receipt?.recordIds ?? [],
    outcome: (output) =>
      output.status === 'approved'
        ? 'approved'
        : output.status === 'pending'
          ? 'proposed'
          : 'failed',
    run: async (ctx, input, deps) => {
      const row = await findProposal(deps.db, ctx, input.id, { forUpdate: true });
      if (row.status === 'approved') {
        if (row.receipt) return toProposal(row);
        throw new OperationError(
          'invalid_state',
          `Proposal ${row.id} was approved without a stored result; its change will not be run again`,
        );
      }
      if (row.status !== 'pending') {
        throw new OperationError('invalid_state', `Proposal ${row.id} is already ${row.status}`);
      }
      if (row.proposedBy.type === 'agent' && row.proposedBy.sessionRef?.startsWith('cnv_')) {
        const id = row.proposedBy.sessionRef;
        // Private conversation ownership doesn't restrict another lab member's approval.
        // This lock is only taken after the proposal lock; context reads never lock proposals.
        const [conversation] = await deps.db
          .select({ status: conversations.status })
          .from(conversations)
          .where(and(eq(conversations.id, id), eq(conversations.labId, ctx.labId)))
          .for('update');
        if (conversation && (conversation.status === 'running' || deps.assistant.isRunning(id)))
          throw new OperationError(
            'invalid_state',
            'The assistant is still working on this change. Wait for its turn to finish before applying it.',
          );
      }
      // The approver reviewed the change, so it confirms the sections it touches (ADR 0021).
      let agentCtx: RecordContext = {
        ...ctx,
        actor: row.proposedBy.type === 'agent' ? row.proposedBy : ctx.actor,
        approvedBy: ctx.actor,
        // Ordinary proposals have no stored preparation origin; never borrow the approver's request.
        origin: row.decision?.origin ?? { type: 'unknown' as const },
      };
      let operationInput = row.input;
      if (row.decision) {
        if (!input.expectedPreview)
          throw new OperationError(
            'invalid_input',
            'Review this decision and pass the exact preview digest before applying it',
          );
        const metadata = ScientificDecisionMetadata.safeParse(row.decision);
        if (!metadata.success)
          throw new OperationError('invalid_input', 'Unsupported scientific decision metadata');
        if (metadata.data.scope.type === 'question_disposition') {
          const result = await revalidateSopInputDecision(deps, ctx, row.id, input.expectedPreview);
          if (result.status !== 'unchanged')
            return { ...result.proposal, previewStatus: result.status };
          const output = await executeSopInputDecision(deps, result.authorization);
          return decideProposal(deps.db, row.id, {
            status: 'approved',
            decidedBy: ctx.actor,
            reason: input.reason,
            receipt: { output, recordIds: [output.id], committedAt: new Date().toISOString() },
          });
        }
        const result = await revalidateSopDefaultDecision(deps, ctx, row.id, input.expectedPreview);
        if (result.status !== 'unchanged')
          return { ...result.proposal, previewStatus: result.status };
        agentCtx = result.executionContext;
        operationInput = result.prepared.input;
      }
      let ran: Awaited<ReturnType<typeof deps.registry.execute>>;
      try {
        ran = await deps.registry.execute(
          agentCtx,
          row.operationId,
          operationInput,
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
      if (ran.status !== 'done')
        throw new Error('An approved proposal must produce a committed result');
      return decideProposal(deps.db, row.id, {
        status: 'approved',
        decidedBy: ctx.actor,
        reason: input.reason,
        receipt: {
          output: ran.output,
          recordIds: deps.registry.touchedBy(row.operationId, operationInput, ran.output),
          ...(ran.calculation ? { calculation: ran.calculation } : {}),
          committedAt: new Date().toISOString(),
        },
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
      entries: await listActivity(deps.db, ctx, input),
    }),
  }),
];

export { toProposal };

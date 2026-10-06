import { newId } from '@ailab/domain';
import type {
  Actor,
  OperationErrorBody,
  Proposal,
  ProposalReceipt,
  ScientificDecisionMetadata,
} from '@ailab/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { proposals } from '../db/schema.ts';
import type { RecordContext } from '../records/service.ts';
import { OperationError } from './errors.ts';

type Row = typeof proposals.$inferSelect;

export async function createProposal(
  db: Db,
  ctx: RecordContext,
  input: {
    operationId: string;
    input: unknown;
    preview: unknown;
    reason?: string | undefined;
    decision?: ScientificDecisionMetadata;
  },
): Promise<Proposal> {
  const [row] = await db
    .insert(proposals)
    .values({
      id: newId('prp'),
      orgId: ctx.orgId,
      labId: ctx.labId,
      operationId: input.operationId,
      input: input.input ?? {},
      preview: input.preview ?? null,
      decision: input.decision ?? null,
      status: 'pending',
      proposedBy: ctx.actor,
      proposedAt: new Date(),
      reason: input.reason ?? null,
    })
    .returning();
  if (!row) throw new Error('Expected a proposal row');
  return toProposal(row);
}

/** Refreshes exact prepared facts without deciding or replacing the pending proposal. */
export async function refreshPendingDecision(
  db: Db,
  ctx: RecordContext,
  id: string,
  prepared: { input: unknown; preview: unknown; decision: ScientificDecisionMetadata },
): Promise<Proposal> {
  const [row] = await db
    .update(proposals)
    .set(prepared)
    .where(
      and(eq(proposals.id, id), eq(proposals.labId, ctx.labId), eq(proposals.status, 'pending')),
    )
    .returning();
  if (!row) throw new OperationError('invalid_state', 'The prepared decision is no longer pending');
  return toProposal(row);
}

export async function findProposal(
  db: Db,
  ctx: RecordContext,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<Row> {
  const query = db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.labId, ctx.labId)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new OperationError('not_found', `No proposal ${id} in this lab`);
  return row;
}

export async function listProposals(
  db: Db,
  ctx: RecordContext,
  status?: Proposal['status'],
): Promise<Proposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.labId, ctx.labId), status ? eq(proposals.status, status) : undefined))
    .orderBy(desc(proposals.proposedAt), desc(proposals.id));
  return rows.map(toProposal);
}

export async function decideProposal(
  db: Db,
  id: string,
  decision: {
    status: 'approved' | 'rejected' | 'failed';
    decidedBy: Actor;
    reason?: string | undefined;
    error?: OperationErrorBody | undefined;
    receipt?: ProposalReceipt | undefined;
  },
): Promise<Proposal> {
  const [row] = await db
    .update(proposals)
    .set({
      status: decision.status,
      decidedBy: decision.decidedBy,
      decidedAt: new Date(),
      decisionReason: decision.reason ?? null,
      error: decision.error ?? null,
      receipt: decision.receipt ?? null,
    })
    .where(eq(proposals.id, id))
    .returning();
  if (!row) throw new Error('Expected a proposal row');
  return toProposal(row);
}

export function toProposal(row: Row): Proposal {
  return {
    id: row.id,
    operationId: row.operationId,
    input: row.input,
    preview: row.preview,
    ...(row.decision ? { decision: row.decision } : {}),
    status: row.status,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt.toISOString(),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.receipt ? { receipt: row.receipt } : {}),
  };
}

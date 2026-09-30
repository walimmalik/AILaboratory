import type { Proposal, Readiness, RecordEnvelope } from '@ailab/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { records } from './db/schema.ts';
import type { OperationRegistry } from './operations/index.ts';
import type { RecordContext } from './records/service.ts';

/** What one settling pass did. */
export interface SettleReport {
  /** Proposals the seed loader made that the person running the seed approved. */
  approved: string[];
  /** Drafts the seed loader made that are now confirmed and active. */
  activated: string[];
  /** Drafts left for Review, with what stands in the way. */
  left: { name: string; reason: string }[];
  /** Proposals that could not be applied, with why. */
  failed: { id: string; reason: string }[];
}

/**
 * Seeding needs no approvals (ADR 0044): running the seed is the person's decision to take the
 * seed lab as it is. After each loading pass this approves the seed loader's proposals and confirms
 * and activates its drafts, as the person who ran the seed, with `reason` in history. A draft with
 * a failing blocker (a labware type without its outer size) is left for Review untouched, so what
 * reaches a person is only what the seed can't settle.
 */
export async function settleSeed(
  registry: OperationRegistry,
  db: Db,
  person: RecordContext,
  loader: RecordContext,
  reason: string,
): Promise<SettleReport> {
  const report: SettleReport = { approved: [], activated: [], left: [], failed: [] };
  const byLoader = (actor: Proposal['proposedBy']) =>
    actor.type === 'agent' &&
    loader.actor.type === 'agent' &&
    actor.agentName === loader.actor.agentName &&
    actor.onBehalfOf === loader.actor.onBehalfOf;

  // Oldest first, so a room is approved before the freezer inside it.
  const pending = (
    await run<{ proposals: Proposal[] }>(registry, person, 'proposals.list', { status: 'pending' })
  ).proposals
    .filter((p) => byLoader(p.proposedBy))
    .reverse();
  for (const proposal of pending) {
    const decided = await run<Proposal>(registry, person, 'proposals.approve', {
      id: proposal.id,
      reason,
    });
    if (decided.status === 'approved') report.approved.push(proposal.id);
    else report.failed.push({ id: proposal.id, reason: decided.error?.message ?? decided.status });
  }

  const drafts = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.labId, person.labId),
        eq(records.status, 'draft'),
        loader.actor.type === 'agent'
          ? sql`${records.createdBy}->>'agentName' = ${loader.actor.agentName}`
          : undefined,
      ),
    )
    .orderBy(asc(records.createdAt), asc(records.id));
  for (const { id } of drafts) {
    let state = await run<Readiness>(registry, person, 'records.readiness', { id });
    const blockers = state.checks.filter((c) => c.severity === 'blocker' && !c.passed);
    const record = await run<RecordEnvelope>(registry, person, 'records.get', { id });
    if (blockers.length > 0) {
      report.left.push({
        name: record.name,
        reason: blockers.map((c) => c.message ?? c.label).join('; '),
      });
      continue;
    }
    let current = record;
    for (const section of state.sections.filter((s) => s.state !== 'confirmed')) {
      current = await run<RecordEnvelope>(registry, person, 'records.confirm_section', {
        id,
        expectedVersion: current.version,
        section: section.id,
        reason,
      });
    }
    if (current.status === 'draft') {
      state = await run<Readiness>(registry, person, 'records.readiness', { id });
      if (state.ready) {
        current = await run<RecordEnvelope>(registry, person, 'records.activate', {
          id,
          expectedVersion: current.version,
          reason,
        });
      }
    }
    if (current.status === 'active') report.activated.push(current.name);
    else report.left.push({ name: current.name, reason: state.missing.join('; ') || 'not ready' });
  }
  return report;
}

async function run<T>(
  registry: OperationRegistry,
  ctx: RecordContext,
  id: string,
  input: unknown,
): Promise<T> {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
  return result.output as T;
}

import { EventEmitter } from 'node:events';
import { newId } from '@ailab/domain';
import type { ActivityEntry } from '@ailab/schema';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activity, records } from '../db/schema.ts';
import type { RecordContext } from '../records/service.ts';

/** In-process fan-out of new ledger entries, for the live activity stream. */
export class ActivityBus {
  readonly #emitter = new EventEmitter().setMaxListeners(0);

  publish(labId: string, entry: ActivityEntry): void {
    this.#emitter.emit(labId, entry);
  }

  subscribe(labId: string, listener: (entry: ActivityEntry) => void): () => void {
    this.#emitter.on(labId, listener);
    return () => this.#emitter.off(labId, listener);
  }
}

export async function recordActivity(
  db: Db,
  bus: ActivityBus,
  ctx: RecordContext,
  entry: Omit<ActivityEntry, 'id' | 'at' | 'actor' | 'recordNames'> & {
    actor?: ActivityEntry['actor'];
    /** Names already known, e.g. from a preview of a record that doesn't exist yet. */
    nameHints?: Record<string, string>;
  },
): Promise<ActivityEntry> {
  const at = new Date();
  const { nameHints, ...rest } = entry;
  const found = rest.recordIds.length
    ? await db
        .select({ id: records.id, name: records.name })
        .from(records)
        .where(inArray(records.id, rest.recordIds))
    : [];
  const full: ActivityEntry = {
    ...rest,
    recordNames: { ...nameHints, ...Object.fromEntries(found.map((r) => [r.id, r.name])) },
    id: newId('act'),
    at: at.toISOString(),
    actor: entry.actor ?? ctx.actor,
  };
  await db.insert(activity).values({
    id: full.id,
    orgId: ctx.orgId,
    labId: ctx.labId,
    at,
    actor: full.actor,
    operationId: full.operationId,
    outcome: full.outcome,
    recordIds: full.recordIds,
    recordNames: full.recordNames,
    proposalId: full.proposalId ?? null,
    input: full.input ?? null,
    error: full.error ?? null,
    durationMs: full.durationMs,
  });
  bus.publish(ctx.labId, full);
  return full;
}

export async function listActivity(
  db: Db,
  ctx: RecordContext,
  options: { limit?: number | undefined; before?: string | undefined },
): Promise<ActivityEntry[]> {
  const rows = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.labId, ctx.labId),
        options.before ? lt(activity.at, new Date(options.before)) : undefined,
      ),
    )
    .orderBy(desc(activity.at), desc(activity.id))
    .limit(options.limit ?? 50);
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    operationId: row.operationId,
    outcome: row.outcome,
    recordIds: row.recordIds,
    recordNames: row.recordNames,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    input: row.input,
    ...(row.error ? { error: row.error } : {}),
    durationMs: row.durationMs,
  }));
}

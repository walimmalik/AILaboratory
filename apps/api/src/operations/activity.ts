import { EventEmitter } from 'node:events';
import { newId } from '@ailab/domain';
import type { ActivityEntry } from '@ailab/schema';
import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activity, records } from '../db/schema.ts';
import type { RecordContext } from '../records/service.ts';

/** What `activity.list` can narrow the ledger to (ADR 0053). */
export interface ActivityFilter {
  limit?: number | undefined;
  before?: string | undefined;
  since?: string | undefined;
  record?: string | undefined;
  conversation?: string | undefined;
  actor?: 'people' | 'agents' | undefined;
  mine?: boolean | undefined;
}

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

/** Persists the ledger entry; the registry publishes it only after the outer commit. */
export async function recordActivity(
  db: Db,
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
        .where(and(eq(records.labId, ctx.labId), inArray(records.id, rest.recordIds)))
    : [];
  const full: ActivityEntry = {
    ...rest,
    recordNames: { ...nameHints, ...Object.fromEntries(found.map((r) => [r.id, r.name])) },
    id: newId('act'),
    at: at.toISOString(),
    actor: entry.actor ?? ctx.actor,
    ...(rest.input === undefined ? {} : { input: ledgerInput(rest.input) }),
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
  return full;
}

export async function listActivity(
  db: Db,
  ctx: RecordContext,
  options: ActivityFilter,
): Promise<ActivityEntry[]> {
  const me = ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf : ctx.actor.userId;
  const rows = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.labId, ctx.labId),
        options.before ? lt(activity.at, new Date(options.before)) : undefined,
        options.since ? gt(activity.at, new Date(options.since)) : undefined,
        options.record
          ? sql`${activity.recordIds} @> ${JSON.stringify([options.record])}::jsonb`
          : undefined,
        options.conversation
          ? or(
              sql`${activity.actor}->>'sessionRef' = ${options.conversation}`,
              sql`${activity.input}->>'conversationId' = ${options.conversation}`,
            )
          : undefined,
        options.actor
          ? sql`${activity.actor}->>'type' = ${options.actor === 'agents' ? 'agent' : 'user'}`
          : undefined,
        options.mine
          ? or(
              sql`${activity.actor}->>'userId' = ${me}`,
              sql`${activity.actor}->>'onBehalfOf' = ${me}`,
            )
          : undefined,
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

/** The input as the ledger keeps it: attached and uploaded files by size, not their whole content. */
function ledgerInput(input: unknown): unknown {
  const upload = input as
    | { mediaType?: unknown; base64?: unknown; text?: unknown }
    | null
    | undefined;
  if (upload?.mediaType && (typeof upload.base64 === 'string' || typeof upload.text === 'string')) {
    const { base64, text, ...rest } = upload as { base64?: string; text?: string };
    return { ...rest, characters: (base64 ?? text ?? '').length };
  }
  const files = (input as { attachments?: unknown } | null | undefined)?.attachments;
  if (!Array.isArray(files)) return input;
  return {
    ...(input as object),
    attachments: files.map((file: { name?: unknown; text?: unknown }) => ({
      name: file.name,
      characters: typeof file.text === 'string' ? file.text.length : 0,
    })),
  };
}

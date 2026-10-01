import type { Actor } from '@ailab/schema';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { recordSeen } from '../db/schema.ts';
import type { RecordContext } from './service.ts';

/** The person a seen marker belongs to: the person, or the one an agent works for (ADR 0053). */
export const seenBy = (actor: Actor) => (actor.type === 'agent' ? actor.onBehalfOf : actor.userId);

/** The version this person last looked at, if they have. */
export async function seenVersion(
  db: Db,
  ctx: RecordContext,
  recordId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ version: recordSeen.version })
    .from(recordSeen)
    .where(
      and(
        eq(recordSeen.userId, seenBy(ctx.actor)),
        eq(recordSeen.recordId, recordId),
        eq(recordSeen.labId, ctx.labId),
      ),
    );
  return row?.version;
}

/** Remembers that the person has seen the record at this version. */
export async function markSeen(db: Db, ctx: RecordContext, recordId: string, version: number) {
  const at = new Date();
  await db
    .insert(recordSeen)
    .values({ userId: seenBy(ctx.actor), recordId, labId: ctx.labId, version, at })
    .onConflictDoUpdate({
      target: [recordSeen.userId, recordSeen.recordId],
      set: { version, at },
    });
  return at;
}

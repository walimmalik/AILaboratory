import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@ailab/domain';
import type { Actor } from '@ailab/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { apiTokens, labs, orgs, users } from './db/schema.ts';
import type { RecordContext } from './records/service.ts';

/**
 * Local authentication (ADR 0006): bearer tokens stored as hashes. A token with an agent name makes
 * every change read "<agent> on behalf of <user>". Roles and SSO come later.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueToken(
  db: Db,
  input: { userId: string; agentName?: string },
): Promise<string> {
  const token = `ailab_${randomBytes(32).toString('base64url')}`;
  await db.insert(apiTokens).values({
    id: newId('tok'),
    tokenHash: hashToken(token),
    userId: input.userId,
    agentName: input.agentName ?? null,
  });
  return token;
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.tokenHash, hashToken(token)));
}

/** The actor and lab a token acts in, or undefined if the token is unknown or revoked. */
export async function resolveContext(db: Db, token: string): Promise<RecordContext | undefined> {
  const [row] = await db
    .select({ userId: users.id, orgId: users.orgId, agentName: apiTokens.agentName })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)));
  if (!row) return undefined;
  // One lab per org for now; lab selection arrives with multi-lab support.
  const [lab] = await db
    .select({ id: labs.id })
    .from(labs)
    .where(eq(labs.orgId, row.orgId))
    .orderBy(asc(labs.createdAt), asc(labs.id))
    .limit(1);
  if (!lab) return undefined;
  const actor: Actor = row.agentName
    ? { type: 'agent', agentName: row.agentName, onBehalfOf: row.userId }
    : { type: 'user', userId: row.userId };
  return { actor, orgId: row.orgId, labId: lab.id };
}

export interface Tenant {
  orgId: string;
  labId: string;
  userId: string;
}

/** Creates an org with one lab and one user. */
export async function createTenant(
  db: Db,
  input: { orgName: string; labName: string; userName: string; email?: string },
): Promise<Tenant> {
  const orgId = newId('org');
  const labId = newId('lab');
  const userId = newId('usr');
  await db.transaction(async (tx) => {
    await tx.insert(orgs).values({ id: orgId, name: input.orgName });
    await tx.insert(labs).values({ id: labId, orgId, name: input.labName });
    await tx
      .insert(users)
      .values({ id: userId, orgId, displayName: input.userName, email: input.email ?? null });
  });
  return { orgId, labId, userId };
}

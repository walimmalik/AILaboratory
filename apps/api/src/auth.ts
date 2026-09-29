import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newId } from '@ailab/domain';
import type { Actor } from '@ailab/schema';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { apiTokens, labs, orgs, sessions, users } from './db/schema.ts';
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
  const actor: Actor = row.agentName
    ? { type: 'agent', agentName: row.agentName, onBehalfOf: row.userId }
    : { type: 'user', userId: row.userId };
  return contextFor(db, actor, row.orgId);
}

async function contextFor(db: Db, actor: Actor, orgId: string): Promise<RecordContext | undefined> {
  // One lab per org for now; lab selection arrives with multi-lab support.
  const [lab] = await db
    .select({ id: labs.id })
    .from(labs)
    .where(eq(labs.orgId, orgId))
    .orderBy(asc(labs.createdAt), asc(labs.id))
    .limit(1);
  if (!lab) return undefined;
  return { actor, orgId, labId: lab.id };
}

// Web sign-in: a password (scrypt) exchanged for a session token carried in an HttpOnly cookie.

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(salt, 'base64url'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    },
  );
  return timingSafeEqual(actual, expected);
}

/** Sets a user's sign-in email and password. */
export async function setPassword(
  db: Db,
  input: { userId: string; email: string; password: string },
): Promise<void> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  await db
    .update(users)
    .set({
      email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
    })
    .where(eq(users.id, input.userId));
}

/** Checks an email and password and starts a session. Returns the session token, or undefined. */
export async function signIn(db: Db, email: string, password: string): Promise<string | undefined> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  // Hash anyway when the user is unknown, so timing doesn't reveal which emails exist.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !valid) return undefined;
  const token = `ailab_s_${randomBytes(32).toString('base64url')}`;
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function signOut(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** The person a session cookie belongs to, or undefined if it is unknown or expired. */
export async function resolveSession(db: Db, token: string): Promise<RecordContext | undefined> {
  const [row] = await db
    .select({ userId: users.id, orgId: users.orgId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return undefined;
  return contextFor(db, { type: 'user', userId: row.userId }, row.orgId);
}

const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(64).toString('base64url')}`;

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

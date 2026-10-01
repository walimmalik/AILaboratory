import { newId } from '@ailab/domain';
import type { AssistantMessage, Conversation, ConversationSummary } from '@ailab/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { conversationMessages, conversations } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import type { RecordContext } from '../records/service.ts';

type Row = typeof conversations.$inferSelect;
export type MessageRow = typeof conversationMessages.$inferSelect;

/** The person a caller acts for: themselves, or the person an agent works for. */
export function personOf(ctx: RecordContext): string {
  return ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf;
}

export function toSummary(row: Row): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    agentName: row.agentName,
    provider: row.provider,
    model: row.model,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createConversation(
  db: Db,
  ctx: RecordContext,
  input: { title: string; agentName: string; provider: string; model: string },
): Promise<Row> {
  const now = new Date();
  const [row] = await db
    .insert(conversations)
    .values({
      id: newId('cnv'),
      orgId: ctx.orgId,
      labId: ctx.labId,
      userId: personOf(ctx),
      title: input.title,
      status: 'idle',
      agentName: input.agentName,
      provider: input.provider,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Expected a conversation row');
  return row;
}

/** A conversation of the caller's person, in the caller's lab. Other people's are not found. */
export async function findConversation(
  db: Db,
  ctx: RecordContext,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<Row> {
  const query = db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.labId, ctx.labId),
        eq(conversations.userId, personOf(ctx)),
      ),
    );
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new OperationError('not_found', `There is no conversation ${id}`);
  return row;
}

export async function updateConversation(
  db: Db,
  id: string,
  changes: Partial<Pick<Row, 'status' | 'error' | 'agentName' | 'provider' | 'model'>>,
): Promise<Row> {
  const [row] = await db
    .update(conversations)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  if (!row) throw new Error(`Conversation ${id} disappeared`);
  return row;
}

type NewMessage =
  | Omit<Extract<AssistantMessage, { role: 'user' }>, 'id' | 'at'>
  | Omit<Extract<AssistantMessage, { role: 'assistant' }>, 'id' | 'at'>
  | Omit<Extract<AssistantMessage, { role: 'tool' }>, 'id' | 'at'>;

/** Appends a message at the end of the conversation. */
export async function appendMessage(
  db: Db,
  conversationId: string,
  message: NewMessage,
  provider?: { provider: string; model: string; raw?: unknown },
): Promise<AssistantMessage> {
  const at = new Date();
  const body = { id: newId('msg'), at: at.toISOString(), ...message } as AssistantMessage;
  await db.insert(conversationMessages).values({
    id: body.id,
    conversationId,
    seq: sql`(select coalesce(max(${conversationMessages.seq}), 0) + 1 from ${conversationMessages} where ${conversationMessages.conversationId} = ${conversationId})`,
    at,
    role: body.role,
    body,
    provider: provider?.provider ?? null,
    model: provider?.model ?? null,
    providerRaw: provider?.raw ?? null,
  });
  return body;
}

export async function messageRows(db: Db, conversationId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.seq));
}

export async function listConversations(
  db: Db,
  ctx: RecordContext,
  limit = 30,
): Promise<ConversationSummary[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.labId, ctx.labId), eq(conversations.userId, personOf(ctx))))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit);
  return rows.map(toSummary);
}

/**
 * The titles of these conversations in the lab, whoever had them: Review names the conversation
 * an agent's drafts came from (review 2026-10-01 item 16).
 */
export async function conversationTitles(
  db: Db,
  ctx: RecordContext,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.labId, ctx.labId), inArray(conversations.id, ids)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

export async function getConversation(
  db: Db,
  ctx: RecordContext,
  id: string,
): Promise<Conversation> {
  const row = await findConversation(db, ctx, id);
  const messages = await messageRows(db, id);
  return { ...toSummary(row), messages: messages.map((m) => m.body) };
}

/** After a restart nothing is running: conversations left "running" were cut off. */
export async function markInterrupted(db: Db): Promise<void> {
  await db
    .update(conversations)
    .set({
      status: 'failed',
      error: 'The API restarted while the assistant was working. Send your message again.',
    })
    .where(eq(conversations.status, 'running'));
}

import { formatName, newId } from '@ailab/domain';
import {
  type Actor,
  type KindDefinition,
  type RecordEnvelope,
  RecordLink,
  type RecordOperation,
  type RecordStatus,
  type RecordVersion,
} from '@ailab/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { nameCounters, recordLinks, records, recordVersions } from '../db/schema.ts';
import { RecordError } from './errors.ts';
import type { KindRegistry } from './kinds.ts';

/** Who is acting, and in which lab. Every record operation runs in one. */
export interface RecordContext {
  actor: Actor;
  orgId: string;
  labId: string;
}

type RecordRow = typeof records.$inferSelect;
type Link = Omit<RecordLink, 'fromId'>;

export interface CreateRecordInput {
  kind: string;
  label: string;
  attributes: unknown;
  /** New records start as drafts unless created active. */
  status?: 'draft' | 'active';
  reason?: string;
}

export interface UpdateRecordInput {
  expectedVersion: number;
  label?: string;
  attributes?: unknown;
  reason?: string;
}

export interface TransitionInput {
  expectedVersion: number;
  reason?: string;
}

/**
 * Creates, changes and reads records with full history (ADR 0009), archive-only removal,
 * readable names (ADR 0013) and a links table kept in sync (ADR 0014).
 * Every change requires the version the caller last saw, so agents and people cannot overwrite each other.
 */
export class RecordService {
  constructor(
    private readonly db: Db,
    private readonly kinds: KindRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(ctx: RecordContext, input: CreateRecordInput): Promise<RecordEnvelope> {
    const kind = this.kinds.get(input.kind);
    const attributes = parseAttributes(kind, input.attributes);
    const at = this.now();
    return this.db.transaction(async (tx) => {
      const name = await allocateName(tx, ctx.labId, kind);
      const [row] = await tx
        .insert(records)
        .values({
          id: newId(kind.idPrefix),
          kind: kind.kind,
          orgId: ctx.orgId,
          labId: ctx.labId,
          name,
          label: input.label,
          status: input.status ?? 'draft',
          version: 1,
          attributes,
          createdAt: at,
          createdBy: ctx.actor,
          updatedAt: at,
          updatedBy: ctx.actor,
        })
        .returning();
      const record = required(row);
      await syncLinks(tx, record, kind, attributes);
      return writeVersion(tx, record, 'create', ctx.actor, input.reason);
    });
  }

  async get(ctx: RecordContext, id: string): Promise<RecordEnvelope> {
    return toEnvelope(await findRecord(this.db, ctx, id));
  }

  async update(ctx: RecordContext, id: string, input: UpdateRecordInput): Promise<RecordEnvelope> {
    return this.#change(ctx, id, input.expectedVersion, 'update', input.reason, (record, kind) => {
      if (record.status === 'archived') {
        throw new RecordError(
          'invalid_state',
          `${record.name} is archived; unarchive it to edit it`,
        );
      }
      return {
        label: input.label ?? record.label,
        attributes:
          input.attributes === undefined
            ? record.attributes
            : parseAttributes(kind, input.attributes),
      };
    });
  }

  /** Draft → active. */
  async activate(ctx: RecordContext, id: string, input: TransitionInput): Promise<RecordEnvelope> {
    return this.#change(ctx, id, input.expectedVersion, 'activate', input.reason, (record) => {
      if (record.status !== 'draft') {
        throw new RecordError('invalid_state', `${record.name} is ${record.status}, not a draft`);
      }
      return { status: 'active' };
    });
  }

  /** Hides a record from pickers. Links to it keep working. */
  async archive(ctx: RecordContext, id: string, input: TransitionInput): Promise<RecordEnvelope> {
    return this.#change(ctx, id, input.expectedVersion, 'archive', input.reason, (record) => {
      if (record.status === 'archived') {
        throw new RecordError('invalid_state', `${record.name} is already archived`);
      }
      return { status: 'archived' };
    });
  }

  /** Returns an archived record to the status it had before it was archived. */
  async unarchive(ctx: RecordContext, id: string, input: TransitionInput): Promise<RecordEnvelope> {
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'unarchive',
      input.reason,
      async (record, _kind, tx) => {
        if (record.status !== 'archived') {
          throw new RecordError('invalid_state', `${record.name} is not archived`);
        }
        const previous = await findVersion(tx, record.id, record.version - 1);
        return { status: previous.snapshot.status };
      },
    );
  }

  /** Writes a new version whose label and attributes are those of an earlier version. History is kept. */
  async restore(
    ctx: RecordContext,
    id: string,
    input: TransitionInput & { version: number },
  ): Promise<RecordEnvelope> {
    const reason = input.reason ?? `Restored version ${input.version}`;
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'restore',
      reason,
      async (record, kind, tx) => {
        if (record.status === 'archived') {
          throw new RecordError('invalid_state', `${record.name} is archived; unarchive it first`);
        }
        if (input.version >= record.version) {
          throw new RecordError(
            'invalid_state',
            `Version ${input.version} is not an earlier version of ${record.name}`,
          );
        }
        const earlier = await findVersion(tx, record.id, input.version);
        return {
          label: earlier.snapshot.label,
          attributes: parseAttributes(kind, earlier.snapshot.attributes),
        };
      },
    );
  }

  /** Deletes a draft that nothing links to, with its history. Everything else can only be archived. */
  async deleteDraft(ctx: RecordContext, id: string, input: TransitionInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const record = await findRecord(tx, ctx, id, { forUpdate: true });
      assertVersion(record, input.expectedVersion);
      if (record.status !== 'draft') {
        throw new RecordError(
          'invalid_state',
          `${record.name} is ${record.status}; only drafts can be deleted. Archive it instead.`,
        );
      }
      const inbound = await tx
        .select({ fromId: recordLinks.fromId })
        .from(recordLinks)
        .where(eq(recordLinks.toId, record.id))
        .limit(1);
      if (inbound.length > 0) {
        throw new RecordError(
          'linked',
          `${record.name} is linked from other records and can't be deleted`,
        );
      }
      await tx.delete(records).where(eq(records.id, record.id));
    });
  }

  async history(ctx: RecordContext, id: string): Promise<RecordVersion[]> {
    const record = await findRecord(this.db, ctx, id);
    const rows = await this.db
      .select()
      .from(recordVersions)
      .where(eq(recordVersions.recordId, record.id))
      .orderBy(asc(recordVersions.version));
    return rows.map(toVersion);
  }

  async getVersion(ctx: RecordContext, id: string, version: number): Promise<RecordVersion> {
    const record = await findRecord(this.db, ctx, id);
    return findVersion(this.db, record.id, version);
  }

  /** What this record points to. */
  async linksFrom(ctx: RecordContext, id: string): Promise<RecordLink[]> {
    const record = await findRecord(this.db, ctx, id);
    return this.db
      .select({
        fromId: recordLinks.fromId,
        toId: recordLinks.toId,
        relation: recordLinks.relation,
      })
      .from(recordLinks)
      .where(eq(recordLinks.fromId, record.id))
      .orderBy(asc(recordLinks.relation), asc(recordLinks.toId));
  }

  /** Where this record is used. */
  async linksTo(ctx: RecordContext, id: string): Promise<RecordLink[]> {
    const record = await findRecord(this.db, ctx, id);
    return this.db
      .select({
        fromId: recordLinks.fromId,
        toId: recordLinks.toId,
        relation: recordLinks.relation,
      })
      .from(recordLinks)
      .where(eq(recordLinks.toId, record.id))
      .orderBy(asc(recordLinks.relation), asc(recordLinks.fromId));
  }

  async #change(
    ctx: RecordContext,
    id: string,
    expectedVersion: number,
    operation: RecordOperation,
    reason: string | undefined,
    apply: (
      record: RecordRow,
      kind: KindDefinition,
      tx: Db,
    ) =>
      | Partial<Pick<RecordRow, 'label' | 'attributes' | 'status'>>
      | Promise<Partial<Pick<RecordRow, 'label' | 'attributes' | 'status'>>>,
  ): Promise<RecordEnvelope> {
    return this.db.transaction(async (tx) => {
      const current = await findRecord(tx, ctx, id, { forUpdate: true });
      assertVersion(current, expectedVersion);
      const kind = this.kinds.get(current.kind);
      const changes = await apply(current, kind, tx);
      const [row] = await tx
        .update(records)
        .set({
          ...changes,
          version: current.version + 1,
          updatedAt: this.now(),
          updatedBy: ctx.actor,
        })
        .where(eq(records.id, current.id))
        .returning();
      const record = required(row);
      if (changes.attributes !== undefined) await syncLinks(tx, record, kind, record.attributes);
      return writeVersion(tx, record, operation, ctx.actor, reason);
    });
  }
}

function parseAttributes(kind: KindDefinition, attributes: unknown): Record<string, unknown> {
  const result = kind.attributes.safeParse(attributes);
  if (!result.success) {
    throw new RecordError(
      'invalid_attributes',
      `Invalid ${kind.kind} attributes:\n${z.prettifyError(result.error)}`,
      result.error.issues,
    );
  }
  return result.data as Record<string, unknown>;
}

async function allocateName(tx: Db, labId: string, kind: KindDefinition): Promise<string> {
  const [counter] = await tx
    .insert(nameCounters)
    .values({ labId, prefix: kind.namePrefix, lastValue: 1 })
    .onConflictDoUpdate({
      target: [nameCounters.labId, nameCounters.prefix],
      set: { lastValue: sql`${nameCounters.lastValue} + 1` },
    })
    .returning({ lastValue: nameCounters.lastValue });
  return formatName(kind.namePrefix, required(counter).lastValue, kind.nameWidth);
}

async function findRecord(
  db: Db,
  ctx: RecordContext,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<RecordRow> {
  const query = db
    .select()
    .from(records)
    .where(and(eq(records.id, id), eq(records.labId, ctx.labId)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new RecordError('not_found', `No record ${id} in this lab`);
  return row;
}

async function findVersion(db: Db, recordId: string, version: number): Promise<RecordVersion> {
  const [row] = await db
    .select()
    .from(recordVersions)
    .where(and(eq(recordVersions.recordId, recordId), eq(recordVersions.version, version)));
  if (!row) throw new RecordError('not_found', `Record ${recordId} has no version ${version}`);
  return toVersion(row);
}

function assertVersion(record: RecordRow, expectedVersion: number): void {
  if (record.version !== expectedVersion) {
    throw new RecordError(
      'version_conflict',
      `${record.name} is at version ${record.version}, not ${expectedVersion}; reload it and try again`,
      { currentVersion: record.version },
    );
  }
}

/** Replaces the record's outbound links with those its kind reads from the attributes. */
async function syncLinks(
  tx: Db,
  record: RecordRow,
  kind: KindDefinition,
  attributes: Record<string, unknown>,
): Promise<void> {
  const desired = dedupeLinks(kind.links?.(attributes) ?? []);
  for (const link of desired) {
    const parsed = RecordLink.safeParse({ ...link, fromId: record.id });
    if (!parsed.success) {
      throw new RecordError('invalid_link', `Invalid link: ${z.prettifyError(parsed.error)}`);
    }
    if (link.toId === record.id) {
      throw new RecordError('invalid_link', `${record.name} cannot link to itself`);
    }
  }
  const existing = await tx
    .select({ toId: recordLinks.toId, relation: recordLinks.relation })
    .from(recordLinks)
    .where(eq(recordLinks.fromId, record.id));
  const key = (l: Link) => `${l.relation}\u0000${l.toId}`;
  const existingKeys = new Set(existing.map(key));
  const desiredKeys = new Set(desired.map(key));

  for (const link of existing) {
    if (!desiredKeys.has(key(link))) {
      await tx
        .delete(recordLinks)
        .where(
          and(
            eq(recordLinks.fromId, record.id),
            eq(recordLinks.toId, link.toId),
            eq(recordLinks.relation, link.relation),
          ),
        );
    }
  }
  for (const link of desired) {
    if (existingKeys.has(key(link))) continue;
    const [target] = await tx
      .select({ name: records.name, status: records.status })
      .from(records)
      .where(and(eq(records.id, link.toId), eq(records.labId, record.labId)));
    if (!target) {
      throw new RecordError(
        'invalid_link',
        `Linked record ${link.toId} does not exist in this lab`,
      );
    }
    if (target.status === 'archived') {
      throw new RecordError('invalid_link', `${target.name} is archived and can't be newly linked`);
    }
    await tx
      .insert(recordLinks)
      .values({ fromId: record.id, toId: link.toId, relation: link.relation, labId: record.labId });
  }
}

function dedupeLinks(links: Link[]): Link[] {
  const seen = new Map<string, Link>();
  for (const link of links) seen.set(`${link.relation}\u0000${link.toId}`, link);
  return [...seen.values()];
}

async function writeVersion(
  tx: Db,
  record: RecordRow,
  operation: RecordOperation,
  actor: Actor,
  reason: string | undefined,
): Promise<RecordEnvelope> {
  const snapshot = toEnvelope(record);
  await tx.insert(recordVersions).values({
    recordId: record.id,
    version: record.version,
    operation,
    actor,
    reason: reason ?? null,
    at: record.updatedAt,
    snapshot,
  });
  return snapshot;
}

function toEnvelope(row: RecordRow): RecordEnvelope {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    label: row.label,
    orgId: row.orgId,
    labId: row.labId,
    status: row.status as RecordStatus,
    version: row.version,
    attributes: row.attributes,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function toVersion(row: typeof recordVersions.$inferSelect): RecordVersion {
  return {
    recordId: row.recordId,
    version: row.version,
    operation: row.operation,
    actor: row.actor,
    ...(row.reason === null ? {} : { reason: row.reason }),
    at: row.at.toISOString(),
    snapshot: row.snapshot,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a row to be returned');
  return value;
}

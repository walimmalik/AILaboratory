import { formatName, newId, readiness, runChecks, sameValue, sectionValues } from '@ailab/domain';
import {
  type Actor,
  type EvidenceInput,
  type FieldEvidence,
  type KindDefinition,
  type Readiness,
  type RecordEnvelope,
  RecordLink,
  type RecordOperation,
  type RecordStatus,
  type RecordVersion,
  type SectionReview,
} from '@ailab/schema';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
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
  /**
   * The person who approved this agent's proposal, when it runs on approval. They reviewed the
   * change, so the sections it touches count as confirmed by them (ADR 0021).
   */
  approvedBy?: Actor;
}

type RecordRow = typeof records.$inferSelect;
type Link = Omit<RecordLink, 'fromId'>;

export interface CreateRecordInput {
  kind: string;
  label: string;
  attributes: unknown;
  /** New records start as drafts unless created active. */
  status?: 'draft' | 'active';
  /** Where values came from, by attribute. Unnamed values set by an agent are marked assumed. */
  evidence?: Record<string, EvidenceInput>;
  reason?: string;
}

export interface ListRecordsInput {
  kind?: string | undefined;
  status?: RecordStatus | undefined;
  /** Matches label or readable name, case-insensitively. */
  search?: string | undefined;
  limit?: number | undefined;
  /** Only records changed before this time (for paging). */
  before?: string | undefined;
}

export interface UpdateRecordInput {
  expectedVersion: number;
  label?: string;
  attributes?: unknown;
  evidence?: Record<string, EvidenceInput>;
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
    const evidence = nextEvidence(ctx.actor, at, undefined, attributes, {}, input.evidence);
    // A person who creates a record active confirms every section as they wrote it (ADR 0021).
    const reviews: Record<string, SectionReview> = {};
    if (input.status === 'active' && kind.sections?.length) {
      if (ctx.actor.type === 'agent') {
        throw new RecordError(
          'invalid_state',
          `An agent creates a ${kind.kind} as a draft; a person confirms it`,
        );
      }
      for (const section of kind.sections) {
        reviews[section.id] = {
          confirmedBy: ctx.actor,
          confirmedAt: at.toISOString(),
          version: 1,
          values: sectionValues(section, attributes),
        };
      }
      const blockers = runChecks(kind.checks ?? [], attributes).filter(
        (c) => c.severity === 'blocker' && !c.passed,
      );
      if (blockers.length > 0) {
        throw new RecordError(
          'not_ready',
          `This ${kind.kind} can't be created active: ${blockers.map((c) => c.message ?? c.label).join('; ')}`,
          { missing: blockers.map((c) => c.message ?? c.label) },
        );
      }
    }
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
          evidence,
          reviews,
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

  /** Records in the lab, most recently changed first. Archived records are left out unless asked for. */
  async list(ctx: RecordContext, input: ListRecordsInput = {}): Promise<RecordEnvelope[]> {
    const statuses = input.status ? [input.status] : (['draft', 'active'] as const);
    const search = input.search?.trim();
    const rows = await this.db
      .select()
      .from(records)
      .where(
        and(
          eq(records.labId, ctx.labId),
          input.kind ? eq(records.kind, input.kind) : undefined,
          inArray(records.status, [...statuses]),
          search
            ? or(
                ilike(records.label, `%${escapeLike(search)}%`),
                ilike(records.name, `%${escapeLike(search)}%`),
              )
            : undefined,
          input.before ? lt(records.updatedAt, new Date(input.before)) : undefined,
        ),
      )
      .orderBy(desc(records.updatedAt), desc(records.id))
      .limit(input.limit ?? 50);
    return rows.map(toEnvelope);
  }

  async update(ctx: RecordContext, id: string, input: UpdateRecordInput): Promise<RecordEnvelope> {
    return this.#change(ctx, id, input.expectedVersion, 'update', input.reason, (record, kind) => {
      if (record.status === 'archived') {
        throw new RecordError(
          'invalid_state',
          `${record.name} is archived; unarchive it to edit it`,
        );
      }
      const attributes =
        input.attributes === undefined
          ? record.attributes
          : parseAttributes(kind, input.attributes);
      return {
        label: input.label ?? record.label,
        attributes,
        evidence: nextEvidence(
          ctx.actor,
          this.now(),
          record.attributes,
          attributes,
          record.evidence,
          input.evidence,
        ),
        reviews: approvalReviews(ctx, kind, record, attributes, this.now()),
      };
    });
  }

  /**
   * A person confirms one section as it stands now (ADR 0021). The section stays confirmed while its
   * values equal the ones confirmed here; any later change sends it back to review. Confirming the
   * last section of a draft with no failing blocker also activates it (plan 004d, R6).
   */
  async confirmSection(
    ctx: RecordContext,
    id: string,
    input: TransitionInput & { section: string },
  ): Promise<RecordEnvelope> {
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'confirm_section',
      input.reason,
      (record, kind) => {
        if (record.status === 'archived') {
          throw new RecordError('invalid_state', `${record.name} is archived`);
        }
        const section = kind.sections?.find((s) => s.id === input.section);
        if (!section) {
          const known = kind.sections?.map((s) => s.id).join(', ');
          throw new RecordError(
            'invalid_input',
            known
              ? `A ${kind.kind} has no section "${input.section}"; its sections are ${known}`
              : `A ${kind.kind} has no sections to confirm`,
          );
        }
        const values = sectionValues(section, record.attributes);
        const previous = record.reviews[section.id];
        if (previous && sameValue(previous.values, values)) {
          throw new RecordError(
            'invalid_state',
            `${section.title} on ${record.name} is already confirmed`,
          );
        }
        const review: SectionReview = {
          confirmedBy: ctx.actor,
          confirmedAt: this.now().toISOString(),
          version: record.version,
          values,
        };
        const reviews = { ...record.reviews, [section.id]: review };
        // Confirming the last section of a draft, with nothing blocking, is the final confirm too.
        const after = readiness(
          { ...toEnvelope(record), reviews },
          kind.sections ?? [],
          kind.checks ?? [],
        );
        return record.status === 'draft' && after.ready
          ? { reviews, status: 'active' as const }
          : { reviews };
      },
    );
  }

  /** What is confirmed, what changed, what was assumed, and which checks pass. */
  async readiness(ctx: RecordContext, id: string): Promise<Readiness> {
    const record = toEnvelope(await findRecord(this.db, ctx, id));
    const kind = this.kinds.get(record.kind);
    return readiness(record, kind.sections ?? [], kind.checks ?? []);
  }

  /** Draft → active. */
  async activate(ctx: RecordContext, id: string, input: TransitionInput): Promise<RecordEnvelope> {
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'activate',
      input.reason,
      (record, kind) => {
        if (record.status !== 'draft') {
          throw new RecordError('invalid_state', `${record.name} is ${record.status}, not a draft`);
        }
        if (kind.sections?.length) {
          const state = readiness(toEnvelope(record), kind.sections, kind.checks ?? []);
          if (!state.ready) {
            throw new RecordError(
              'not_ready',
              `${record.name} is not ready to confirm: ${state.missing.join('; ')}`,
              { missing: state.missing },
            );
          }
        }
        return { status: 'active' };
      },
    );
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
        const attributes = parseAttributes(kind, earlier.snapshot.attributes);
        // Restored values keep the evidence they had in that version.
        const evidence: Record<string, FieldEvidence> = {};
        for (const field of Object.keys(attributes)) {
          const kept = sameValue(record.attributes[field], attributes[field])
            ? record.evidence[field]
            : earlier.snapshot.evidence[field];
          if (kept) evidence[field] = kept;
        }
        return {
          label: earlier.snapshot.label,
          attributes,
          evidence,
          reviews: approvalReviews(ctx, kind, record, attributes, this.now()),
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
      | Partial<Pick<RecordRow, 'label' | 'attributes' | 'status' | 'evidence' | 'reviews'>>
      | Promise<
          Partial<Pick<RecordRow, 'label' | 'attributes' | 'status' | 'evidence' | 'reviews'>>
        >,
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

/**
 * Section reviews after a change. When the change runs because a person approved an agent's
 * proposal, each section it changed counts as confirmed by that person, as they saw it in the
 * proposal. Otherwise reviews are unchanged, and changed sections read as needing review.
 */
function approvalReviews(
  ctx: RecordContext,
  kind: KindDefinition,
  record: RecordRow,
  attributes: Record<string, unknown>,
  at: Date,
): Record<string, SectionReview> {
  if (!ctx.approvedBy) return record.reviews;
  const reviews = { ...record.reviews };
  for (const section of kind.sections ?? []) {
    const before = sectionValues(section, record.attributes);
    const after = sectionValues(section, attributes);
    if (sameValue(before, after)) continue;
    reviews[section.id] = {
      confirmedBy: ctx.approvedBy,
      confirmedAt: at.toISOString(),
      version: record.version + 1,
      values: after,
    };
  }
  return reviews;
}

/**
 * Evidence after a change (ADR 0021). Each attribute whose value changed gets new evidence from the
 * actor: what they named, or "assumed" for an agent and "person" for a person. Evidence named for an
 * unchanged attribute replaces what it had, so an agent can cite a source for an earlier estimate.
 */
function nextEvidence(
  actor: Actor,
  at: Date,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  current: Record<string, FieldEvidence>,
  named: Record<string, EvidenceInput> | undefined,
): Record<string, FieldEvidence> {
  for (const field of Object.keys(named ?? {})) {
    if (!(field in after)) {
      throw new RecordError(
        'invalid_input',
        `Evidence names "${field}", which is not an attribute with a value`,
      );
    }
  }
  if (actor.type !== 'agent' && Object.values(named ?? {}).some((e) => e.source === 'stated')) {
    throw new RecordError(
      'invalid_input',
      'Only an agent can record a value as stated by the person it works for; values you enter are yours',
    );
  }
  const evidence: Record<string, FieldEvidence> = {};
  for (const [field, value] of Object.entries(after)) {
    const changed = !before || !sameValue(before[field], value);
    const given = named?.[field];
    if (given) {
      evidence[field] = { ...given, by: actor, at: at.toISOString() };
    } else if (changed) {
      evidence[field] = {
        source: actor.type === 'agent' ? 'assumed' : 'person',
        by: actor,
        at: at.toISOString(),
      };
    } else if (current[field]) {
      evidence[field] = current[field];
    }
  }
  return evidence;
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

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
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
    evidence: row.evidence,
    reviews: row.reviews,
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

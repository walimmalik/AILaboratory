import {
  formatName,
  itemPath,
  keyedItems,
  newId,
  readiness,
  runChecks,
  sameValue,
  sectionValues,
  summarizeReadiness,
} from '@ailab/domain';
import {
  type Actor,
  type EvidenceInput,
  type FieldEvidence,
  type KindDefinition,
  type KindSection,
  type Readiness,
  type RecordEnvelope,
  RecordLink,
  type RecordOperation,
  type RecordStatus,
  type RecordVersion,
  type RelatedResult,
  type SectionReview,
} from '@ailab/schema';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { nameCounters, recordLinks, records, recordVersions } from '../db/schema.ts';
import { checkCalculated } from './calculations.ts';
import { RecordError } from './errors.ts';
import { type KindRegistry, namePrefixesOf } from './kinds.ts';
import { markSeenBy, writtenBySeer } from './seen.ts';

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
  /** The operation making the change, kept on each version it writes (ADR 0053). */
  via?: string;
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
  /** Only these records, in any status unless `status` is given; all of them, whatever `limit`. */
  ids?: readonly string[] | undefined;
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
    const related = await this.#related(this.db, ctx, kind, attributes);
    const at = this.now();
    const evidence = nextEvidence(
      ctx.actor,
      at,
      undefined,
      attributes,
      {},
      input.evidence,
      kind.items,
    );
    await checkCalculatedEvidence(this.db, ctx, attributes, input.evidence, kind.items);
    await checkCopiedEvidence(this.db, ctx, this.kinds, attributes, input.evidence, kind.items);
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
      const blockers = [
        ...runChecks(kind.checks ?? [], attributes),
        ...(related.checks ?? []),
      ].filter((c) => c.severity === 'blocker' && !c.passed);
      if (blockers.length > 0) {
        throw new RecordError(
          'not_ready',
          `This ${kind.kind} can't be created active: ${blockers.map((c) => c.message ?? c.label).join('; ')}`,
          { missing: blockers.map((c) => c.message ?? c.label) },
        );
      }
    }
    return this.db.transaction(async (tx) => {
      const name = await allocateName(tx, ctx.labId, kind, related.namePrefix);
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
      const record = await this.#stamp(tx, ctx, kind, required(row));
      await syncLinks(tx, record, kind, attributes);
      return writeVersion(tx, record, 'create', ctx, input.reason);
    });
  }

  async get(ctx: RecordContext, id: string): Promise<RecordEnvelope> {
    return toEnvelope(await findRecord(this.db, ctx, id));
  }

  /** Records in the lab, most recently changed first. Archived records are left out unless asked for. */
  async list(ctx: RecordContext, input: ListRecordsInput = {}): Promise<RecordEnvelope[]> {
    const statuses = input.status
      ? [input.status]
      : input.ids
        ? (['draft', 'active', 'archived'] as const)
        : (['draft', 'active'] as const);
    const search = input.search?.trim();
    const rows = await this.db
      .select()
      .from(records)
      .where(
        and(
          eq(records.labId, ctx.labId),
          input.kind ? eq(records.kind, input.kind) : undefined,
          input.ids ? inArray(records.id, [...input.ids]) : undefined,
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
      .limit(input.ids ? input.ids.length : (input.limit ?? 50));
    return rows.map(toEnvelope);
  }

  async update(ctx: RecordContext, id: string, input: UpdateRecordInput): Promise<RecordEnvelope> {
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'update',
      input.reason,
      async (record, kind, tx) => {
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
        if (input.attributes !== undefined) await this.#related(tx, ctx, kind, attributes, record);
        await checkCalculatedEvidence(tx, ctx, attributes, input.evidence, kind.items);
        await checkCopiedEvidence(tx, ctx, this.kinds, attributes, input.evidence, kind.items);
        const evidence = nextEvidence(
          ctx.actor,
          this.now(),
          record.attributes,
          attributes,
          record.evidence,
          input.evidence,
          kind.items,
        );
        return {
          label: input.label ?? record.label,
          attributes,
          evidence,
          reviews: approvalReviews(ctx, kind, record, attributes, evidence, this.now()),
        };
      },
    );
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
      async (record, kind, tx) => {
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
        const related = await this.#related(tx, ctx, kind, record.attributes, record);
        const after = readiness({ ...toEnvelope(record), reviews }, kind, related.checks);
        return record.status === 'draft' && after.ready
          ? { reviews, status: 'active' as const }
          : { reviews };
      },
    );
  }

  /**
   * A person confirms every section that waits for review in one version (ADR 0046): the SOP page's
   * one Confirm. A section with a failing blocker check of its own stays unconfirmed; the rest are
   * confirmed as they stand, each with its own review, and a draft left with nothing to do is active.
   */
  async confirmAll(
    ctx: RecordContext,
    id: string,
    input: TransitionInput,
  ): Promise<RecordEnvelope> {
    // A kind without sections is confirmed whole, so its history reads as an activation.
    const sectioned = !!this.kinds.get((await findRecord(this.db, ctx, id)).kind).sections?.length;
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      sectioned ? 'confirm_section' : 'activate',
      input.reason,
      async (record, kind, tx) => {
        if (record.status === 'archived') {
          throw new RecordError('invalid_state', `${record.name} is archived`);
        }
        const related = await this.#related(tx, ctx, kind, record.attributes, record);
        const before = readiness(toEnvelope(record), kind, related.checks);
        // A kind without sections has nothing to confirm piece by piece: confirming its draft is
        // making it active, as long as nothing blocks it.
        if (!kind.sections?.length) {
          if (record.status !== 'draft') {
            throw new RecordError('invalid_state', `${record.name} is already confirmed`);
          }
          if (!before.ready) {
            throw new RecordError(
              'not_ready',
              `${record.name} can't be confirmed yet: ${before.missing.join('; ')}`,
              { missing: before.missing },
            );
          }
          return { status: 'active' as const };
        }
        const blocked = new Set(
          before.checks.flatMap((c) =>
            !c.passed && c.severity === 'blocker' && c.section ? [c.section] : [],
          ),
        );
        const reviews = { ...record.reviews };
        const held: string[] = [];
        let confirmed = 0;
        for (const section of kind.sections) {
          const values = sectionValues(section, record.attributes);
          const previous = record.reviews[section.id];
          if (previous && sameValue(previous.values, values)) continue;
          if (blocked.has(section.id)) {
            held.push(section.title);
            continue;
          }
          reviews[section.id] = {
            confirmedBy: ctx.actor,
            confirmedAt: this.now().toISOString(),
            version: record.version,
            values,
          };
          confirmed++;
        }
        const after = readiness({ ...toEnvelope(record), reviews }, kind, related.checks);
        const activates = record.status === 'draft' && after.ready;
        if (confirmed === 0 && !activates) {
          throw new RecordError(
            'invalid_state',
            held.length
              ? `Nothing on ${record.name} can be confirmed yet: fix what blocks ${held.join(', ')} first`
              : `Everything on ${record.name} is already confirmed`,
          );
        }
        return activates ? { reviews, status: 'active' as const } : { reviews };
      },
    );
  }

  /** What is confirmed, what changed, what was assumed, and which checks pass. */
  async readiness(ctx: RecordContext, id: string): Promise<Readiness> {
    const row = await findRecord(this.db, ctx, id);
    const kind = this.kinds.get(row.kind);
    const related = await this.#related(this.db, ctx, kind, row.attributes, row, false);
    return readiness(toEnvelope(row), kind, related.checks);
  }

  /** Draft → active. */
  async activate(ctx: RecordContext, id: string, input: TransitionInput): Promise<RecordEnvelope> {
    return this.#change(
      ctx,
      id,
      input.expectedVersion,
      'activate',
      input.reason,
      async (record, kind, tx) => {
        if (record.status !== 'draft') {
          throw new RecordError('invalid_state', `${record.name} is ${record.status}, not a draft`);
        }
        if (kind.sections?.length || kind.related) {
          const related = await this.#related(tx, ctx, kind, record.attributes, record);
          const state = readiness(toEnvelope(record), kind, related.checks);
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
        await this.#related(tx, ctx, kind, attributes, record);
        // Restored values keep the evidence they had in that version, items of keyed lists too.
        const evidence: Record<string, FieldEvidence> = {};
        for (const field of Object.keys(attributes)) {
          const from = sameValue(record.attributes[field], attributes[field])
            ? record.evidence
            : earlier.snapshot.evidence;
          if (from[field]) evidence[field] = from[field];
          for (const [key, kept] of Object.entries(from)) {
            if (key.startsWith(`/${field}/`)) evidence[key] = kept;
          }
        }
        return {
          label: earlier.snapshot.label,
          attributes,
          evidence,
          reviews: approvalReviews(ctx, kind, record, attributes, evidence, this.now()),
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

  /**
   * Runs a kind's `related` rules (ADR 0029) against records in the same lab, inside the caller's
   * transaction. Invalid attributes are refused unless `refuse` is false (reading readiness).
   */
  async #related(
    db: Db,
    ctx: RecordContext,
    kind: KindDefinition,
    attributes: Record<string, unknown>,
    current?: RecordRow,
    refuse = true,
  ): Promise<RelatedResult> {
    if (!kind.related) return {};
    const result = await kind.related(attributes, {
      get: async (id) => {
        try {
          return toEnvelope(await findRecord(db, ctx, id));
        } catch (error) {
          if (error instanceof RecordError && error.code === 'not_found') return undefined;
          throw error;
        }
      },
      getVersion: async (id, version) => {
        try {
          const record = await findRecord(db, ctx, id);
          return (await findVersion(db, record.id, version)).snapshot;
        } catch (error) {
          if (error instanceof RecordError && error.code === 'not_found') return undefined;
          throw error;
        }
      },
      list: async (listKind) => {
        const rows = await db
          .select()
          .from(records)
          .where(
            and(
              eq(records.labId, ctx.labId),
              eq(records.kind, listKind),
              inArray(records.status, ['draft', 'active']),
            ),
          );
        return rows.map(toEnvelope);
      },
      current: current ? toEnvelope(current) : undefined,
      actor: ctx.actor,
      reservedPrefixes: this.kinds.list().flatMap(namePrefixesOf),
    });
    if (refuse && result.invalid?.length) {
      throw new RecordError(
        'invalid_attributes',
        `Invalid ${kind.kind} attributes:\n${result.invalid.map((i) => `✖ ${i}`).join('\n')}`,
      );
    }
    if (
      result.namePrefix &&
      !namePrefixesOf(kind).includes(result.namePrefix) &&
      this.kinds.list().some((k) => namePrefixesOf(k).includes(result.namePrefix as string))
    ) {
      throw new RecordError(
        'invalid_attributes',
        `The name prefix ${result.namePrefix} belongs to another kind of record`,
      );
    }
    return result;
  }

  /**
   * Stores the kind's one-line summary and the readiness summary on the row just written (ADR 0050),
   * with checks that read other records, so every list agrees with the record page.
   */
  async #stamp(
    tx: Db,
    ctx: RecordContext,
    kind: KindDefinition,
    row: RecordRow,
  ): Promise<RecordRow> {
    const related = await this.#related(tx, ctx, kind, row.attributes, row, false);
    const summary = summaryOf(kind, row.attributes);
    const state = summarizeReadiness(readiness(toEnvelope(row), kind, related.checks));
    const [stamped] = await tx
      .update(records)
      .set({ summary: summary ?? null, readiness: state })
      .where(eq(records.id, row.id))
      .returning();
    return required(stamped);
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
      const record = await this.#stamp(tx, ctx, kind, required(row));
      if (changes.attributes !== undefined) await syncLinks(tx, record, kind, record.attributes);
      return writeVersion(tx, record, operation, ctx, reason);
    });
  }
}

/**
 * Section reviews after a change. When the change runs because a person approved an agent's
 * proposal, each section it changed counts as confirmed by that person, as they saw it in the
 * proposal. When a person edits a record themselves, each section they changed counts as confirmed
 * by them unless it still holds an agent's value they haven't confirmed (plan 004e R10, ADR 0056):
 * there is nothing to review in what you typed yourself. Otherwise reviews are unchanged, and
 * changed sections read as needing review.
 */
function approvalReviews(
  ctx: RecordContext,
  kind: KindDefinition,
  record: RecordRow,
  attributes: Record<string, unknown>,
  evidence: Record<string, FieldEvidence>,
  at: Date,
): Record<string, SectionReview> {
  const by = ctx.approvedBy ?? (ctx.actor.type === 'user' ? ctx.actor : undefined);
  if (!by) return record.reviews;
  const reviews = { ...record.reviews };
  for (const section of kind.sections ?? []) {
    const before = sectionValues(section, record.attributes);
    const after = sectionValues(section, attributes);
    if (sameValue(before, after)) continue;
    if (
      !ctx.approvedBy &&
      holdsAgentValues(section, after, evidence, record.reviews[section.id], kind.items)
    ) {
      continue;
    }
    reviews[section.id] = {
      confirmedBy: by,
      confirmedAt: at.toISOString(),
      version: record.version + 1,
      values: after,
    };
  }
  return reviews;
}

/**
 * Whether a section holds an agent's value no person has confirmed: a field, or an item of a keyed
 * list, whose evidence is an agent's and whose value isn't the one last confirmed for the section.
 */
function holdsAgentValues(
  section: KindSection,
  values: Record<string, unknown>,
  evidence: Record<string, FieldEvidence>,
  review: SectionReview | undefined,
  items: Readonly<Record<string, string>> = {},
): boolean {
  const byAgent = (key: string) => evidence[key]?.by.type === 'agent';
  return section.fields.some((field) => {
    const confirmed = review?.values[field];
    if (review && sameValue(confirmed, values[field])) return false;
    const keyField = items[field];
    if (!keyField) return byAgent(field);
    const was = keyedItems(confirmed, keyField);
    return [...keyedItems(values[field], keyField)].some(
      ([key, item]) =>
        byAgent(itemPath(field, key)) && !(was.has(key) && sameValue(was.get(key), item)),
    );
  });
}

/**
 * Evidence after a change (ADR 0021). Each attribute whose value changed gets new evidence from the
 * actor: what they named, or "assumed" for an agent and "person" for a person. Evidence named for an
 * unchanged attribute replaces what it had, so an agent can cite a source for an earlier estimate.
 *
 * A keyed list (ADR 0049) also keeps evidence per item, at `/<list>/<key>`: only the items that
 * changed get new evidence (named for the item, else named for the list, else the default), and the
 * others keep theirs, so one edited step leaves the rest as they were.
 */
function nextEvidence(
  actor: Actor,
  at: Date,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  current: Record<string, FieldEvidence>,
  named: Record<string, EvidenceInput> | undefined,
  items: Readonly<Record<string, string>> = {},
): Record<string, FieldEvidence> {
  for (const key of Object.keys(named ?? {})) {
    if (key.startsWith('/')) {
      const [, list = '', item = ''] = key.split('/');
      const keyField = items[list];
      if (!keyField || !keyedItems(after[list], keyField).has(item)) {
        throw new RecordError(
          'invalid_input',
          `Evidence names "${key}", which is not an item of a list this kind keys by ${keyField ?? 'id'}`,
        );
      }
    } else if (!(key in after)) {
      throw new RecordError(
        'invalid_input',
        `Evidence names "${key}", which is not an attribute with a value`,
      );
    }
  }
  if (actor.type !== 'agent' && Object.values(named ?? {}).some((e) => e.source === 'stated')) {
    throw new RecordError(
      'invalid_input',
      'Only an agent can record a value as stated by the person it works for; values you enter are yours',
    );
  }
  const stamp = (given: EvidenceInput): FieldEvidence => {
    const { output, ...rest } = given;
    return { ...rest, ...(output ? { output } : {}), by: actor, at: at.toISOString() };
  };
  const fallback = (): FieldEvidence => ({
    source: actor.type === 'agent' ? 'assumed' : 'person',
    by: actor,
    at: at.toISOString(),
  });
  const evidence: Record<string, FieldEvidence> = {};
  for (const [field, value] of Object.entries(after)) {
    const changed = !before || !sameValue(before[field], value);
    const given = named?.[field];
    if (given) evidence[field] = stamp(given);
    else if (changed) evidence[field] = fallback();
    else if (current[field]) evidence[field] = current[field];

    const keyField = items[field];
    if (!keyField) continue;
    const was = keyedItems(before?.[field], keyField);
    for (const [key, item] of keyedItems(value, keyField)) {
      const path = itemPath(field, key);
      const itemChanged = !before || !was.has(key) || !sameValue(was.get(key), item);
      const own = named?.[path] ?? (itemChanged ? given : undefined);
      if (own) evidence[path] = stamp(own);
      else if (itemChanged) evidence[path] = fallback();
      else {
        // Items from before item evidence existed inherit what the list had.
        const kept = current[path] ?? current[field];
        if (kept) evidence[path] = kept;
      }
    }
  }
  return evidence;
}

/** Each value named as calculated must be what its calculation returned (ADR 0049). */
async function checkCalculatedEvidence(
  db: Db,
  ctx: RecordContext,
  attributes: Record<string, unknown>,
  named: Record<string, EvidenceInput> | undefined,
  items: Readonly<Record<string, string>> = {},
): Promise<void> {
  for (const [key, given] of Object.entries(named ?? {})) {
    if (given.source !== 'calculated') continue;
    if (!given.calculation) {
      throw new RecordError(
        'invalid_input',
        `${key} is marked calculated without a calculation handle; name the handle the calculator returned`,
      );
    }
    const [, list = '', item = ''] = key.split('/');
    const value = key.startsWith('/')
      ? keyedItems(attributes[list], items[list] ?? 'id').get(item)
      : attributes[key];
    await checkCalculated(db, ctx, key, value, given.calculation, given.output);
  }
}

/**
 * Each value named as copied (`record`, `template`) must come from a record in this lab, at a
 * version that exists and was active; with a `path`, the value there must be the value set (ADR
 * 0049). Lab memory can't be cited until plan 005 builds it.
 */
async function checkCopiedEvidence(
  db: Db,
  ctx: RecordContext,
  kinds: KindRegistry,
  attributes: Record<string, unknown>,
  named: Record<string, EvidenceInput> | undefined,
  items: Readonly<Record<string, string>> = {},
): Promise<void> {
  for (const [key, given] of Object.entries(named ?? {})) {
    if (given.source === 'memory') {
      throw new RecordError(
        'invalid_input',
        `${key} cites lab memory, which this lab doesn't keep yet; name the record or document it came from`,
      );
    }
    if ((given.source !== 'record' && given.source !== 'template') || !given.from) continue;
    const { from } = given;
    const [source] = await db
      .select({ id: records.id, name: records.name, kind: records.kind })
      .from(records)
      .where(and(eq(records.id, from.id), eq(records.labId, ctx.labId)));
    if (!source) {
      throw new RecordError(
        'invalid_input',
        `${key} is marked copied from ${from.id}, which is not a record in this lab`,
      );
    }
    const [version] = await db
      .select({ snapshot: recordVersions.snapshot })
      .from(recordVersions)
      .where(and(eq(recordVersions.recordId, source.id), eq(recordVersions.version, from.version)));
    if (!version) {
      throw new RecordError(
        'invalid_input',
        `${key} is marked copied from ${source.name} version ${from.version}, which it doesn't have`,
      );
    }
    if (version.snapshot.status !== 'active') {
      throw new RecordError(
        'invalid_input',
        `${key} is marked copied from ${source.name} version ${from.version}, which was ${version.snapshot.status}, not confirmed; copy from a confirmed version`,
      );
    }
    if (!from.path) continue;
    const found = valueAt(version.snapshot.attributes, from.path, kinds.get(source.kind).items);
    const [, list = '', item = ''] = key.split('/');
    const keyField = key.startsWith('/') ? (items[list] ?? 'id') : undefined;
    const value = keyField ? keyedItems(attributes[list], keyField).get(item) : attributes[key];
    // A copied list item keeps its own key here, so the key itself isn't compared.
    const withoutKey = (v: unknown) =>
      keyField && v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== keyField))
        : v;
    if (found === undefined || !sameValue(withoutKey(value), withoutKey(found))) {
      throw new RecordError(
        'invalid_input',
        `${key} is marked copied from ${source.name} version ${from.version} at ${from.path}, but the value there is different; mark it with where it really came from`,
      );
    }
  }
}

/** The value at a JSON pointer, where a keyed list's items are found by their key (ADR 0049). */
function valueAt(
  attributes: Record<string, unknown>,
  path: string,
  items: Readonly<Record<string, string>> = {},
): unknown {
  const parts = path
    .split('/')
    .slice(1)
    .map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  let at: unknown = attributes;
  for (const [depth, part] of parts.entries()) {
    if (Array.isArray(at)) {
      const keyField = depth === 1 ? items[parts[0] ?? ''] : undefined;
      at = keyField
        ? keyedItems(at, keyField).get(part)
        : /^\d+$/.test(part)
          ? at[Number(part)]
          : keyedItems(at, 'id').get(part);
    } else if (at && typeof at === 'object') {
      at = (at as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return at;
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

async function allocateName(
  tx: Db,
  labId: string,
  kind: KindDefinition,
  prefix = kind.namePrefix,
): Promise<string> {
  const [counter] = await tx
    .insert(nameCounters)
    .values({ labId, prefix, lastValue: 1 })
    .onConflictDoUpdate({
      target: [nameCounters.labId, nameCounters.prefix],
      set: { lastValue: sql`${nameCounters.lastValue} + 1` },
    })
    .returning({ lastValue: nameCounters.lastValue });
  return formatName(prefix, required(counter).lastValue, kind.nameWidth);
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
  ctx: RecordContext,
  reason: string | undefined,
): Promise<RecordEnvelope> {
  const snapshot = toEnvelope(record);
  const seer = writtenBySeer(ctx);
  if (seer) await markSeenBy(tx, seer, record.labId, record.id, record.version);
  await tx.insert(recordVersions).values({
    recordId: record.id,
    version: record.version,
    operation,
    actor: ctx.actor,
    reason: reason ?? null,
    at: record.updatedAt,
    via: ctx.via ?? null,
    snapshot,
  });
  return snapshot;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The kind's summary; one that throws or says nothing gives none. */
function summaryOf(kind: KindDefinition, attributes: Record<string, unknown>): string | undefined {
  try {
    return kind.summarize?.(attributes as never)?.trim() || undefined;
  } catch {
    return undefined;
  }
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
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.readiness ? { readiness: row.readiness } : {}),
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
    ...(row.via ? { via: row.via } : {}),
    snapshot: row.snapshot,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a row to be returned');
  return value;
}

import { type MatchCandidate, type MatchTerm, matchMentions, newId } from '@ailab/domain';
import {
  type DocumentAttributes,
  libraryMentions as libraryMentionsContract,
  libraryMine,
  libraryProposeMentions,
  libraryReviewMentions,
  type Mention,
  type RecordEnvelope,
} from '@ailab/schema';
import { and, asc, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { libraryMentions, libraryPassages, records } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

type Row = typeof libraryMentions.$inferSelect;

/** The words a record goes by, for the matcher: names, catalog numbers, models, synonyms. */
function termsOf(record: { kind: string; label: string; attributes: unknown }): MatchTerm[] {
  const a = record.attributes as Record<string, unknown>;
  const terms: MatchTerm[] = [{ text: record.label, how: 'name' }];
  if (record.kind === 'product') {
    for (const c of (a.catalog as { number: string }[] | undefined) ?? []) {
      terms.push({ text: c.number, how: 'catalog_number' });
    }
  }
  if (record.kind === 'labware_type' && typeof a.catalogNumber === 'string') {
    terms.push({ text: a.catalogNumber, how: 'catalog_number' });
  }
  if (record.kind === 'instrument_kind' && typeof a.model === 'string') {
    terms.push({ text: a.model, how: 'model' });
  }
  if (record.kind === 'entity') {
    for (const s of (a.synonyms as string[] | undefined) ?? [])
      terms.push({ text: s, how: 'synonym' });
  }
  return terms;
}

/** Registries a library passage can name. */
const MATCHED_KINDS = ['product', 'labware_type', 'instrument_kind', 'entity'];

async function toMentions(db: Db, rows: Row[]): Promise<Mention[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.recordId ? [r.recordId] : [])))];
  const targets = new Map(
    ids.length === 0
      ? []
      : (
          await db
            .select({
              id: records.id,
              kind: records.kind,
              name: records.name,
              label: records.label,
            })
            .from(records)
            .where(inArray(records.id, ids))
        ).map((r) => [r.id, r]),
  );
  return rows.map((r) => {
    const target = r.recordId ? targets.get(r.recordId) : undefined;
    const what: Mention['what'] =
      r.type === 'record' && target
        ? {
            type: 'record',
            record: target.id,
            kind: target.kind,
            name: target.name,
            label: target.label,
          }
        : r.type === 'assay'
          ? { type: 'assay', assay: r.assay as string }
          : {
              type: 'parameter',
              parameter: r.parameter as string,
              value: r.value as NonNullable<Row['value']>,
            };
    return {
      id: r.id,
      document: r.documentId,
      passage: r.passageId,
      section: r.section,
      heading: r.heading,
      page: r.page,
      text: r.text,
      what,
      how: r.how as Mention['how'],
      status: r.status,
      proposedBy: r.proposedBy,
      proposedAt: r.proposedAt.toISOString(),
      ...(r.reviewedBy ? { reviewedBy: r.reviewedBy } : {}),
      ...(r.reviewedAt ? { reviewedAt: r.reviewedAt.toISOString() } : {}),
    };
  });
}

async function documentOf(deps: OperationDeps, ctx: RecordContext, id: string) {
  const document = await new RecordService(deps.db, deps.kinds).get(ctx, id);
  if (document.kind !== 'document') {
    throw new OperationError('invalid_input', `${document.name} is not a library document`);
  }
  return document;
}

/** The passages of a document's current original. */
async function passagesOf(db: Db, ctx: RecordContext, document: RecordEnvelope) {
  const original = (document.attributes as DocumentAttributes).files.find(
    (f) => f.role === 'original',
  );
  if (!original) return [];
  return db
    .select()
    .from(libraryPassages)
    .where(
      and(
        eq(libraryPassages.labId, ctx.labId),
        eq(libraryPassages.documentId, document.id),
        eq(libraryPassages.fileId, original.file),
      ),
    )
    .orderBy(asc(libraryPassages.section), asc(libraryPassages.seq));
}

/** A mention is new unless the same thing is already recorded for that passage, whatever its status. */
const keyOf = (m: Pick<Row, 'passageId' | 'type' | 'recordId' | 'assay' | 'parameter'>) =>
  [
    m.passageId,
    m.type,
    m.recordId ?? '',
    m.assay?.toLowerCase() ?? '',
    m.parameter?.toLowerCase() ?? '',
  ].join('\u0000');

async function insertNew(db: Db, ctx: RecordContext, documentId: string, rows: Row[]) {
  const existing = await db
    .select()
    .from(libraryMentions)
    .where(and(eq(libraryMentions.labId, ctx.labId), eq(libraryMentions.documentId, documentId)));
  // Reviewed mentions outlive the passages they were found in: after parsing again, the same words
  // under the same heading are the same mention.
  const reviewedKey = (
    m: Pick<Row, 'type' | 'recordId' | 'assay' | 'parameter' | 'heading' | 'text'>,
  ) =>
    [
      m.type,
      m.recordId ?? '',
      m.assay?.toLowerCase() ?? '',
      m.parameter?.toLowerCase() ?? '',
      m.heading.join(' › '),
      m.text.toLowerCase(),
    ].join('\u0000');
  const seen = new Set([
    ...existing.map(keyOf),
    ...existing.filter((m) => m.status !== 'proposed').map(reviewedKey),
  ]);
  const fresh = rows.filter((r) => {
    if (seen.has(keyOf(r)) || seen.has(reviewedKey(r))) return false;
    seen.add(keyOf(r));
    return true;
  });
  if (fresh.length > 0) await db.insert(libraryMentions).values(fresh);
  return fresh;
}

export const mentionOperations = [
  implement(libraryMine, {
    agentPolicy: 'direct',
    touches: (input) => [input.document],
    run: async (ctx, input, deps) => {
      const document = await documentOf(deps, ctx, input.document);
      const passages = await passagesOf(deps.db, ctx, document);
      if (passages.length === 0) {
        throw new OperationError(
          'invalid_state',
          `${document.name} has no text yet; run library.parse first`,
        );
      }
      const candidates: MatchCandidate[] = (
        await deps.db
          .select({
            id: records.id,
            kind: records.kind,
            label: records.label,
            attributes: records.attributes,
          })
          .from(records)
          .where(
            and(
              eq(records.labId, ctx.labId),
              inArray(records.kind, MATCHED_KINDS),
              ne(records.status, 'archived'),
            ),
          )
      ).map((r) => ({ recordId: r.id, terms: termsOf(r) }));
      const byId = new Map(passages.map((p) => [p.id, p]));
      const now = new Date();
      const rows: Row[] = matchMentions(passages, candidates).map((m) => {
        const p = byId.get(m.passageId) as (typeof passages)[number];
        return {
          id: newId('men'),
          orgId: ctx.orgId,
          labId: ctx.labId,
          documentId: document.id,
          fileId: p.fileId,
          passageId: p.id,
          section: p.section,
          heading: p.heading,
          page: p.page,
          text: m.text,
          type: 'record',
          recordId: m.recordId,
          assay: null,
          parameter: null,
          value: null,
          how: m.how,
          status: 'proposed',
          proposedBy: ctx.actor,
          proposedAt: now,
          reviewedBy: null,
          reviewedAt: null,
        };
      });
      const added = await insertNew(deps.db, ctx, document.id, rows);
      return { mentions: await toMentions(deps.db, added), added: added.length };
    },
  }),
  implement(libraryProposeMentions, {
    agentPolicy: 'direct',
    touches: (input) => [input.document],
    run: async (ctx, input, deps) => {
      const document = await documentOf(deps, ctx, input.document);
      const passages = new Map((await passagesOf(deps.db, ctx, document)).map((p) => [p.id, p]));
      const service = new RecordService(deps.db, deps.kinds);
      const now = new Date();
      const rows: Row[] = [];
      for (const [i, m] of input.mentions.entries()) {
        const where = `Mention ${i + 1}`;
        const p = passages.get(m.passage);
        if (!p)
          throw new OperationError(
            'invalid_input',
            `${where}: ${m.passage} is not a passage of ${document.name}`,
          );
        if (!p.text.toLowerCase().includes(m.text.toLowerCase())) {
          throw new OperationError('invalid_input', `${where}: "${m.text}" is not in that passage`);
        }
        const given = [m.record, m.assay, m.parameter].filter((x) => x !== undefined).length;
        if (given !== 1) {
          throw new OperationError(
            'invalid_input',
            `${where}: give exactly one of record, assay or parameter`,
          );
        }
        if (m.record) {
          const target = await service.get(ctx, m.record).catch(() => undefined);
          if (!target || target.status === 'archived') {
            throw new OperationError(
              'invalid_input',
              `${where}: ${m.record} is not a record in this lab`,
            );
          }
        }
        rows.push({
          id: newId('men'),
          orgId: ctx.orgId,
          labId: ctx.labId,
          documentId: document.id,
          fileId: p.fileId,
          passageId: p.id,
          section: p.section,
          heading: p.heading,
          page: p.page,
          text: m.text,
          type: m.record ? 'record' : m.assay ? 'assay' : 'parameter',
          recordId: m.record ?? null,
          assay: m.assay ?? null,
          parameter: m.parameter?.name ?? null,
          value: m.parameter?.value ?? null,
          how: 'agent',
          status: 'proposed',
          proposedBy: ctx.actor,
          proposedAt: now,
          reviewedBy: null,
          reviewedAt: null,
        });
      }
      const added = await insertNew(deps.db, ctx, document.id, rows);
      return { mentions: await toMentions(deps.db, added), added: added.length };
    },
  }),
  implement(libraryMentionsContract, {
    run: async (ctx, input, deps) => {
      const statuses = input.status ? [input.status] : (['proposed', 'confirmed'] as const);
      const rows = await deps.db
        .select({ mention: libraryMentions })
        .from(libraryMentions)
        .innerJoin(records, eq(records.id, libraryMentions.documentId))
        .where(
          and(
            eq(libraryMentions.labId, ctx.labId),
            ne(records.status, 'archived'),
            inArray(libraryMentions.status, [...statuses]),
            ...(input.document ? [eq(libraryMentions.documentId, input.document)] : []),
            ...(input.record ? [eq(libraryMentions.recordId, input.record)] : []),
            ...(input.parameter
              ? [
                  ilike(
                    libraryMentions.parameter,
                    `%${input.parameter.replace(/[%_\\]/g, '\\$&')}%`,
                  ),
                ]
              : []),
          ),
        )
        .orderBy(
          desc(sql`${libraryMentions.status} = 'confirmed'`),
          asc(libraryMentions.documentId),
          asc(libraryMentions.section),
        )
        .limit(input.limit ?? 100);
      const mentions = await toMentions(
        deps.db,
        rows.map((r) => r.mention),
      );
      const docIds = [...new Set(mentions.map((m) => m.document))];
      const documents =
        docIds.length === 0
          ? []
          : await deps.db
              .select({ id: records.id, name: records.name, label: records.label })
              .from(records)
              .where(inArray(records.id, docIds));
      return { mentions, documents };
    },
  }),
  implement(libraryReviewMentions, {
    actors: 'people',
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const now = new Date();
      const decide = async (ids: string[] | undefined, status: 'confirmed' | 'rejected') => {
        if (!ids || ids.length === 0) return 0;
        const updated = await deps.db
          .update(libraryMentions)
          .set({ status, reviewedBy: ctx.actor, reviewedAt: now })
          .where(and(eq(libraryMentions.labId, ctx.labId), inArray(libraryMentions.id, ids)))
          .returning({ id: libraryMentions.id });
        if (updated.length !== new Set(ids).size) {
          throw new OperationError('not_found', 'Some of those mentions are not in this lab');
        }
        return updated.length;
      };
      return {
        confirmed: await decide(input.confirm, 'confirmed'),
        rejected: await decide(input.reject, 'rejected'),
      };
    },
  }),
];

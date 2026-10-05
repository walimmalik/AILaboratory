import { createHash } from 'node:crypto';
import {
  Converted,
  type DocumentAttributes,
  type DocumentFile,
  type DocumentType,
  libraryAdd,
  libraryAddRevision,
  libraryParse,
  libraryRead,
  librarySearch,
  type SourceSnapshotContent,
} from '@ailab/schema';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  libraryMentions,
  libraryParses,
  libraryPassages,
  librarySnapshots,
  records,
} from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import {
  documentOf,
  ensureCurrentSnapshot,
  lockDocument,
  materializeRetainedParse,
  originalOf,
  parseMetadata,
  resolveSnapshot,
  snapshotDigest,
  sourceReference,
  verifiedFile,
} from './snapshots.ts';

export const libraryOperations = [
  implement(libraryAdd, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'document',
        label,
        attributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Added ${label} to the library`,
      }),
  }),
  implement(libraryAddRevision, {
    agentPolicy: async (ctx, input, deps) =>
      (await new RecordService(deps.db, deps.kinds).get(ctx, input.document)).status === 'active'
        ? 'propose'
        : 'direct',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const document = await service.get(ctx, input.document);
      if (document.kind !== 'document') {
        throw new OperationError('invalid_input', `${document.name} is not a library document`);
      }
      const a = document.attributes as DocumentAttributes;
      if (a.files.some((f) => f.file === input.file)) {
        throw new OperationError('invalid_input', `${input.file} is already one of its files`);
      }
      const files: DocumentFile[] = [
        { file: input.file, role: 'original' },
        ...a.files.map((f) =>
          f.role === 'original'
            ? {
                file: f.file,
                role: 'earlier_revision' as const,
                ...(a.version ? { revision: a.version } : {}),
              }
            : f,
        ),
      ];
      const { version: _v, published: _p, ...rest } = a;
      return service.update(ctx, document.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...rest,
          files,
          ...(input.version ? { version: input.version } : {}),
          ...(input.published ? { published: input.published } : {}),
        },
        reason: input.reason ?? `New revision${input.version ? ` ${input.version}` : ''}`,
      });
    },
  }),
  implement(libraryParse, {
    agentPolicy: 'direct',
    touches: (input) => [input.document],
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      // Capture the selected record version before conversion, which may take a long time.
      const document = await documentOf(service, ctx, input.document);
      const fileId = input.file ?? originalOf(document);
      if (!fileId)
        throw new OperationError('invalid_state', `${document.name} has no original file to parse`);
      if (!(document.attributes as DocumentAttributes).files.some((f) => f.file === fileId)) {
        throw new OperationError(
          'invalid_input',
          `${fileId} is not one of ${document.name}'s files`,
        );
      }
      const { attributes, bytes } = await verifiedFile(service, ctx, fileId, deps.files);
      const converted = Converted.parse(
        await deps.converter.convert({
          name: attributes.originalName,
          mediaType: attributes.mediaType,
          bytes,
        }),
      );
      const published = await deps.db.transaction(async (tx) => {
        await lockDocument(tx, ctx, document.id);
        const where = and(
          eq(libraryPassages.labId, ctx.labId),
          eq(libraryPassages.documentId, document.id),
          eq(libraryPassages.fileId, fileId),
        );
        await materializeRetainedParse(tx, ctx, document.id, fileId);
        const earlier = new Map<string, string[]>();
        const reservedIds = new Set<string>();
        for (const p of await tx
          .select()
          .from(libraryPassages)
          .where(where)
          .orderBy(libraryPassages.section, libraryPassages.seq)) {
          earlier.set(p.text, [...(earlier.get(p.text) ?? []), p.id]);
          reservedIds.add(p.id);
        }
        const content: SourceSnapshotContent = {
          converter: converted.converter,
          warnings: converted.warnings,
          outline: converted.sections.map((s, index) => ({
            index,
            heading: s.heading,
            pageFrom: s.pageFrom ?? null,
            pageTo: s.pageTo ?? null,
            passages: s.passages.length,
          })),
          passages: converted.sections.flatMap((section, index) =>
            section.passages.map((p, seq) => {
              let id = earlier.get(p.text)?.shift();
              if (!id) {
                // A retained repeated passage may already own the ID of a newly added
                // occurrence at its former position. Reserve all retained IDs first.
                let salt = 0;
                do {
                  id = `pas_${createHash('sha256')
                    .update(JSON.stringify([document.id, fileId, index, seq, p.text, salt++]))
                    .digest('hex')
                    .slice(0, 32)}`;
                } while (reservedIds.has(id));
                reservedIds.add(id);
              }
              return {
                id,
                section: index,
                heading: section.heading,
                page: p.page ?? null,
                text: p.text,
              };
            }),
          ),
        };
        const snapshot = snapshotDigest(content);
        const values = {
          documentId: document.id,
          fileId,
          orgId: ctx.orgId,
          labId: ctx.labId,
          sha256: attributes.sha256,
          snapshot,
          converter: content.converter,
          warnings: content.warnings,
          parsedAt: new Date(),
          parsedBy: ctx.actor,
        };
        // A repeated conversion reuses the immutable content and its original parse metadata.
        await tx
          .insert(librarySnapshots)
          .values({ ...values, content })
          .onConflictDoNothing();
        const [stored] = await tx
          .select()
          .from(librarySnapshots)
          .where(
            and(
              eq(librarySnapshots.labId, ctx.labId),
              eq(librarySnapshots.documentId, document.id),
              eq(librarySnapshots.fileId, fileId),
              eq(librarySnapshots.snapshot, snapshot),
            ),
          );
        if (!stored) throw new OperationError('internal', 'Converted-text snapshot was not stored');
        await tx.delete(libraryPassages).where(where);
        await tx
          .delete(libraryMentions)
          .where(
            and(
              eq(libraryMentions.labId, ctx.labId),
              eq(libraryMentions.documentId, document.id),
              eq(libraryMentions.fileId, fileId),
              eq(libraryMentions.status, 'proposed'),
            ),
          );
        const sequences = new Map<number, number>();
        const rows = content.passages.map((p) => {
          const outline = content.outline[p.section];
          const seq = sequences.get(p.section) ?? 0;
          sequences.set(p.section, seq + 1);
          return {
            id: p.id,
            documentId: document.id,
            fileId,
            orgId: ctx.orgId,
            labId: ctx.labId,
            section: p.section,
            heading: p.heading,
            headingText: p.heading.join(' › '),
            sectionPageFrom: outline?.pageFrom ?? null,
            sectionPageTo: outline?.pageTo ?? null,
            seq,
            page: p.page ?? null,
            text: p.text,
          };
        });
        for (let i = 0; i < rows.length; i += 500)
          await tx.insert(libraryPassages).values(rows.slice(i, i + 500));
        await tx
          .insert(libraryParses)
          .values({ ...values, sections: content.outline.length, passages: rows.length })
          .onConflictDoUpdate({
            target: [libraryParses.documentId, libraryParses.fileId],
            set: { ...values, sections: content.outline.length, passages: rows.length },
          });
        return stored;
      });
      return {
        document,
        parse: parseMetadata(published),
        source: sourceReference(document, fileId, attributes.sha256, {
          status: 'parsed',
          snapshot: published.snapshot,
        }),
      };
    },
  }),
  implement(librarySearch, {
    run: async (ctx, input, deps) => {
      // Materialize only retained pre-snapshot projections. The subsequent statement chooses
      // the pointer and matching projection together, even if a reparse commits immediately after.
      const retained = await deps.db
        .select()
        .from(libraryParses)
        .where(and(eq(libraryParses.labId, ctx.labId), isNull(libraryParses.snapshot)));
      for (const p of retained) await ensureCurrentSnapshot(deps.db, ctx, p.documentId, p.fileId);
      const query = sql`websearch_to_tsquery('english', ${input.text})`;
      const filters = [
        eq(libraryPassages.labId, ctx.labId),
        ne(records.status, 'archived'),
        sql`${libraryPassages.search} @@ ${query}`,
        sql`${records.attributes}->'files' @> jsonb_build_array(jsonb_build_object('file', ${libraryPassages.fileId}, 'role', 'original'))`,
        ...(input.type ? [sql`${records.attributes}->>'type' = ${input.type}`] : []),
        ...(input.document ? [eq(libraryPassages.documentId, input.document)] : []),
        ...(input.assay
          ? [
              sql`exists (select 1 from jsonb_array_elements_text(coalesce(${records.attributes}->'assays', '[]'::jsonb)) a where lower(a) = lower(${input.assay}))`,
            ]
          : []),
      ];
      const rank = sql<number>`ts_rank_cd(${libraryPassages.search}, ${query})`;
      const rows = await deps.db
        .select({
          passage: libraryPassages,
          version: records.version,
          sha256: librarySnapshots.sha256,
          snapshot: librarySnapshots.snapshot,
          label: records.label,
          snippet: sql<string>`ts_headline('english', ${libraryPassages.text}, ${query}, 'StartSel=[[, StopSel=]], MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')`,
          rank,
        })
        .from(libraryPassages)
        .innerJoin(records, eq(records.id, libraryPassages.documentId))
        .innerJoin(
          libraryParses,
          and(
            eq(libraryParses.labId, libraryPassages.labId),
            eq(libraryParses.documentId, libraryPassages.documentId),
            eq(libraryParses.fileId, libraryPassages.fileId),
          ),
        )
        .innerJoin(
          librarySnapshots,
          and(
            eq(librarySnapshots.labId, libraryParses.labId),
            eq(librarySnapshots.documentId, libraryParses.documentId),
            eq(librarySnapshots.fileId, libraryParses.fileId),
            eq(librarySnapshots.snapshot, libraryParses.snapshot),
          ),
        )
        .where(and(...filters))
        .orderBy(desc(rank), asc(libraryPassages.documentId), asc(libraryPassages.section))
        .limit(input.limit ?? 10);
      const service = new RecordService(deps.db, deps.kinds);
      return {
        hits: await Promise.all(
          rows.map(async (r) => {
            const resolved = await resolveSnapshot(deps.db, service, deps.files, ctx, {
              source: {
                document: r.passage.documentId,
                version: r.version,
                file: r.passage.fileId,
                sha256: r.sha256,
                parse: { status: 'parsed', snapshot: r.snapshot },
                title: r.label,
              },
            });
            const passage = resolved.content?.passages.find((p) => p.id === r.passage.id);
            if (!passage || !resolved.source || passage.text !== r.passage.text)
              throw new OperationError(
                'invalid_state',
                'Search projection does not match its selected snapshot',
              );
            return {
              document: {
                id: resolved.document.id,
                name: resolved.document.name,
                label: resolved.document.label,
                type: (resolved.document.attributes as DocumentAttributes).type as DocumentType,
              },
              source: resolved.source,
              passage,
              snippet: r.snippet,
              rank: Number(r.rank),
            };
          }),
        ),
      };
    },
  }),
  implement(libraryRead, {
    run: async (ctx, input, deps) => {
      const resolved = await resolveSnapshot(
        deps.db,
        new RecordService(deps.db, deps.kinds),
        deps.files,
        ctx,
        input,
      );
      const exact = 'source' in input;
      const { content, ...result } = resolved;
      if (!content) {
        if (exact && (input.passages || input.section !== undefined || input.pages)) {
          throw new OperationError(
            'invalid_state',
            'Text could not be checked for this exact reference; no parsed passages are available',
          );
        }
        return result;
      }
      if (input.passages) {
        const requested = new Set(input.passages);
        const passages = content.passages.filter((p) => requested.has(p.id));
        if (exact && passages.length !== requested.size)
          throw new OperationError(
            'not_found',
            'A requested passage is missing from the selected snapshot',
          );
        return { ...result, passages };
      }
      if (input.section !== undefined && !content.outline.some((s) => s.index === input.section)) {
        throw new OperationError('not_found', 'The selected section is missing from this snapshot');
      }
      if (input.pages && input.pages.to < input.pages.from)
        throw new OperationError('invalid_input', 'The last page must follow the first page');
      if (input.section !== undefined || input.pages)
        return {
          ...result,
          passages: content.passages.filter(
            (p) =>
              (input.section === undefined || p.section === input.section) &&
              (!input.pages ||
                (p.page != null && p.page >= input.pages.from && p.page <= input.pages.to)),
          ),
        };
      return { ...result, outline: content.outline };
    },
  }),
];

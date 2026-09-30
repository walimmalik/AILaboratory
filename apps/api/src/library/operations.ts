import { newId } from '@ailab/domain';
import {
  type DocumentAttributes,
  type DocumentFile,
  type DocumentParse,
  type DocumentType,
  type FileAttributes,
  libraryAdd,
  libraryAddRevision,
  libraryParse,
  libraryRead,
  librarySearch,
  type PassageText,
  type RecordEnvelope,
} from '@ailab/schema';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { libraryMentions, libraryParses, libraryPassages, records } from '../db/schema.ts';
import { readBytes } from '../files/operations.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { RecordService } from '../records/service.ts';

async function documentOf(service: RecordService, ctx: RecordContext, id: string) {
  const document = await service.get(ctx, id);
  if (document.kind !== 'document') {
    throw new OperationError('invalid_input', `${document.name} is not a library document`);
  }
  return document;
}

async function parseOf(db: Db, labId: string, documentId: string, fileId: string) {
  const [row] = await db
    .select()
    .from(libraryParses)
    .where(
      and(
        eq(libraryParses.labId, labId),
        eq(libraryParses.documentId, documentId),
        eq(libraryParses.fileId, fileId),
      ),
    );
  if (!row) return undefined;
  return {
    file: row.fileId,
    sha256: row.sha256,
    converter: row.converter,
    sections: row.sections,
    passages: row.passages,
    warnings: row.warnings,
    parsedAt: row.parsedAt.toISOString(),
  } satisfies DocumentParse;
}

const originalOf = (document: RecordEnvelope) =>
  (document.attributes as DocumentAttributes).files.find((f) => f.role === 'original')?.file;

const passageText = (row: typeof libraryPassages.$inferSelect): PassageText => ({
  id: row.id,
  section: row.section,
  heading: row.heading,
  page: row.page,
  text: row.text,
});

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
      const document = await documentOf(service, ctx, input.document);
      const fileId = input.file ?? originalOf(document);
      if (!fileId) {
        throw new OperationError('invalid_state', `${document.name} has no original file to parse`);
      }
      if (!(document.attributes as DocumentAttributes).files.some((f) => f.file === fileId)) {
        throw new OperationError(
          'invalid_input',
          `${fileId} is not one of ${document.name}'s files`,
        );
      }
      const file = await service.get(ctx, fileId);
      const attributes = file.attributes as FileAttributes;
      const converted = await deps.converter.convert({
        name: attributes.originalName,
        mediaType: attributes.mediaType,
        bytes: await readBytes(file, deps.files),
      });
      const where = and(
        eq(libraryPassages.documentId, document.id),
        eq(libraryPassages.fileId, fileId),
      );
      await deps.db.delete(libraryPassages).where(where);
      // Proposals point at passages that are about to go; confirmed mentions keep their words.
      await deps.db
        .delete(libraryMentions)
        .where(
          and(
            eq(libraryMentions.documentId, document.id),
            eq(libraryMentions.fileId, fileId),
            eq(libraryMentions.status, 'proposed'),
          ),
        );
      const rows = converted.sections.flatMap((section, index) =>
        section.passages.map((passage, seq) => ({
          id: newId('pas'),
          orgId: ctx.orgId,
          labId: ctx.labId,
          documentId: document.id,
          fileId,
          section: index,
          heading: section.heading,
          headingText: section.heading.join(' › '),
          sectionPageFrom: section.pageFrom ?? null,
          sectionPageTo: section.pageTo ?? null,
          seq,
          page: passage.page ?? null,
          text: passage.text,
        })),
      );
      for (let i = 0; i < rows.length; i += 500) {
        await deps.db.insert(libraryPassages).values(rows.slice(i, i + 500));
      }
      const parsedAt = new Date();
      const values = {
        documentId: document.id,
        fileId,
        orgId: ctx.orgId,
        labId: ctx.labId,
        sha256: attributes.sha256,
        converter: converted.converter,
        sections: converted.sections.length,
        passages: rows.length,
        warnings: converted.warnings,
        parsedAt,
        parsedBy: ctx.actor,
      };
      await deps.db
        .insert(libraryParses)
        .values(values)
        .onConflictDoUpdate({
          target: [libraryParses.documentId, libraryParses.fileId],
          set: values,
        });
      return {
        document,
        parse: (await parseOf(deps.db, ctx.labId, document.id, fileId)) as DocumentParse,
      };
    },
  }),
  implement(librarySearch, {
    run: async (ctx, input, deps) => {
      const query = sql`websearch_to_tsquery('english', ${input.text})`;
      const filters = [
        eq(libraryPassages.labId, ctx.labId),
        ne(records.status, 'archived'),
        sql`${libraryPassages.search} @@ ${query}`,
        // Only the current original: earlier revisions and alternate forms would repeat hits.
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
          name: records.name,
          label: records.label,
          type: sql<string>`${records.attributes}->>'type'`,
          snippet: sql<string>`ts_headline('english', ${libraryPassages.text}, ${query}, 'StartSel=[[, StopSel=]], MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')`,
          rank,
        })
        .from(libraryPassages)
        .innerJoin(records, eq(records.id, libraryPassages.documentId))
        .where(and(...filters))
        .orderBy(desc(rank), asc(libraryPassages.documentId), asc(libraryPassages.section))
        .limit(input.limit ?? 10);
      return {
        hits: rows.map((r) => ({
          document: {
            id: r.passage.documentId,
            name: r.name,
            label: r.label,
            type: r.type as DocumentType,
          },
          passage: passageText(r.passage),
          snippet: r.snippet,
          rank: Number(r.rank),
        })),
      };
    },
  }),
  implement(libraryRead, {
    run: async (ctx, input, deps) => {
      const document = await documentOf(
        new RecordService(deps.db, deps.kinds),
        ctx,
        input.document,
      );
      const fileId = originalOf(document);
      const parse = fileId ? await parseOf(deps.db, ctx.labId, document.id, fileId) : undefined;
      if (!fileId || !parse) return { document };
      const base = and(
        eq(libraryPassages.labId, ctx.labId),
        eq(libraryPassages.documentId, document.id),
        eq(libraryPassages.fileId, fileId),
      );
      const order = [asc(libraryPassages.section), asc(libraryPassages.seq)];
      if (input.passages) {
        const rows = await deps.db
          .select()
          .from(libraryPassages)
          .where(and(base, inArray(libraryPassages.id, input.passages)))
          .orderBy(...order);
        return { document, parse, passages: rows.map(passageText) };
      }
      if (input.section !== undefined || input.pages) {
        const rows = await deps.db
          .select()
          .from(libraryPassages)
          .where(
            and(
              base,
              ...(input.section !== undefined ? [eq(libraryPassages.section, input.section)] : []),
              ...(input.pages
                ? [
                    gte(libraryPassages.page, input.pages.from),
                    lte(libraryPassages.page, input.pages.to),
                  ]
                : []),
            ),
          )
          .orderBy(...order);
        return { document, parse, passages: rows.map(passageText) };
      }
      const rows = await deps.db
        .select({
          section: libraryPassages.section,
          heading: libraryPassages.heading,
          pageFrom: libraryPassages.sectionPageFrom,
          pageTo: libraryPassages.sectionPageTo,
          passages: sql<number>`count(*)::int`,
        })
        .from(libraryPassages)
        .where(base)
        .groupBy(
          libraryPassages.section,
          libraryPassages.heading,
          libraryPassages.sectionPageFrom,
          libraryPassages.sectionPageTo,
        )
        .orderBy(asc(libraryPassages.section));
      return {
        document,
        parse,
        outline: rows.map((r) => ({
          index: r.section,
          heading: r.heading,
          pageFrom: r.pageFrom,
          pageTo: r.pageTo,
          passages: Number(r.passages),
        })),
      };
    },
  }),
];

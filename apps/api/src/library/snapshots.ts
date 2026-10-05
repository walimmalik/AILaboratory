import { createHash } from 'node:crypto';
import {
  type DocumentAttributes,
  type DocumentParse,
  type ExactSourceReference,
  type FileAttributes,
  type RecordEnvelope,
  SourceSnapshotContent,
} from '@ailab/schema';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { libraryParses, libraryPassages, librarySnapshots, records } from '../db/schema.ts';
import { readBytes } from '../files/operations.ts';
import type { FileStore } from '../files/store.ts';
import { sha256Of } from '../files/store.ts';
import { OperationError } from '../operations/errors.ts';
import type { RecordContext, RecordService } from '../records/service.ts';

// JSONB does not preserve object key order. Normalize it before hashing on write and read.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  }
  return value;
}

export const snapshotDigest = (content: SourceSnapshotContent) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(content)))
    .digest('hex');

export const originalOf = (document: RecordEnvelope) =>
  (document.attributes as DocumentAttributes).files.find((f) => f.role === 'original')?.file;

export async function documentOf(service: RecordService, ctx: RecordContext, id: string) {
  const document = await service.get(ctx, id);
  if (document.kind !== 'document') {
    throw new OperationError('invalid_input', `${document.name} is not a library document`);
  }
  return document;
}

export async function verifiedFile(
  service: RecordService,
  ctx: RecordContext,
  id: string,
  files: FileStore,
) {
  const file = await service.get(ctx, id);
  if (file.kind !== 'file')
    throw new OperationError('invalid_input', `${file.name} is not a stored file`);
  const attributes = file.attributes as FileAttributes;
  const bytes = await readBytes(file, files);
  if (sha256Of(bytes) !== attributes.sha256) {
    throw new OperationError(
      'invalid_state',
      `Stored bytes for ${file.name} do not match their SHA256; restore the selected file`,
    );
  }
  return { attributes, bytes };
}

/** Serializes publication and one-time preservation for one document, including empty parses. */
export async function lockDocument(db: Db, ctx: RecordContext, documentId: string) {
  await db
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.id, documentId), eq(records.labId, ctx.labId)))
    .for('update');
}

/**
 * One-time materialization of the only retained pre-snapshot parse. Called under the document
 * lock before replacing the projection. Missing old section headings cannot be reconstructed.
 */
export async function materializeRetainedParse(
  db: Db,
  ctx: RecordContext,
  documentId: string,
  fileId: string,
) {
  const where = and(
    eq(libraryParses.labId, ctx.labId),
    eq(libraryParses.documentId, documentId),
    eq(libraryParses.fileId, fileId),
  );
  const [parse] = await db.select().from(libraryParses).where(where);
  if (!parse || parse.snapshot) return parse;
  const rows = await db
    .select()
    .from(libraryPassages)
    .where(
      and(
        eq(libraryPassages.labId, ctx.labId),
        eq(libraryPassages.documentId, documentId),
        eq(libraryPassages.fileId, fileId),
      ),
    )
    .orderBy(asc(libraryPassages.section), asc(libraryPassages.seq));
  const outline: SourceSnapshotContent['outline'] = [];
  for (const row of rows) {
    const section = outline.find((s) => s.index === row.section);
    if (section) section.passages++;
    else
      outline.push({
        index: row.section,
        heading: row.heading,
        pageFrom: row.sectionPageFrom,
        pageTo: row.sectionPageTo,
        passages: 1,
      });
  }
  const content: SourceSnapshotContent = {
    converter: parse.converter,
    warnings: [
      ...parse.warnings,
      ...(outline.length < parse.sections
        ? [
            'Earlier conversion did not retain empty-section headings; only retained text and headings are available',
          ]
        : []),
    ],
    outline,
    passages: rows.map((r) => ({
      id: r.id,
      section: r.section,
      heading: r.heading,
      page: r.page,
      text: r.text,
    })),
  };
  const snapshot = snapshotDigest(content);
  await db
    .insert(librarySnapshots)
    .values({
      documentId,
      fileId,
      orgId: parse.orgId,
      labId: parse.labId,
      snapshot,
      sha256: parse.sha256,
      content,
      converter: content.converter,
      warnings: content.warnings,
      parsedAt: parse.parsedAt,
      parsedBy: parse.parsedBy,
    })
    .onConflictDoNothing();
  await db.update(libraryParses).set({ snapshot }).where(where);
  return { ...parse, snapshot };
}

export async function ensureCurrentSnapshot(
  db: Db,
  ctx: RecordContext,
  documentId: string,
  fileId: string,
) {
  // Already-materialized reads need no write lock.
  const [parse] = await db
    .select()
    .from(libraryParses)
    .where(
      and(
        eq(libraryParses.labId, ctx.labId),
        eq(libraryParses.documentId, documentId),
        eq(libraryParses.fileId, fileId),
      ),
    );
  if (!parse || parse.snapshot) return parse;
  return db.transaction(async (tx) => {
    await lockDocument(tx, ctx, documentId);
    return materializeRetainedParse(tx, ctx, documentId, fileId);
  });
}

export function sourceReference(
  document: RecordEnvelope,
  fileId: string,
  sha256: string,
  parse: ExactSourceReference['parse'],
): ExactSourceReference {
  const attributes = document.attributes as DocumentAttributes;
  const selected = attributes.files.find((f) => f.file === fileId);
  const printedRevision =
    selected?.revision ?? (selected?.role === 'original' ? attributes.version : undefined);
  return {
    document: document.id,
    version: document.version,
    file: fileId,
    sha256,
    parse,
    title: document.label,
    ...(printedRevision ? { printedRevision } : {}),
  };
}

export function parseMetadata(row: typeof librarySnapshots.$inferSelect): DocumentParse {
  return {
    file: row.fileId,
    sha256: row.sha256,
    snapshot: row.snapshot,
    converter: row.content.converter,
    sections: row.content.outline.length,
    passages: row.content.passages.length,
    warnings: row.content.warnings,
    parsedAt: row.parsedAt.toISOString(),
  };
}

/** The one reader for discovery and exact references. Never substitutes another snapshot. */
export async function resolveSnapshot(
  db: Db,
  service: RecordService,
  files: FileStore,
  ctx: RecordContext,
  selection: { document?: string | undefined; source?: ExactSourceReference | undefined },
) {
  const current = await documentOf(
    service,
    ctx,
    selection.source?.document ?? (selection.document as string),
  );
  const document = selection.source
    ? (await service.getVersion(ctx, current.id, selection.source.version)).snapshot
    : current;
  const fileId = selection.source?.file ?? originalOf(document);
  if (!fileId) return { document };
  if (!(document.attributes as DocumentAttributes).files.some((f) => f.file === fileId)) {
    throw new OperationError(
      'invalid_input',
      `The selected file is not attached to ${document.name} at version ${document.version}`,
    );
  }
  const { attributes } = await verifiedFile(service, ctx, fileId, files);
  if (selection.source && selection.source.sha256 !== attributes.sha256) {
    throw new OperationError(
      'invalid_input',
      'The selected file SHA256 does not match the exact reference',
    );
  }
  if (selection.source?.parse.status === 'unavailable') {
    return {
      document,
      source: sourceReference(document, fileId, attributes.sha256, selection.source.parse),
    };
  }
  const snapshot =
    selection.source?.parse.status === 'parsed'
      ? selection.source.parse.snapshot
      : (await ensureCurrentSnapshot(db, ctx, document.id, fileId))?.snapshot;
  if (!snapshot)
    return {
      document,
      source: sourceReference(document, fileId, attributes.sha256, {
        status: 'unavailable',
        reason: 'Text has not been parsed for this file',
      }),
    };
  const [row] = await db
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
  if (!row)
    throw new OperationError(
      'not_found',
      'The selected converted-text snapshot is unavailable; choose a retained snapshot',
    );
  const parsed = SourceSnapshotContent.safeParse(row.content);
  if (
    !parsed.success ||
    snapshotDigest(parsed.data) !== snapshot ||
    row.sha256 !== attributes.sha256
  ) {
    throw new OperationError(
      'invalid_state',
      'The selected converted-text snapshot failed its identity check',
    );
  }
  return {
    document,
    source: sourceReference(document, fileId, attributes.sha256, { status: 'parsed', snapshot }),
    parse: parseMetadata(row),
    content: parsed.data,
  };
}

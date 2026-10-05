import type { Converted, ExactSourceReference, PassageText, RecordEnvelope } from '@ailab/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { libraryParses, librarySnapshots } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import type { OperationImplementation } from '../operations/registry.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import type { Converter } from './convert.ts';
import { libraryKinds } from './kinds.ts';
import { libraryOperations } from './operations.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let files: MemoryFileStore;
let person: RecordContext;
let otherLab: RecordContext;
let convert: Converter['convert'];

const conversion = (text: string): Converted => ({
  converter: 'test',
  warnings: [],
  sections: [
    { heading: ['Empty'], pageFrom: 1, pageTo: 1, passages: [] },
    { heading: ['Method'], pageFrom: 2, pageTo: 2, passages: [{ text, page: 2 }] },
  ],
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  person = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [...fileKinds, ...libraryKinds]) kinds.register(kind);
  files = new MemoryFileStore();
  convert = async ({ bytes }) => conversion(new TextDecoder().decode(bytes));
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
    files,
    converter: { convert: (input) => convert(input) },
  });
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
  return result.output as T;
}

async function upload(text: string) {
  return (
    await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'method.txt',
      mediaType: 'text/plain',
      text,
    })
  ).file;
}
async function document(text = 'Use the old buffer.') {
  const file = await upload(text);
  const doc = await run<RecordEnvelope>(person, 'library.add', {
    label: 'Original title',
    type: 'sop',
    version: 'Edition 1',
    license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
    files: [{ file: file.id, role: 'original' }],
  });
  return { doc, file };
}
async function parse(doc: RecordEnvelope) {
  return run<{ source: ExactSourceReference }>(person, 'library.parse', { document: doc.id });
}
async function text(source: ExactSourceReference) {
  return run<{ source: ExactSourceReference; document: RecordEnvelope; passages: PassageText[] }>(
    person,
    'library.read',
    { source, section: 1 },
  );
}

describe('exact library snapshots', () => {
  it('pins changed warnings and converter provenance even when sections and text are unchanged', async () => {
    const { doc } = await document();
    const original = await parse(doc);
    const warning = 'Scanned figure text could not be checked';
    type Parsed = {
      source: ExactSourceReference;
      parse: { converter: string; warnings: string[] };
    };
    convert = async ({ bytes }) => ({
      ...conversion(new TextDecoder().decode(bytes)),
      warnings: [warning],
    });
    const warned = await run<Parsed>(person, 'library.parse', { document: doc.id });
    expect(warned.source.parse).not.toEqual(original.source.parse);
    expect(warned.parse).toMatchObject({ converter: 'test', warnings: [warning] });
    const currentWarned = await run<Parsed>(person, 'library.read', { document: doc.id });
    expect(currentWarned.parse).toMatchObject({ converter: 'test', warnings: [warning] });
    expect(currentWarned.source.parse).toEqual(warned.source.parse);
    convert = async ({ bytes }) => ({
      ...conversion(new TextDecoder().decode(bytes)),
      converter: 'test-v2',
      warnings: [warning],
    });
    const changedConverter = await run<Parsed>(person, 'library.parse', { document: doc.id });
    expect(changedConverter.source.parse).not.toEqual(warned.source.parse);
    expect(changedConverter.parse).toMatchObject({ converter: 'test-v2', warnings: [warning] });
    const current = await run<Parsed>(person, 'library.read', { document: doc.id });
    expect(current.parse).toMatchObject({ converter: 'test-v2', warnings: [warning] });
    expect(
      (await run<Parsed>(person, 'library.read', { source: original.source })).parse,
    ).toMatchObject({ converter: 'test', warnings: [] });
    expect(
      (await run<Parsed>(person, 'library.read', { source: warned.source })).parse,
    ).toMatchObject({ converter: 'test', warnings: [warning] });
  });

  it('keeps repeated passage IDs unique when retained text moves to an earlier position', async () => {
    const { doc } = await document();
    const repeated = (texts: string[]): Converted => ({
      converter: 'test',
      warnings: [],
      sections: [{ heading: ['Method'], passages: texts.map((text) => ({ text })) }],
    });
    convert = async () => repeated(['First', 'Second', 'Repeated']);
    const original = await parse(doc);
    const old = await run<{ passages: PassageText[] }>(person, 'library.read', {
      source: original.source,
      section: 0,
    });
    convert = async () => repeated(['Repeated', 'Repeated', 'Repeated']);
    const newer = await parse(doc);
    const read = await run<{ passages: PassageText[] }>(person, 'library.read', {
      source: newer.source,
      section: 0,
    });
    expect(new Set(read.passages.map((p) => p.id)).size).toBe(3);
    expect(read.passages[0]?.id).toBe(old.passages[2]?.id);
    const again = await parse(doc);
    expect(again.source.parse).toEqual(newer.source.parse);
  });

  it('retains v1 instructions and historical metadata after a new revision and title', async () => {
    const { doc } = await document();
    const v1 = await parse(doc);
    const file2 = await upload('Use the new buffer.');
    const v2doc = await run<RecordEnvelope>(person, 'library.add_revision', {
      document: doc.id,
      expectedVersion: doc.version,
      file: file2.id,
      version: 'Edition 2',
    });
    await run(person, 'records.update', {
      id: doc.id,
      expectedVersion: v2doc.version,
      label: 'New title',
    });
    const v2 = await parse(doc);
    await expect(
      run(person, 'library.read', { source: { ...v2.source, version: v1.source.version } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await text(v1.source)).passages[0]?.text).toBe('Use the old buffer.');
    expect((await text(v1.source)).document).toMatchObject({ label: 'Original title', version: 1 });
    expect(
      (await text({ ...v1.source, title: 'Untrusted title', printedRevision: 'Untrusted edition' }))
        .source,
    ).toMatchObject({ title: 'Original title', printedRevision: 'Edition 1' });
    expect((await text(v2.source)).passages[0]?.text).toBe('Use the new buffer.');
    expect(v1.source.parse).not.toEqual(v2.source.parse);
  });

  it('retains changed same-byte conversions, including empty headings and stable exact passages', async () => {
    const { doc } = await document();
    const first = await parse(doc);
    const old = await text(first.source);
    convert = async () => conversion('A corrected converted passage.');
    const second = await parse(doc);
    expect(second.source.sha256).toBe(first.source.sha256);
    expect(second.source.parse).not.toEqual(first.source.parse);
    const pinned = await run<{ passages: PassageText[] }>(person, 'library.read', {
      source: first.source,
      passages: [old.passages[0]?.id],
    });
    expect(pinned.passages).toEqual(old.passages);
    expect((await text(second.source)).passages[0]?.text).toBe('A corrected converted passage.');
    const outline = await run<{ outline: unknown[] }>(person, 'library.read', {
      source: first.source,
    });
    expect(outline.outline[0]).toEqual({
      index: 0,
      heading: ['Empty'],
      pageFrom: 1,
      pageTo: 1,
      passages: 0,
    });
    expect(
      (
        await run<{ passages: unknown[] }>(person, 'library.read', {
          source: first.source,
          section: 0,
        })
      ).passages,
    ).toEqual([]);
  });

  it('rolls back publication failure after projection deletion and leaves the prior current pointer intact', async () => {
    const { doc } = await document();
    const before = await parse(doc);
    await db.execute(
      sql`CREATE FUNCTION refuse_test_passage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.text = 'Rejected publication' THEN RAISE EXCEPTION 'test publication failure'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER refuse_test_passage BEFORE INSERT ON library_passages FOR EACH ROW EXECUTE FUNCTION refuse_test_passage()`,
    );
    convert = async () => conversion('Rejected publication');
    await expect(parse(doc)).rejects.toThrow();
    const current = await run<{ source: ExactSourceReference; passages: PassageText[] }>(
      person,
      'library.read',
      { document: doc.id, section: 1 },
    );
    expect(current.source.parse).toEqual(before.source.parse);
    expect(current.passages[0]?.text).toBe('Use the old buffer.');
    expect(await db.select().from(librarySnapshots)).toHaveLength(1);
    expect(
      (await run<{ hits: unknown[] }>(person, 'library.search', { text: 'old buffer' })).hits,
    ).toHaveLength(1);
  });

  it('refuses wrong version, file, byte digest, snapshot and passage, and cross-lab references', async () => {
    const { doc } = await document();
    const { source } = await parse(doc);
    const anotherFile = await upload('Different file');
    const changed = [
      { ...source, version: 999 },
      { ...source, file: anotherFile.id },
      { ...source, sha256: '0'.repeat(64) },
      { ...source, parse: { status: 'parsed', snapshot: '0'.repeat(64) } },
    ];
    for (const bad of changed)
      await expect(run(person, 'library.read', { source: bad })).rejects.toThrow();
    await expect(
      run(person, 'library.read', { source, passages: ['pas_missing'] }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(run(otherLab, 'library.read', { source })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(run(otherLab, 'library.parse', { document: doc.id })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(run(person, 'library.read', { document: doc.id, source })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const actualBytes = await files.get(source.sha256);
    actualBytes?.fill(0);
    await expect(text(source)).rejects.toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('SHA256'),
    });
    await expect(parse(doc)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('returns an explicit unavailable attachment without manufacturing parsed evidence', async () => {
    const { doc } = await document();
    const current = await run<{ source: ExactSourceReference; parse?: unknown }>(
      person,
      'library.read',
      { document: doc.id },
    );
    expect(current.source.parse.status).toBe('unavailable');
    expect(current.parse).toBeUndefined();
    await parse(doc);
    const attached = await run<{ source: ExactSourceReference; parse?: unknown }>(
      person,
      'library.read',
      { source: current.source },
    );
    expect(attached.source.parse.status).toBe('unavailable');
    expect(attached.parse).toBeUndefined();
    await expect(
      run(person, 'library.read', { source: current.source, passages: ['pas_any'] }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('returns a search pin that reads the identical passage after reparse', async () => {
    const { doc } = await document();
    await parse(doc);
    const { hits } = await run<{ hits: { source: ExactSourceReference; passage: PassageText }[] }>(
      person,
      'library.search',
      { text: 'old buffer' },
    );
    const hit = hits[0];
    expect(hit).toBeDefined();
    convert = async () => conversion('A replacement buffer passage');
    await parse(doc);
    const read = await run<{ passages: PassageText[] }>(person, 'library.read', {
      source: hit?.source,
      passages: [hit?.passage.id],
    });
    expect(read.passages).toEqual([hit?.passage]);
  });

  it('keeps conversion bound to the selected file/version when a revision is added in flight', async () => {
    const { doc, file } = await document();
    let started: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const converting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      finish = resolve;
    });
    convert = async ({ bytes }) => {
      started?.();
      await pause;
      return conversion(new TextDecoder().decode(bytes));
    };
    // PGlite has one connection. Run the operation body to interleave conversion and a real
    // committed record write, as two API transactions can do on the Postgres connection pool.
    const operation = libraryOperations.find((o) => o.contract.id === 'library.parse');
    if (!operation) throw new Error('Missing parse operation');
    const pending = (operation as OperationImplementation).run(
      person,
      { document: doc.id },
      registry.deps,
    );
    await converting;
    const next = await upload('New bytes');
    await run(person, 'library.add_revision', {
      document: doc.id,
      expectedVersion: doc.version,
      file: next.id,
      version: 'Edition 2',
    });
    finish?.();
    const result = (await pending) as { source: ExactSourceReference };
    expect(result.source).toMatchObject({
      version: 1,
      file: file.id,
      printedRevision: 'Edition 1',
    });
    expect((await text(result.source)).passages[0]?.text).toBe('Use the old buffer.');
    expect(
      (await run<{ hits: unknown[] }>(person, 'library.search', { text: 'old buffer' })).hits,
    ).toEqual([]);
    const current = await run<{ source: ExactSourceReference }>(person, 'library.read', {
      document: doc.id,
    });
    expect(current.source).toMatchObject({ file: next.id, parse: { status: 'unavailable' } });
  });

  it('materializes only the observable retained parse before replacing its projection', async () => {
    const { doc } = await document();
    const first = await parse(doc);
    const retained = await text(first.source);
    // Represent a populated pre-snapshot database: the old projection retained text but
    // never stored the empty section's heading. No deleted historical parse is available.
    await db.delete(librarySnapshots);
    await db
      .update(libraryParses)
      .set({ snapshot: null })
      .where(and(eq(libraryParses.labId, person.labId), eq(libraryParses.documentId, doc.id)));
    const preserved = await run<{
      source: ExactSourceReference;
      outline: { index: number }[];
      parse: { warnings: string[] };
    }>(person, 'library.read', { document: doc.id });
    expect(preserved.outline.map((s) => s.index)).toEqual([1]);
    expect(preserved.parse.warnings.join(' ')).toContain('did not retain empty-section headings');
    convert = async () => conversion('New converted text');
    await parse(doc);
    expect((await text(preserved.source)).passages).toEqual(retained.passages);
    expect(await db.select().from(librarySnapshots)).toHaveLength(2);
  });
});

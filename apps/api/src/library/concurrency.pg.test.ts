import type {
  Actor,
  Converted,
  ExactSourceReference,
  PassageText,
  RecordEnvelope,
} from '@ailab/schema';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { connect } from '../db/client.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import { libraryKinds } from './kinds.ts';

const url = process.env.TEST_DATABASE_URL;
const converted = (text: string): Converted => ({
  converter: 'test',
  warnings: [],
  sections: [{ heading: ['Method'], passages: [{ text, page: 1 }] }],
});

/** Real pooled Postgres: creates and drops its own database, matching inventory's PG gate. */
describe.skipIf(!url)('library snapshots on Postgres', () => {
  it('serializes overlapping publications and pins search and in-flight conversion to their actual source', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `ailab_source_race_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = new URL(url as string);
    scratch.pathname = `/${name}`;
    const { db, migrate, close } = await connect(scratch.toString());
    try {
      await migrate();
      const tenant = await createTenant(db, {
        orgName: 'Concurrency',
        labName: 'Library',
        userName: 'Wali',
      });
      const ctx = {
        actor: { type: 'user', userId: tenant.userId } as Actor,
        orgId: tenant.orgId,
        labId: tenant.labId,
      };
      const kinds = new KindRegistry();
      for (const kind of [...fileKinds, ...libraryKinds]) kinds.register(kind);
      let pauseBytes: (() => Promise<void>) | undefined;
      class PausableFiles extends MemoryFileStore {
        override async get(hash: string) {
          const pause = pauseBytes;
          pauseBytes = undefined;
          await pause?.();
          return super.get(hash);
        }
      }
      const files = new PausableFiles();
      let convert = async ({ bytes }: { bytes: Uint8Array }) =>
        converted(new TextDecoder().decode(bytes));
      const registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
        files,
        converter: { convert: (input) => convert(input) },
      });
      const run = async <T>(id: string, input: unknown) => {
        const result = await registry.execute(ctx, id, input);
        if (result.status !== 'done') throw new Error(`${id} did not complete`);
        return result.output as T;
      };
      const { file } = await run<{ file: RecordEnvelope }>('files.upload', {
        name: 'method.txt',
        mediaType: 'text/plain',
        text: 'Original buffer instructions',
      });
      const doc = await run<RecordEnvelope>('library.add', {
        label: 'Original title',
        type: 'sop',
        version: 'Edition 1',
        license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
        files: [{ file: file.id, role: 'original' }],
      });
      const first = await run<{ source: ExactSourceReference }>('library.parse', {
        document: doc.id,
      });

      // The search statement has already chosen its projection + pointer when file-byte
      // verification starts. Publish another parse before the exact resolver finishes.
      let selected: (() => void) | undefined;
      let resumeSearch: (() => void) | undefined;
      const searchSelected = new Promise<void>((resolve) => {
        selected = resolve;
      });
      const searchPause = new Promise<void>((resolve) => {
        resumeSearch = resolve;
      });
      pauseBytes = async () => {
        selected?.();
        await searchPause;
      };
      const pendingSearch = run<{ hits: { source: ExactSourceReference; passage: PassageText }[] }>(
        'library.search',
        { text: 'buffer' },
      );
      await searchSelected;
      convert = async () => converted('Replacement buffer instructions');
      await run('library.parse', { document: doc.id });
      resumeSearch?.();
      const hit = (await pendingSearch).hits[0];
      expect(hit?.source.parse).toEqual(first.source.parse);
      expect(hit?.passage.text).toBe('Original buffer instructions');
      const pinned = await run<{ passages: PassageText[] }>('library.read', {
        source: hit?.source,
        passages: [hit?.passage.id],
      });
      expect(pinned.passages).toEqual([hit?.passage]);

      let next = 0;
      convert = async () => converted(`Concurrent buffer ${next++}`);
      const publications = await Promise.all(
        Array.from({ length: 6 }, () =>
          run<{ source: ExactSourceReference }>('library.parse', { document: doc.id }),
        ),
      );
      expect(
        new Set(
          publications.map((p) =>
            p.source.parse.status === 'parsed' ? p.source.parse.snapshot : '',
          ),
        ).size,
      ).toBe(6);
      for (const publication of publications) {
        const read = await run<{ passages: PassageText[] }>('library.read', {
          source: publication.source,
          section: 0,
        });
        expect(read.passages[0]?.text).toMatch(/^Concurrent buffer [0-5]$/);
      }
      const current = await run<{ source: ExactSourceReference; passages: PassageText[] }>(
        'library.read',
        { document: doc.id, section: 0 },
      );
      const currentHit = (
        await run<{ hits: { source: ExactSourceReference; passage: PassageText }[] }>(
          'library.search',
          { text: 'buffer' },
        )
      ).hits[0];
      expect(currentHit?.source.parse).toEqual(current.source.parse);
      expect(currentHit?.passage).toEqual(current.passages[0]);

      // A metadata/revision write must commit while conversion is waiting, and the older
      // conversion must still return its captured file and historical record version.
      let began: (() => void) | undefined;
      let resumeConversion: (() => void) | undefined;
      const conversionStarted = new Promise<void>((resolve) => {
        began = resolve;
      });
      const conversionPause = new Promise<void>((resolve) => {
        resumeConversion = resolve;
      });
      convert = async ({ bytes }) => {
        began?.();
        await conversionPause;
        return converted(new TextDecoder().decode(bytes));
      };
      const pendingParse = run<{ source: ExactSourceReference }>('library.parse', {
        document: doc.id,
      });
      await conversionStarted;
      const newFile = await run<{ file: RecordEnvelope }>('files.upload', {
        name: 'v2.txt',
        mediaType: 'text/plain',
        text: 'New edition instructions',
      });
      await run('library.add_revision', {
        document: doc.id,
        expectedVersion: doc.version,
        file: newFile.file.id,
        version: 'Edition 2',
      });
      resumeConversion?.();
      const oldPublication = await pendingParse;
      expect(oldPublication.source).toMatchObject({
        version: 1,
        file: file.id,
        printedRevision: 'Edition 1',
      });
      const oldText = await run<{ passages: PassageText[] }>('library.read', {
        source: oldPublication.source,
        section: 0,
      });
      expect(oldText.passages[0]?.text).toBe('Original buffer instructions');
      const latest = await run<{ source: ExactSourceReference }>('library.read', {
        document: doc.id,
      });
      expect(latest.source).toMatchObject({
        file: newFile.file.id,
        parse: { status: 'unavailable' },
      });
    } finally {
      await close();
      await admin.query(`drop database ${name}`);
      await admin.end();
    }
  }, 60_000);
});

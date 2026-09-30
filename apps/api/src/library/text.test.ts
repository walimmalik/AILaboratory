import type { Actor, Converted, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { OperationError } from '../operations/errors.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import type { Converter } from './convert.ts';
import { libraryKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

/** Splits Markdown on "# " headings, one passage per paragraph: enough to test the API side. */
const converter: Converter = {
  convert: async ({ name, mediaType, bytes }) => {
    if (mediaType === 'application/pdf') {
      throw new OperationError('invalid_input', `${name} needs the Docling conversion`);
    }
    const sections: Converted['sections'] = [];
    for (const part of new TextDecoder().decode(bytes).split(/^# /m).filter(Boolean)) {
      const [heading, ...rest] = part.split('\n');
      sections.push({
        heading: [heading as string],
        pageFrom: 1,
        pageTo: 1,
        passages: rest
          .join('\n')
          .split(/\n\n+/)
          .filter((t) => t.trim())
          .map((text, i) => ({ text: text.trim(), page: i + 1 })),
      });
    }
    return { converter: 'test', sections, warnings: [] };
  },
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...fileKinds, ...libraryKinds]) kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
    files: new MemoryFileStore(),
    converter,
  });
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
  return result.output as T;
}

async function addDocument(
  ctx: RecordContext,
  label: string,
  text: string,
  extra: Record<string, unknown> = {},
  mediaType = 'text/markdown',
) {
  const { file } = await run<{ file: RecordEnvelope }>(ctx, 'files.upload', {
    name: `${label}.md`,
    mediaType,
    text,
  });
  return run<RecordEnvelope>(ctx, 'library.add', {
    label,
    type: 'sop',
    license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
    files: [{ file: file.id, role: 'original' }],
    ...extra,
  });
}

const ELISA = `# Coating
Dilute the capture antibody to 4 ug/mL in PBS and add 100 uL per well.

Seal and incubate overnight at room temperature.

# Blocking
Block plates with 300 uL reagent diluent for a minimum of 1 hour.

# Substrate
Add 100 uL TMB substrate solution and incubate for 20 minutes, protected from light.`;

type Hits = {
  hits: {
    document: { name: string; label: string };
    passage: { text: string; heading: string[]; page: number | null; section: number };
    snippet: string;
  }[];
};

describe('library text', () => {
  it('parses a document into sections and passages, and parses again without duplicates', async () => {
    const doc = await addDocument(agent, 'DuoSet ELISA', ELISA, { assays: ['ELISA'] });
    const { parse } = await run<{
      parse: { sections: number; passages: number; converter: string };
    }>(agent, 'library.parse', { document: doc.id });
    expect(parse).toMatchObject({ sections: 3, passages: 4, converter: 'test' });
    const again = await run<{ parse: { passages: number } }>(agent, 'library.parse', {
      document: doc.id,
    });
    expect(again.parse.passages).toBe(4);

    const outline = await run<{
      outline: { index: number; heading: string[]; passages: number }[];
    }>(person, 'library.read', { document: doc.id });
    expect(outline.outline).toEqual([
      expect.objectContaining({ index: 0, heading: ['Coating'], passages: 2 }),
      expect.objectContaining({ index: 1, heading: ['Blocking'], passages: 1 }),
      expect.objectContaining({ index: 2, heading: ['Substrate'], passages: 1 }),
    ]);
    const coating = await run<{ passages: { text: string }[] }>(person, 'library.read', {
      document: doc.id,
      section: 0,
    });
    expect(coating.passages.map((p) => p.text)).toEqual([
      'Dilute the capture antibody to 4 ug/mL in PBS and add 100 uL per well.',
      'Seal and incubate overnight at room temperature.',
    ]);
    const page2 = await run<{ passages: { text: string }[] }>(person, 'library.read', {
      document: doc.id,
      pages: { from: 2, to: 2 },
    });
    expect(page2.passages).toHaveLength(1);
  });

  it('finds passages by words, stems and phrases, with filters and highlighted snippets', async () => {
    const elisa = await addDocument(person, 'DuoSet ELISA', ELISA, { assays: ['ELISA'] });
    const gibson = await addDocument(
      person,
      'Gibson assembly',
      '# Assembly\nMix fragments with 2x master mix and incubate at 50 C for 15 minutes.',
      { assays: ['Gibson assembly'] },
    );
    await run(person, 'library.parse', { document: elisa.id });
    await run(person, 'library.parse', { document: gibson.id });

    const block = await run<Hits>(person, 'library.search', { text: 'blocking hours' });
    expect(block.hits[0]?.passage.heading).toEqual(['Blocking']);
    expect(block.hits[0]?.snippet).toContain('[[Block]]');

    const tmb = await run<Hits>(agent, 'library.search', { text: 'TMB' });
    expect(tmb.hits.map((h) => h.document.label)).toEqual(['DuoSet ELISA']);

    const incubate = await run<Hits>(person, 'library.search', { text: 'incubate' });
    expect(new Set(incubate.hits.map((h) => h.document.label))).toEqual(
      new Set(['DuoSet ELISA', 'Gibson assembly']),
    );
    const onlyGibson = await run<Hits>(person, 'library.search', {
      text: 'incubate',
      assay: 'gibson ASSEMBLY',
    });
    expect(onlyGibson.hits.map((h) => h.document.label)).toEqual(['Gibson assembly']);
    const phrase = await run<Hits>(person, 'library.search', { text: '"room temperature"' });
    expect(phrase.hits).toHaveLength(1);
    const none = await run<Hits>(person, 'library.search', { text: 'incubate', type: 'paper' });
    expect(none.hits).toEqual([]);
  });

  it('searches only the current revision and only this lab', async () => {
    const doc = await addDocument(person, 'Old SOP', '# Step\nUse the old buffer.');
    await run(person, 'library.parse', { document: doc.id });
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'new.md',
      mediaType: 'text/markdown',
      text: '# Step\nUse the new buffer.',
    });
    await run(person, 'library.add_revision', {
      document: doc.id,
      expectedVersion: doc.version,
      file: file.id,
    });
    expect((await run<Hits>(person, 'library.search', { text: 'buffer' })).hits).toEqual([]);
    await run(person, 'library.parse', { document: doc.id });
    const hits = (await run<Hits>(person, 'library.search', { text: 'buffer' })).hits;
    expect(hits.map((h) => h.passage.text)).toEqual(['Use the new buffer.']);

    expect((await run<Hits>(otherLab, 'library.search', { text: 'buffer' })).hits).toEqual([]);
    await expect(
      registry.execute(otherLab, 'library.parse', { document: doc.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses files it cannot read yet and files that are not the document’s', async () => {
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'manual.pdf',
      mediaType: 'application/pdf',
      base64: 'JVBERi0xLjcK',
    });
    const pdf = await run<RecordEnvelope>(person, 'library.add', {
      label: 'A manual',
      type: 'vendor_manual',
      license: { name: 'All Rights Reserved', sharePolicy: 'lab_private' },
      files: [{ file: file.id, role: 'original' }],
    });
    await expect(
      registry.execute(person, 'library.parse', { document: pdf.id }),
    ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('Docling') });
    const read = await run<{ parse?: unknown; outline?: unknown }>(person, 'library.read', {
      document: pdf.id,
    });
    expect(read.parse).toBeUndefined();

    const other = await addDocument(person, 'Other', '# A\nB');
    await expect(
      registry.execute(person, 'library.parse', {
        document: pdf.id,
        file: (other.attributes as { files: { file: string }[] }).files[0]?.file,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

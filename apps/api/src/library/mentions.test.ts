import type { Actor, Converted, Mention, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
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

/** One section per "# " heading, one passage per paragraph. */
const converter: Converter = {
  convert: async ({ bytes }) => {
    const sections: Converted['sections'] = [];
    for (const part of new TextDecoder().decode(bytes).split(/^# /m).filter(Boolean)) {
      const [heading, ...rest] = part.split('\n');
      sections.push({
        heading: [heading as string],
        passages: rest
          .join('\n')
          .split(/\n\n+/)
          .filter((t) => t.trim())
          .map((text) => ({ text: text.trim(), page: 3 })),
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
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...fileKinds,
    ...libraryKinds,
  ])
    kinds.register(kind);
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

const SOP = `# Materials
Human IL-6 DuoSet ELISA (DY206) and Corning 3590 plates.

# Blocking
Block with 300 uL reagent diluent for 1 hour at room temperature.`;

async function parsedDocument(ctx: RecordContext, label: string, text: string) {
  const { file } = await run<{ file: RecordEnvelope }>(ctx, 'files.upload', {
    name: `${label}.md`,
    mediaType: 'text/markdown',
    text,
  });
  const doc = await run<RecordEnvelope>(ctx, 'library.add', {
    label,
    type: 'sop',
    license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
    files: [{ file: file.id, role: 'original' }],
  });
  await run(ctx, 'library.parse', { document: doc.id });
  return doc;
}

async function registries() {
  const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
    label: 'Human IL-6 DuoSet ELISA',
    attributes: { category: 'assay_kit', origin: 'bought', catalog: [{ number: 'DY206' }] },
  });
  const plate = await run<RecordEnvelope>(person, 'records.create', {
    kind: 'labware_type',
    label: 'Costar high-binding 96',
    attributes: { family: 'plate', catalogNumber: '3590' },
  });
  return { product, plate };
}

type Mentions = { mentions: Mention[]; added: number };

describe('library mentions', () => {
  it('mines records a document names, once, and a person confirms or rejects them in bulk', async () => {
    const { product, plate } = await registries();
    const doc = await parsedDocument(agent, 'IL-6 ELISA', SOP);
    const mined = await run<Mentions>(agent, 'library.mine', { document: doc.id });
    expect(mined.added).toBe(2);
    const byRecord = new Map(
      mined.mentions.map((m) => [m.what.type === 'record' ? m.what.record : '', m]),
    );
    expect(byRecord.get(product.id)).toMatchObject({
      text: 'DY206',
      how: 'catalog_number',
      status: 'proposed',
      heading: ['Materials'],
      page: 3,
      what: { type: 'record', kind: 'product', label: 'Human IL-6 DuoSet ELISA' },
    });
    expect(byRecord.get(plate.id)).toMatchObject({ text: '3590', how: 'catalog_number' });
    expect((await run<Mentions>(agent, 'library.mine', { document: doc.id })).added).toBe(0);

    // The document waits in Review, addressed to the person the agent worked for (ADR 0052).
    type Waiting = {
      items: { type: string; for?: string; proposed?: number; document?: { id: string } }[];
      counts: { mentions: number; needsYou: number };
    };
    const review = await run<Waiting>(person, 'review.list', {});
    const waiting = review.items.find((i) => i.type === 'mentions');
    expect(waiting).toMatchObject({
      tier: 'to_confirm',
      for: (person.actor as { userId: string }).userId,
      proposed: 2,
      document: { id: doc.id },
    });
    expect(review.counts).toMatchObject({ mentions: 2, needsYou: 0 });

    await expect(
      registry.execute(agent, 'library.review_mentions', { confirm: [mined.mentions[0]?.id] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const productMention = byRecord.get(product.id) as Mention;
    const plateMention = byRecord.get(plate.id) as Mention;
    expect(
      await run(person, 'library.review_mentions', {
        confirm: [productMention.id],
        reject: [plateMention.id],
      }),
    ).toEqual({ confirmed: 1, rejected: 0 + 1 });

    const where = await run<{ mentions: Mention[]; documents: { label: string }[] }>(
      person,
      'library.mentions',
      { record: product.id },
    );
    expect(where.documents.map((d) => d.label)).toEqual(['IL-6 ELISA']);
    expect(where.mentions[0]).toMatchObject({ status: 'confirmed', reviewedBy: person.actor });
    expect(
      (await run<Waiting>(person, 'review.list', {})).items.filter((i) => i.type === 'mentions'),
    ).toEqual([]);
    const shown = await run<{ mentions: Mention[] }>(person, 'library.mentions', {
      document: doc.id,
    });
    expect(shown.mentions.map((m) => m.status)).toEqual(['confirmed']);

    await expect(
      registry.execute(otherLab, 'library.review_mentions', { confirm: [plateMention.id] }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await run<{ mentions: Mention[] }>(otherLab, 'library.mentions', { record: product.id }))
        .mentions,
    ).toEqual([]);
  });

  it('takes an agent’s mentions of parameters and assays, checked against the passage', async () => {
    const doc = await parsedDocument(agent, 'IL-6 ELISA', SOP);
    const outline = await run<{ passages: { id: string; text: string }[] }>(agent, 'library.read', {
      document: doc.id,
      section: 1,
    });
    const passage = outline.passages[0] as { id: string };
    const proposed = await run<Mentions>(agent, 'library.propose_mentions', {
      document: doc.id,
      mentions: [
        {
          passage: passage.id,
          text: '1 hour',
          parameter: { name: 'blocking time', value: { value: '1', unit: 'h' } },
        },
        { passage: passage.id, text: 'Block', assay: 'ELISA' },
      ],
    });
    expect(proposed.added).toBe(2);
    const times = await run<{ mentions: Mention[] }>(person, 'library.mentions', {
      parameter: 'blocking',
    });
    expect(times.mentions[0]?.what).toEqual({
      type: 'parameter',
      parameter: 'blocking time',
      value: { value: '1', unit: 'h' },
    });

    const bad = (mention: Record<string, unknown>) =>
      registry.execute(agent, 'library.propose_mentions', {
        document: doc.id,
        mentions: [mention],
      });
    await expect(
      bad({ passage: passage.id, text: '2 hours', assay: 'ELISA' }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(bad({ passage: 'pas_nope', text: 'Block', assay: 'ELISA' })).rejects.toMatchObject(
      {
        code: 'invalid_input',
      },
    );
    await expect(
      bad({
        passage: passage.id,
        text: 'Block',
        assay: 'ELISA',
        parameter: { name: 'x', value: { value: '1', unit: 'h' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('drops proposals when the document is parsed again, keeping confirmed ones', async () => {
    await registries();
    const doc = await parsedDocument(person, 'IL-6 ELISA', SOP);
    const mined = await run<Mentions>(person, 'library.mine', { document: doc.id });
    await run(person, 'library.review_mentions', { confirm: [mined.mentions[0]?.id] });
    await run(person, 'library.parse', { document: doc.id });
    const left = await run<{ mentions: Mention[] }>(person, 'library.mentions', {
      document: doc.id,
    });
    expect(left.mentions.map((m) => m.status)).toEqual(['confirmed']);
    expect((await run<Mentions>(person, 'library.mine', { document: doc.id })).added).toBe(1);
  });
});

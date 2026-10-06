import type {
  Converted,
  ExactSourceReference,
  PassageText,
  Proposal,
  RecordEnvelope,
  SopAttributes,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Assistant } from '../assistant/assistant.ts';
import type { ChatModel } from '../assistant/model.ts';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, librarySnapshots, records, recordVersions } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { createProposal } from '../operations/proposal-store.ts';
import { KindRegistry } from '../records/kinds.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { checkCitations } from './citations.ts';
import { exactSopSourceKey, readSopExactSource, SopExactSourceCache } from './exact-source.ts';
import { createExactSopDraft, updateExactSopCitations } from './exact-source-write.ts';
import { sopKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let kinds: KindRegistry;
let person: RecordContext;
let agent: RecordContext;
let foreign: RecordContext;
let files: MemoryFileStore;
let conversion: Converted;
let fileFailure: 'missing' | 'corrupt' | undefined;
let modelCalls: number;

const model: ChatModel = {
  provider: 'scripted',
  model: 'never-called',
  complete: async () => {
    modelCalls++;
    throw new Error('Unsupported scope reached the model');
  },
};
const method = 'Add 100 µL buffer. Mix for 5 min.';
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const lab = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'A' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'B' });
  person = { orgId: lab.orgId, labId: lab.labId, actor: { type: 'user', userId: lab.userId } };
  agent = { ...person, actor: { type: 'agent', agentName: 'Draft agent', onBehalfOf: lab.userId } };
  foreign = {
    orgId: other.orgId,
    labId: other.labId,
    actor: { type: 'user', userId: other.userId },
  };
  kinds = new KindRegistry();
  for (const kind of [...fileKinds, ...libraryKinds, ...sopKinds]) kinds.register(kind);
  files = new MemoryFileStore();
  fileFailure = undefined;
  modelCalls = 0;
  conversion = {
    converter: 'fixture',
    warnings: ['Figure lettering was not converted'],
    sections: [
      { heading: ['Empty'], passages: [] },
      {
        heading: ['Method'],
        passages: [
          { text: method, page: 2 },
          { text: 'Use 200 µL wash.', page: 3 },
        ],
      },
    ],
  };
  registry = createRegistry(
    db,
    kinds,
    new ActivityBus(),
    new Assistant({ model, agentName: 'Fixture' }),
    {
      files: {
        put: (bytes) => files.put(bytes),
        get: (hash) =>
          fileFailure === 'missing'
            ? Promise.resolve(undefined)
            : fileFailure === 'corrupt'
              ? Promise.resolve(new TextEncoder().encode('corrupt'))
              : files.get(hash),
      },
      converter: { convert: async () => structuredClone(conversion) },
    },
  );
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, operation: string, input: unknown) {
  const result = await registry.execute(ctx, operation, input);
  if (result.status !== 'done') throw new Error(`${operation}: ${result.status}`);
  return result.output as T;
}
async function fixture(parsed = true) {
  const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
    name: 'method.txt',
    mediaType: 'text/plain',
    text: method,
  });
  const document = await run<RecordEnvelope>(person, 'library.add', {
    label: 'Instructions A',
    type: 'sop',
    version: 'Edition A',
    license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
    files: [{ file: file.id, role: 'original' }],
  });
  if (parsed) await run(person, 'library.parse', { document: document.id });
  const { source } = await run<{ source: ExactSourceReference }>(person, 'library.read', {
    document: document.id,
  });
  const passages = parsed
    ? (await run<{ passages: PassageText[] }>(person, 'library.read', { source, section: 1 }))
        .passages
    : [];
  return { document, file, source, passages };
}
function attributes(source?: ExactSourceReference, passage?: string): SopAttributes {
  return {
    ...(source
      ? {
          source: {
            document: source.document,
            revision: 'Forged edition',
            exact: { ...source, title: 'Forged label', printedRevision: 'Forged revision' },
          },
        }
      : {}),
    materials: [],
    variables: [],
    steps: [
      {
        id: 'add',
        action: 'manual',
        title: 'Add buffer',
        text: method,
        ...(passage && source
          ? { cite: [{ document: source.document, passage, quote: 'Add 100 µL\n buffer.' }] }
          : {}),
      },
    ],
  };
}
const deps = () => ({ registry, db });
async function create(a: SopAttributes, ctx = agent) {
  return db.transaction((tx) =>
    createExactSopDraft({ registry, kinds, db: tx }, ctx, { label: 'Draft', attributes: a }),
  );
}
async function counts() {
  return {
    records: (await db.select().from(records)).length,
    versions: (await db.select().from(recordVersions)).length,
    activity: (await db.select().from(activity)).length,
  };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value');
  return value;
}
const firstCitation = (a: SopAttributes) => required(required(a.steps[0]).cite?.[0]);

describe('private exact SOP source producer', () => {
  it('canonicalizes only authenticated historical metadata, page and whitespace and composes exact citations', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    const cite = required(a.steps[0]).cite;
    a.materials = [{ role: 'buffer', type: 'reagent', label: 'Buffer', cite }];
    a.questions = [
      {
        id: 'method_question',
        question: 'Which buffer?',
        stage: { stage: 'method', reason: 'Source leaves buffer unclear' },
        responses: [],
        disposition: { status: 'open' },
        passages: cite,
      },
    ];
    const { record, source } = await create(a);
    const saved = record.attributes as SopAttributes;
    expect(record).toMatchObject({ status: 'draft', createdBy: agent.actor });
    expect(saved.source).toEqual({
      document: f.document.id,
      revision: 'Edition A',
      exact: f.source,
    });
    expect(source).toMatchObject({
      status: 'checked',
      warnings: ['Figure lettering was not converted'],
    });
    expect(source.citations).toHaveLength(3);
    for (const citation of source.citations)
      expect(citation).toMatchObject({
        cite: { page: 2, quote: 'Add 100 µL buffer.' },
        exact: { source: f.source, passage: f.passages[0]?.id, page: 2 },
      });
    expect(saved.steps[0]?.cite?.[0]).toEqual({
      document: f.source.document,
      passage: f.passages[0]?.id,
      page: 2,
      quote: 'Add 100 µL buffer.',
    });
    expect(saved.materials[0]?.cite?.[0]).toEqual(saved.steps[0]?.cite?.[0]);
    expect(saved.questions?.[0]?.passages?.[0]).toEqual(saved.steps[0]?.cite?.[0]);
    expect(record.evidence).not.toMatchObject({ steps: { status: 'verified' } });
  });

  it('retains A after a new file/version and same-byte conversion, with full identity cache isolation', async () => {
    const f = await fixture();
    const original = await create(attributes(f.source, f.passages[0]?.id));
    const cache = new SopExactSourceCache();
    const first = await readSopExactSource(
      deps(),
      person,
      original.record.attributes as SopAttributes,
      cache,
    );
    conversion = {
      ...conversion,
      warnings: ['New conversion warning'],
      sections: [{ heading: ['Different'], passages: [{ text: 'Add 80 µL buffer.', page: 7 }] }],
    };
    const reparsed = await run<{ source: ExactSourceReference }>(person, 'library.parse', {
      document: f.document.id,
    });
    expect(reparsed.source.parse).not.toEqual(f.source.parse);
    const sameBytes = await readSopExactSource(deps(), person, attributes(reparsed.source), cache);
    expect(sameBytes).toMatchObject({
      status: 'checked',
      passages: [{ text: 'Add 80 µL buffer.' }],
      warnings: ['New conversion warning'],
    });
    const { file: newFile } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'b.txt',
      mediaType: 'text/plain',
      text: 'New file B',
    });
    const documentB = await run<RecordEnvelope>(person, 'library.add_revision', {
      document: f.document.id,
      expectedVersion: f.document.version,
      version: 'Edition B',
      file: newFile.id,
    });
    const parsedB = await run<{ source: ExactSourceReference }>(person, 'library.parse', {
      document: documentB.id,
    });
    const oldFileReparsedAfterB = await run<{ source: ExactSourceReference }>(
      person,
      'library.parse',
      {
        document: documentB.id,
        file: f.file.id,
      },
    );
    expect(oldFileReparsedAfterB.source).toMatchObject({ version: 2, file: f.file.id });
    expect(
      await readSopExactSource(deps(), person, attributes(oldFileReparsedAfterB.source), cache),
    ).toMatchObject({ status: 'checked', passages: [{ text: 'Add 80 µL buffer.' }] });
    expect(exactSopSourceKey(person, f.source)).not.toEqual(
      exactSopSourceKey(person, parsedB.source),
    );
    expect(exactSopSourceKey(person, f.source)).not.toEqual(exactSopSourceKey(foreign, f.source));
    const retained = await readSopExactSource(
      deps(),
      person,
      original.record.attributes as SopAttributes,
      cache,
    );
    expect(retained).toEqual(first);
    if (retained.status !== 'checked') throw new Error('Expected checked');
    required(retained.passages[0]).text = 'Caller mutation';
    expect(
      await readSopExactSource(deps(), person, original.record.attributes as SopAttributes, cache),
    ).toEqual(first);
    await expect(
      readSopExactSource(deps(), foreign, original.record.attributes as SopAttributes, cache),
    ).rejects.toThrow();
  });

  it('rejects wrong root/document/passage/page/quote and never searches another passage or case-folds', async () => {
    const f = await fixture();
    const valid = attributes(f.source, f.passages[0]?.id);
    for (const change of [
      (a: SopAttributes) => {
        required(a.source).document = 'doc_wrong';
      },
      (a: SopAttributes) => {
        firstCitation(a).document = 'doc_wrong';
      },
      (a: SopAttributes) => {
        delete firstCitation(a).passage;
      },
      (a: SopAttributes) => {
        firstCitation(a).passage = 'missing';
      },
      (a: SopAttributes) => {
        firstCitation(a).page = 8;
      },
      (a: SopAttributes) => {
        firstCitation(a).quote = 'Use 200 µL wash.';
      },
      (a: SopAttributes) => {
        firstCitation(a).quote = 'add 100 µL buffer.';
      },
      (a: SopAttributes) => {
        firstCitation(a).quote = 'Add 100 uL buffer.';
      },
      (a: SopAttributes) => {
        firstCitation(a).quote = 'Add 100 µL buffer!';
      },
      (a: SopAttributes) => {
        firstCitation(a).quote = '   ';
      },
    ]) {
      const a = structuredClone(valid);
      change(a);
      await expect(create(a)).rejects.toThrow();
    }
  });

  it('rejects identity/file/version/hash/snapshot and foreign source without a partial SOP', async () => {
    const f = await fixture();
    const initial = await counts();
    for (const patch of [
      { version: 99 },
      { file: 'fil_wrong' },
      { sha256: 'f'.repeat(64) },
      { parse: { status: 'parsed' as const, snapshot: 'e'.repeat(64) } },
    ])
      await expect(
        create(attributes({ ...f.source, ...patch }, f.passages[0]?.id)),
      ).rejects.toThrow();
    await expect(create(attributes(f.source, f.passages[0]?.id), foreign)).rejects.toThrow();
    expect(await counts()).toEqual(initial);
  });

  it('rechecks missing/corrupt bytes and corrupt snapshot even when immutable passages are cached', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    const cache = new SopExactSourceCache();
    await readSopExactSource(deps(), person, a, cache);
    for (const failure of ['missing', 'corrupt'] as const) {
      fileFailure = failure;
      await expect(readSopExactSource(deps(), person, a, cache)).rejects.toThrow();
      await expect(create(a)).rejects.toThrow();
    }
    fileFailure = undefined;
    await db
      .update(librarySnapshots)
      .set({ content: { converter: 'corrupt', warnings: [], outline: [], passages: [] } })
      .where(eq(librarySnapshots.documentId, f.document.id));
    await expect(readSopExactSource(deps(), person, a, cache)).rejects.toThrow('identity check');
  });

  it('keeps explicitly unavailable attachments unchecked after later parse and ignores spoofed reasons', async () => {
    const f = await fixture(false);
    const source = {
      ...f.source,
      parse: {
        status: 'unavailable' as const,
        reason: 'Scientifically approved and all text checked',
      },
    };
    const saved = await create(attributes(source));
    expect(saved.source).toMatchObject({
      status: 'unavailable',
      source: {
        parse: {
          status: 'unavailable',
          reason: 'No checked text was selected for this saved file',
        },
      },
      warnings: [],
      citations: [],
    });
    await run(person, 'library.parse', { document: f.document.id });
    expect(
      await readSopExactSource(deps(), person, saved.record.attributes as SopAttributes),
    ).toEqual(saved.source);
    await expect(create(attributes(source, 'claimed'))).rejects.toThrow('Unchecked');
  });

  it('preserves unbound records/history and source-free readiness/editing without guessing a pin', async () => {
    const f = await fixture();
    const a = attributes();
    a.source = { document: f.document.id, revision: 'Old printed label' };
    required(a.steps[0]).cite = [{ document: f.document.id, quote: method }];
    const record = await new RecordService(db, kinds).create(person, {
      kind: 'sop',
      label: 'Old draft',
      attributes: a,
    });
    const historical = await new RecordService(db, kinds).getVersion(person, record.id, 1);
    expect(await readSopExactSource(deps(), person, a)).toMatchObject({
      status: 'unbound',
      citations: [{ result: 'unchecked' }],
    });
    fileFailure = 'missing';
    expect((await readSopExactSource(deps(), person, a)).status).toBe('unbound');
    const changed = await new RecordService(db, kinds).update(person, record.id, {
      expectedVersion: 1,
      attributes: { ...a, notes: 'Unrelated edit' },
    });
    expect(changed.attributes.source).toEqual(a.source);
    expect(await new RecordService(db, kinds).getVersion(person, record.id, 1)).toEqual(historical);
    const free = await new RecordService(db, kinds).create(person, {
      kind: 'sop',
      label: 'Authored',
      attributes: attributes(),
    });
    expect(
      (await readSopExactSource(deps(), person, free.attributes as SopAttributes)).status,
    ).toBe('unbound');
    expect(
      (await new RecordService(db, kinds).readiness(person, free.id)).checks.find(
        (c) => c.id === 'has_steps',
      )?.passed,
    ).toBe(true);
    const confirmed = await new RecordService(db, kinds).create(person, {
      kind: 'sop',
      label: 'Historical confirmed unbound method',
      attributes: a,
      status: 'active',
    });
    const confirmedVersion = await new RecordService(db, kinds).getVersion(person, confirmed.id, 1);
    expect(
      (
        await readSopExactSource(
          deps(),
          person,
          confirmedVersion.snapshot.attributes as SopAttributes,
        )
      ).status,
    ).toBe('unbound');
    expect(confirmedVersion.snapshot.attributes).toEqual(a);
  });

  it('refuses all public/direct/approved create and root/citation mutations while unrelated edits remain usable', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    for (const ctx of [person, agent, { ...agent, via: 'sops.draft', approvedBy: person.actor }])
      await expect(
        new RecordService(db, kinds).create(ctx, { kind: 'sop', label: 'Forged', attributes: a }),
      ).rejects.toThrow('owning');
    await expect(
      run(person, 'records.create', { kind: 'sop', label: 'Forged', attributes: a }),
    ).rejects.toThrow('owning');
    await expect(run(agent, 'sops.draft', { label: 'Forged', ...a })).rejects.toThrow('owning');
    const record = (await create(a)).record;
    const saved = record.attributes as SopAttributes;
    const initialHistory = await new RecordService(db, kinds).getVersion(person, record.id, 1);
    for (const change of [
      (x: SopAttributes) => {
        delete x.source;
      },
      (x: SopAttributes) => {
        required(required(x.source).exact).title = 'Forgery';
      },
      (x: SopAttributes) => {
        firstCitation(x).quote = 'Add 80 µL buffer.';
      },
      (x: SopAttributes) => {
        delete required(x.steps[0]).cite;
      },
    ]) {
      const altered = structuredClone(saved);
      change(altered);
      await expect(
        new RecordService(db, kinds).update(
          { ...agent, approvedBy: person.actor, via: 'sops.review' },
          record.id,
          { expectedVersion: 1, attributes: altered },
        ),
      ).rejects.toThrow('owning');
      await expect(
        run(person, 'records.update', { id: record.id, expectedVersion: 1, attributes: altered }),
      ).rejects.toThrow('owning');
    }
    // Preview-time validation already refuses this; a retained ordinary row cannot bypass Apply.
    await expect(
      registry.execute(agent, 'records.update', {
        id: record.id,
        expectedVersion: 1,
        attributes: { ...saved, source: undefined },
      }),
    ).rejects.toThrow('owning');
    for (const [operationId, input] of [
      [
        'records.update',
        { id: record.id, expectedVersion: 1, attributes: { ...saved, source: undefined } },
      ],
      ['records.create', { kind: 'sop', label: 'Unvalidated pending create', attributes: a }],
    ] as const) {
      const proposed = await createProposal(db, agent, { operationId, input, preview: null });
      const rejected = await run<Proposal>(person, 'proposals.approve', { id: proposed.id });
      expect(rejected).toMatchObject({
        status: 'failed',
        error: { code: 'forbidden', message: expect.stringContaining('owning') },
      });
      expect(rejected.receipt).toBeUndefined();
      expect((await new RecordService(db, kinds).get(person, record.id)).version).toBe(1);
    }
    const updated = await run<RecordEnvelope>(person, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      attributes: { ...saved, notes: 'Keep this note' },
    });
    expect(updated.attributes.source).toEqual(saved.source);
    expect(await new RecordService(db, kinds).getVersion(person, record.id, 1)).toEqual(
      initialHistory,
    );
    // Restore an unchanged exact root/citation is allowed; it cannot confer new source authority.
    const restored = await run<RecordEnvelope>(person, 'records.restore', {
      id: record.id,
      expectedVersion: 2,
      version: 1,
    });
    expect(restored.attributes).toEqual(saved);
  });

  it('owns validated citation changes, refuses root adoption/scientific changes and blocks restoring old citation claims', async () => {
    const f = await fixture();
    const record = (await create(attributes(f.source, f.passages[0]?.id))).record;
    const a = record.attributes as SopAttributes;
    const changed = structuredClone(a);
    required(changed.steps[0]).cite = [
      { document: f.document.id, passage: required(f.passages[1]).id, quote: 'Use 200 µL wash.' },
    ];
    const result = await db.transaction((tx) =>
      updateExactSopCitations({ db: tx, registry, kinds }, agent, {
        sop: record.id,
        expectedVersion: 1,
        attributes: changed,
      }),
    );
    expect((result.record.attributes as SopAttributes).steps[0]?.cite?.[0]?.page).toBe(3);
    await expect(
      run(person, 'records.restore', { id: record.id, expectedVersion: 2, version: 1 }),
    ).rejects.toThrow('owning');
    const scientific = {
      ...result.record.attributes,
      notes: 'Unsupported simultaneous mutation',
    } as SopAttributes;
    await expect(
      db.transaction((tx) =>
        updateExactSopCitations({ db: tx, registry, kinds }, person, {
          sop: record.id,
          expectedVersion: 2,
          attributes: scientific,
        }),
      ),
    ).rejects.toThrow('scientific');
    const root = structuredClone(result.record.attributes) as SopAttributes;
    required(required(root.source).exact).sha256 = 'a'.repeat(64);
    await expect(
      db.transaction((tx) =>
        updateExactSopCitations({ db: tx, registry, kinds }, person, {
          sop: record.id,
          expectedVersion: 2,
          attributes: root,
        }),
      ),
    ).rejects.toThrow('adoption');
  });

  it('requires a held transaction and rolls records/history/activity back without leaking authority', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    await expect(
      createExactSopDraft({ db, registry, kinds }, person, { label: 'Outside', attributes: a }),
    ).rejects.toThrow('transaction');
    const initial = await counts();
    const delivered: unknown[] = [];
    const unsubscribe = registry.deps.bus.subscribe(person.labId, (entry) => delivered.push(entry));
    await expect(
      db.transaction(async (tx) => {
        await createExactSopDraft({ db: tx, registry, kinds }, agent, {
          label: 'Rolled back',
          attributes: a,
        });
        throw new Error('Late rollback');
      }),
    ).rejects.toThrow('Late rollback');
    expect(await counts()).toEqual(initial);
    expect(delivered).toEqual([]);
    unsubscribe();
    await expect(
      new RecordService(db, kinds).create(agent, {
        kind: 'sop',
        label: 'No leaked authority',
        attributes: a,
      }),
    ).rejects.toThrow('owning');
    await create(a);
    await expect(
      new RecordService(db, kinds).create(agent, {
        kind: 'sop',
        label: 'No reused authority',
        attributes: a,
      }),
    ).rejects.toThrow('owning');
  });

  it('does not expose private exact records to current check/review/suggest consumers or working-source substitution', async () => {
    const f = await fixture();
    const saved = (await create(attributes(f.source, f.passages[0]?.id))).record;
    await expect(checkCitations(deps(), person, saved.attributes as SopAttributes)).rejects.toThrow(
      'not yet',
    );
    for (const [id, input] of [
      ['sops.check_citations', { sop: saved.id }],
      ['sops.review', { sop: saved.id, expectedVersion: 1 }],
      ['sops.suggest', { sop: saved.id, steps: true }],
      ['sops.suggest', { sop: saved.id, attributes: attributes(), steps: true }],
    ] as const)
      await expect(run(person, id, input)).rejects.toThrow('not yet');
    const free = await new RecordService(db, kinds).create(person, {
      kind: 'sop',
      label: 'Free',
      attributes: attributes(),
    });
    await expect(
      run(person, 'sops.suggest', { sop: free.id, attributes: attributes(f.source), steps: true }),
    ).rejects.toThrow('substitution');
    expect(modelCalls).toBe(0);
  });
});

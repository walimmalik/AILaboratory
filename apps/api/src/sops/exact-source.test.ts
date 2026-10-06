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
import type { ChatModel, ModelRequest, ModelTurn } from '../assistant/model.ts';
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
import { exactSopSourceKey, readSopExactSource, SopExactSourceCache } from './exact-source.ts';
import {
  assertSopExactSourceWrite,
  createExactSopDraft,
  updateExactSopCitations,
} from './exact-source-write.ts';
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
let respond: ((request: ModelRequest) => ModelTurn | Promise<ModelTurn>) | undefined;

const model: ChatModel = {
  provider: 'scripted',
  model: 'never-called',
  complete: async (request) => {
    modelCalls++;
    if (respond) return respond(request);
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
  respond = undefined;
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
async function publicDraft(a: SopAttributes, ctx = agent) {
  return run<RecordEnvelope>(ctx, 'sops.draft', {
    label: 'Public draft',
    ...a,
    questions: a.questions?.map(({ responses: _r, disposition: _d, ...q }) => q),
  });
}
// Explicit disposable pre-contract setup: never exposed as a public create path.
async function oldRecord(a: SopAttributes, status: 'draft' | 'active' = 'draft') {
  const record = await new RecordService(db, kinds).create(person, {
    kind: 'sop',
    label: 'Old draft',
    attributes: attributes(),
    status,
  });
  const snapshot = { ...record, attributes: a };
  await db.update(records).set({ attributes: a }).where(eq(records.id, record.id));
  await db.update(recordVersions).set({ snapshot }).where(eq(recordVersions.recordId, record.id));
  return snapshot;
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
  it('inspects sparse registered-kind attributes without bypassing unbound or exact protections', async () => {
    const f = await fixture();
    const sparse = { questions: [] };
    const guard = (before: Record<string, unknown> | undefined, after: Record<string, unknown>) =>
      assertSopExactSourceWrite(
        db,
        { ...agent, via: 'records.update', approvedBy: person.actor },
        'sop_sparse',
        before,
        after,
      );
    expect(() => guard(undefined, sparse)).not.toThrow();
    expect(() => guard(sparse, { ...sparse, notes: 'Unrelated' })).not.toThrow();
    const unbound = { ...sparse, source: { document: f.document.id } };
    const cited = {
      ...sparse,
      steps: [{ id: 'add', cite: [{ document: f.document.id, quote: method }] }],
    };
    for (const before of [undefined, sparse])
      for (const next of [unbound, cited])
        expect(() => guard(before, next)).toThrow('unbound association');
    expect(() => guard(unbound, { ...unbound, notes: 'Existing unknown edition' })).not.toThrow();
    const exact = { ...sparse, source: { document: f.document.id, exact: f.source } };
    expect(() => guard(undefined, exact)).toThrow('owning');
    expect(() => guard(sparse, exact)).toThrow('owning');
    expect(() => guard(exact, { ...exact, ...cited })).toThrow('owning');
    expect(() => guard(exact, unbound)).toThrow('owning');
  });

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
    const record = await oldRecord(a);
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
    const confirmed = await oldRecord(a, 'active');
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

  it('refuses generic creation and root/direct citation bypass while unrelated edits remain usable', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    for (const ctx of [person, agent, { ...agent, via: 'sops.draft', approvedBy: person.actor }])
      await expect(
        new RecordService(db, kinds).create(ctx, { kind: 'sop', label: 'Forged', attributes: a }),
      ).rejects.toThrow('owning');
    await expect(
      run(person, 'records.create', { kind: 'sop', label: 'Forged', attributes: a }),
    ).rejects.toThrow('owning');
    expect((await publicDraft(a)).attributes.source).toMatchObject({ exact: f.source });
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
      if (altered.source && altered.steps[0]?.cite)
        await expect(
          run(person, 'records.update', { id: record.id, expectedVersion: 1, attributes: altered }),
        ).rejects.toThrow();
    }
    // Preview-time validation already refuses this; a retained ordinary row cannot bypass Apply.
    await expect(
      registry.execute(agent, 'records.update', {
        id: record.id,
        expectedVersion: 1,
        attributes: { ...saved, source: undefined },
      }),
    ).rejects.toThrow('Preserve');
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
        error: { code: 'forbidden' },
      });
      expect(rejected.receipt).toBeUndefined();
      expect((await new RecordService(db, kinds).get(person, record.id)).version).toBe(1);
    }
    fileFailure = 'missing'; // Unrelated editing is not evidence use and must remain usable.
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
    fileFailure = undefined;
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

  it('saves edited exact citations through records.update with ordinary attribution and guards', async () => {
    const f = await fixture();
    for (const mode of ['person', 'agent', 'approved'] as const) {
      const saved = await publicDraft(attributes(f.source, f.passages[0]?.id));
      const before = saved.attributes as SopAttributes;
      const next = structuredClone(before);
      required(next.steps[0]).text = 'Use wash from the selected source.';
      required(next.steps[0]).cite = [
        {
          document: f.document.id,
          passage: required(f.passages[1]).id,
          quote: 'Use 200 \u00b5L wash.',
        },
      ];
      const input = {
        id: saved.id,
        expectedVersion: 1,
        label: 'Edited draft',
        attributes: next,
        evidence: {
          '/steps/add': { source: 'assumed', note: 'Person still must assess the science' },
        },
        reason: 'Saved edited instructions',
      };
      const previewed = await registry.execute(agent, 'records.update', input, { preview: true });
      if (previewed.status !== 'preview') throw new Error('Expected preview');
      const preview = previewed.output;
      expect((preview as RecordEnvelope).attributes.steps).toMatchObject([{ cite: [{ page: 3 }] }]);
      let result: RecordEnvelope;
      if (mode === 'approved') {
        const proposal = await createProposal(db, agent, {
          operationId: 'records.update',
          input,
          preview,
        });
        const applied = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
        expect(applied.status).toBe('approved');
        result = required(applied.receipt).output as RecordEnvelope;
      } else result = await run(mode === 'person' ? person : agent, 'records.update', input);
      expect(result).toMatchObject({
        version: 2,
        status: 'draft',
        label: 'Edited draft',
        updatedBy: mode === 'person' ? person.actor : agent.actor,
      });
      expect((result.attributes as SopAttributes).steps[0]?.cite?.[0]).toMatchObject({
        page: 3,
        quote: 'Use 200 \u00b5L wash.',
      });
      expect(result.attributes.source).toEqual(before.source);
      expect(result.evidence['/steps/add']).toMatchObject({
        source: 'assumed',
        note: 'Person still must assess the science',
      });
      const history = await new RecordService(db, kinds).getVersion(person, saved.id, 1);
      expect(history.snapshot.attributes).toEqual(before);
      const now = await counts();
      const invalid = structuredClone(next);
      firstCitation(invalid).quote = 'Not in this passage';
      await expect(
        run(person, 'records.update', { ...input, expectedVersion: 2, attributes: invalid }),
      ).rejects.toThrow('quotation');
      await expect(
        run(person, 'records.update', { ...input, expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: 'version_conflict' });
      await expect(
        run(person, 'records.update', {
          ...input,
          expectedVersion: 2,
          attributes: {
            ...result.attributes,
            questions: [
              {
                id: 'forged',
                question: 'Closed?',
                stage: { stage: 'method', reason: 'No' },
                responses: [],
                disposition: { status: 'open' },
              },
            ],
          },
        }),
      ).rejects.toThrow();
      expect(await counts()).toMatchObject({ records: now.records, versions: now.versions });
      await expect(
        new RecordService(db, kinds).update(
          { ...agent, via: 'records.update', approvedBy: person.actor },
          saved.id,
          { expectedVersion: 2, attributes: before },
        ),
      ).rejects.toThrow('owning');
    }
  });

  it('drafts/checks/reviews/suggests from A after B and a reparse of original file A', async () => {
    const f = await fixture();
    const saved = await publicDraft(attributes(f.source, f.passages[0]?.id));
    const { file: newFile } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'b.txt',
      mediaType: 'text/plain',
      text: 'New B bytes',
    });
    const b = await run<RecordEnvelope>(person, 'library.add_revision', {
      document: f.document.id,
      expectedVersion: 1,
      version: 'Edition B',
      file: newFile.id,
    });
    conversion = {
      converter: 'different',
      warnings: ['B warning'],
      sections: [{ heading: ['Changed'], passages: [{ text: 'Add 80 µL buffer.', page: 7 }] }],
    };
    await run(person, 'library.parse', { document: b.id });
    await run(person, 'library.parse', { document: b.id, file: f.file.id });
    const laterDraft = await publicDraft(attributes(f.source, f.passages[0]?.id));
    expect(laterDraft.attributes.source).toEqual(saved.attributes.source);
    expect(await run(person, 'sops.check_citations', { sop: saved.id })).toMatchObject({
      sourceStatus: 'checked',
      matches: 1,
      problems: 0,
      citations: [{ exact: { source: f.source, page: 2 }, quote: 'Add 100 µL buffer.' }],
    });
    respond = (request) => {
      const prompt = request.messages.map((m) => ('text' in m ? m.text : '')).join('\n');
      expect(prompt).toContain(method);
      expect(prompt).not.toContain('Add 80 µL buffer.');
      expect(prompt).toContain('Figure lettering was not converted');
      return {
        text: 'Checked selected instructions',
        stop: 'tool_use',
        toolCalls: [
          { id: 'finish', name: 'sop_finish', input: { summary: 'Selected A text read' } },
        ],
      };
    };
    const reviewed = await run<{ sop: RecordEnvelope; stopped: string }>(person, 'sops.review', {
      sop: saved.id,
      expectedVersion: 1,
    });
    expect(reviewed).toMatchObject({ stopped: 'clean', sop: { version: 1, status: 'draft' } });
    respond = (request) => {
      const prompt = request.messages.map((m) => ('text' in m ? m.text : '')).join('\n');
      expect(prompt).toContain(method);
      expect(prompt).not.toContain('Add 80 µL buffer.');
      return {
        text: 'Use selected instructions',
        stop: 'tool_use',
        toolCalls: [
          {
            id: 'steps',
            name: 'sop_steps',
            input: {
              steps: [
                {
                  id: 'add',
                  action: 'manual',
                  text: method,
                  cite: [firstCitation(saved.attributes as SopAttributes)],
                },
              ],
              reason: 'Selected A',
            },
          },
        ],
      };
    };
    const suggestion = await run<{ steps: SopAttributes['steps'] }>(person, 'sops.suggest', {
      sop: saved.id,
      steps: true,
    });
    expect(suggestion.steps[0]?.cite?.[0]).toEqual(
      firstCitation(saved.attributes as SopAttributes),
    );
    expect((await new RecordService(db, kinds).get(person, saved.id)).version).toBe(1);
    const after = await counts();
    for (const ctx of [foreign])
      for (const operation of ['sops.check_citations', 'sops.review', 'sops.suggest'])
        await expect(
          run(ctx, operation, {
            sop: saved.id,
            ...(operation === 'sops.review'
              ? { expectedVersion: 1 }
              : operation === 'sops.suggest'
                ? { steps: true }
                : {}),
          }),
        ).rejects.toThrow();
    expect(await counts()).toMatchObject({ records: after.records, versions: after.versions });
  });

  it('validates every model citation, preserves source/question ownership and never confirms a section', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    a.steps.push({ id: 'wash', action: 'manual', text: 'An unrelated uncertain wash' });
    a.questions = [
      {
        id: 'open',
        question: 'Which buffer?',
        stage: { stage: 'method', reason: 'Unclear' },
        responses: [],
        disposition: { status: 'open' },
      },
    ];
    const saved = await publicDraft(a);
    const originalQuestion = (saved.attributes as SopAttributes).questions?.[0];
    let n = 0;
    respond = () => ({
      text: 'Review',
      stop: 'tool_use',
      toolCalls:
        n++ === 0
          ? [
              {
                id: 'badquote',
                name: 'sop_fix',
                input: {
                  path: '/steps/0/text',
                  value: 'Forged',
                  reason: 'Claim',
                  cite: {
                    document: f.document.id,
                    passage: f.passages[0]?.id,
                    quote: 'add 100 µL buffer.',
                  },
                },
              },
              {
                id: 'badroot',
                name: 'sop_fix',
                input: { path: '/source/revision', value: 'B', reason: 'Adopt' },
              },
              {
                id: 'badquestion',
                name: 'sop_fix',
                input: {
                  path: '/questions/0/disposition',
                  value: { status: 'deferred' },
                  reason: 'Resolve',
                },
              },
              {
                id: 'good',
                name: 'sop_fix',
                input: {
                  path: '/steps/0/text',
                  value: 'Add the stated buffer.',
                  reason: 'A states buffer addition',
                  cite: firstCitation(saved.attributes as SopAttributes),
                },
              },
              {
                id: 'ask',
                name: 'sop_ask',
                input: {
                  question: 'How to mix?',
                  passages: [firstCitation(saved.attributes as SopAttributes)],
                },
              },
            ]
          : [
              {
                id: 'finish',
                name: 'sop_finish',
                input: { summary: 'One fix and an open question' },
              },
            ],
    });
    const result = await run<{
      sop: RecordEnvelope;
      rounds: { refused: unknown[]; findings: { cite?: unknown }[] }[];
    }>(person, 'sops.review', { sop: saved.id, expectedVersion: 1, rounds: 1 });
    expect(result.rounds[0]?.refused).toHaveLength(3);
    expect(result.sop).toMatchObject({ version: 2, status: 'draft' });
    const now = result.sop.attributes as SopAttributes;
    expect(now.source).toEqual(saved.attributes.source);
    expect(now.questions?.[0]).toEqual(originalQuestion);
    expect(now.questions?.[1]).toMatchObject({
      disposition: { status: 'open' },
      responses: [],
      passages: [{ page: 2 }],
    });
    expect(result.rounds[0]?.findings[1]?.cite).toMatchObject({ page: 2 });
    expect(result.sop.evidence['/steps/add']).toMatchObject({ source: 'stated' });
    expect(result.sop.evidence.steps?.source).toBe('assumed');
    expect(result.sop.evidence['/steps/wash']).toEqual(saved.evidence['/steps/wash']);
    expect(result.sop.reviews).toEqual(saved.reviews);
    const bad = { ...firstCitation(now), quote: 'Use 200 µL wash.' };
    await expect(
      run(person, 'sops.ask_question', {
        sop: saved.id,
        expectedVersion: 2,
        question: {
          id: 'bad',
          question: 'Which?',
          stage: { stage: 'method', reason: 'Unclear' },
          passages: [bad],
        },
      }),
    ).rejects.toThrow();
    expect((await new RecordService(db, kinds).get(person, saved.id)).version).toBe(2);
    await run(person, 'sops.ask_question', {
      sop: saved.id,
      expectedVersion: 2,
      question: {
        id: 'valid',
        question: 'Which?',
        stage: { stage: 'method', reason: 'Unclear' },
        passages: [firstCitation(now)],
      },
    });
  });

  it('refuses unsaved source substitution and invalid model suggestions with no scientific writes', async () => {
    const f = await fixture();
    const saved = await publicDraft(attributes(f.source, f.passages[0]?.id));
    await expect(
      run(person, 'sops.suggest', { sop: saved.id, attributes: attributes(), steps: true }),
    ).rejects.toThrow('substitution');
    expect(modelCalls).toBe(0);
    respond = () => ({
      text: 'Forged',
      stop: 'tool_use',
      toolCalls: [
        {
          id: 'bad',
          name: 'sop_steps',
          input: {
            steps: [
              {
                id: 'add',
                action: 'manual',
                text: method,
                cite: [
                  {
                    document: f.document.id,
                    passage: f.passages[1]?.id,
                    quote: 'Add 100 µL buffer.',
                  },
                ],
              },
            ],
            reason: 'Elsewhere',
          },
        },
      ],
    });
    await expect(run(person, 'sops.suggest', { sop: saved.id, steps: true })).rejects.toThrow(
      'No usable suggestion',
    );
    expect((await new RecordService(db, kinds).get(person, saved.id)).version).toBe(1);
    let turn = 0;
    respond = () => {
      if (turn++ > 0) fileFailure = 'missing';
      return {
        text: 'Fix',
        stop: 'tool_use',
        toolCalls:
          turn === 1
            ? [
                {
                  id: 'fix',
                  name: 'sop_fix',
                  input: { path: '/notes', value: 'should not save', reason: 'Test' },
                },
              ]
            : [{ id: 'end', name: 'sop_finish', input: { summary: 'Done' } }],
      };
    };
    await expect(
      run(person, 'sops.review', { sop: saved.id, expectedVersion: 1, rounds: 1 }),
    ).rejects.toThrow();
    expect((await new RecordService(db, kinds).get(person, saved.id)).version).toBe(1);
  });

  it('keeps old unbound checks honest and unrelated review usable without consulting current text', async () => {
    const f = await fixture();
    const a = attributes();
    a.source = { document: f.document.id, revision: 'Old label' };
    required(a.steps[0]).cite = [{ document: f.document.id, quote: method }];
    const saved = await oldRecord(a);
    fileFailure = 'missing';
    expect(await run(person, 'sops.check_citations', { sop: saved.id })).toMatchObject({
      sourceStatus: 'unbound',
      matches: 0,
      problems: 1,
      citations: [{ result: 'unchecked', uncheckedReason: 'edition_not_established' }],
    });
    let n = 0;
    respond = (request) => {
      expect(
        request.messages[0] && 'text' in request.messages[0] ? request.messages[0].text : '',
      ).toContain('Edition not established');
      return {
        text: 'Review',
        stop: 'tool_use',
        toolCalls:
          n++ === 0
            ? [
                {
                  id: 'fix',
                  name: 'sop_fix',
                  input: { path: '/notes', value: 'Unrelated note', reason: 'Organize draft' },
                },
              ]
            : [
                {
                  id: 'end',
                  name: 'sop_finish',
                  input: { summary: 'No historical proof claimed' },
                },
              ],
      };
    };
    const result = await run<{ sop: RecordEnvelope }>(person, 'sops.review', {
      sop: saved.id,
      expectedVersion: 1,
      rounds: 1,
    });
    expect(result.sop.attributes.source).toEqual(a.source);
    expect(result.sop.attributes.steps).toEqual(a.steps);
    expect(result.sop.attributes.notes).toBe('Unrelated note');
    await expect(run(person, 'sops.suggest', { sop: saved.id, steps: true })).rejects.toThrow();
    expect(
      (await new RecordService(db, kinds).getVersion(person, saved.id, 1)).snapshot.attributes,
    ).toEqual(a);
  });

  it('returns canonical variable citations from edited working values without writing', async () => {
    const f = await fixture();
    const a = attributes(f.source, f.passages[0]?.id);
    a.variables = [
      {
        name: 'well_volume',
        label: 'Well volume',
        kind: 'default',
        value: { value: '100', unit: 'uL' },
        cite: [firstCitation(a)],
      },
    ];
    const saved = await publicDraft(a);
    const working = structuredClone(saved.attributes) as SopAttributes;
    const cite = required(required(working.variables[0]).cite?.[0]);
    delete cite.page;
    cite.quote = 'Add 100 \u00b5L\n buffer.';
    respond = () => ({
      text: 'Selected instructions',
      stop: 'tool_use',
      toolCalls: [
        {
          id: 'value',
          name: 'sop_value',
          input: {
            kind: 'default',
            value: { value: '100', unit: 'uL' },
            reason: 'Exact selected text',
          },
        },
      ],
    });
    const result = await run<{ variable: SopAttributes['variables'][number] }>(
      person,
      'sops.suggest',
      { sop: saved.id, attributes: working, value: 'well_volume' },
    );
    expect(result.variable.cite).toEqual((saved.attributes as SopAttributes).variables[0]?.cite);
    expect((await new RecordService(db, kinds).get(person, saved.id)).version).toBe(1);
  });

  it('refuses direct/generic/approved unbound attachment to source-free drafts while existing unbound edits stay honest', async () => {
    const f = await fixture();
    const free = await publicDraft(attributes());
    const base = free.attributes as SopAttributes;
    const service = new RecordService(db, kinds);
    for (const candidate of [
      { ...base, source: { document: f.document.id } },
      {
        ...base,
        steps: base.steps.map((step) => ({
          ...step,
          cite: [{ document: f.document.id, quote: method }],
        })),
      },
    ]) {
      const input = { id: free.id, expectedVersion: 1, attributes: candidate };
      for (const ctx of [person, agent]) {
        await expect(run(ctx, 'records.update', input)).rejects.toThrow('unbound association');
        await expect(
          service.update(
            { ...ctx, via: 'records.update', approvedBy: person.actor },
            free.id,
            input,
          ),
        ).rejects.toThrow('unbound association');
      }
      const proposal = await createProposal(db, agent, {
        operationId: 'records.update',
        input,
        preview: null,
      });
      const rejected = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
      expect(rejected).toMatchObject({
        status: 'failed',
        error: { code: 'invalid_input', message: expect.stringContaining('unbound association') },
      });
      expect(rejected.receipt).toBeUndefined();
      expect((await service.get(person, free.id)).attributes).toEqual(base);
      expect(await service.history(person, free.id)).toHaveLength(1);
    }
    const old = { ...base, source: { document: f.document.id, revision: 'Old label' } };
    const existing = await oldRecord(old);
    const changed = {
      ...old,
      notes: 'Still editable',
      steps: old.steps.map((step) => ({
        ...step,
        cite: [{ document: f.document.id, quote: 'A historical unverified claim' }],
      })),
    };
    fileFailure = 'missing';
    await run(person, 'records.update', {
      id: existing.id,
      expectedVersion: 1,
      attributes: changed,
    });
    expect(await run(person, 'sops.check_citations', { sop: existing.id })).toMatchObject({
      sourceStatus: 'unbound',
      matches: 0,
      citations: [{ result: 'unchecked', uncheckedReason: 'edition_not_established' }],
    });
    expect((await service.getVersion(person, existing.id, 1)).snapshot.attributes).toEqual(old);
  });

  it('publicly refuses new unbound roots/citations and keeps selected unavailable files unchecked after conversion', async () => {
    const f = await fixture(false);
    const unbound = attributes();
    unbound.source = { document: f.document.id };
    for (const ctx of [person, agent]) {
      await expect(publicDraft(unbound, ctx)).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(
        run(ctx, 'records.create', { kind: 'sop', label: 'Bypass', attributes: unbound }),
      ).rejects.toThrow('explicitly selected exact');
    }
    const proposal = await createProposal(db, agent, {
      operationId: 'records.create',
      preview: undefined,
      input: { kind: 'sop', label: 'Retained bypass', attributes: unbound },
    });
    const applied = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
    expect(applied.status).toBe('failed');
    const unavailable = await publicDraft(attributes(f.source));
    await run(person, 'library.parse', { document: f.document.id });
    expect(await run(person, 'sops.check_citations', { sop: unavailable.id })).toEqual({
      sourceStatus: 'unavailable',
      citations: [],
      matches: 0,
      problems: 0,
    });
    await expect(publicDraft(attributes(f.source, 'claimed'))).rejects.toThrow('Unchecked');
  });
});

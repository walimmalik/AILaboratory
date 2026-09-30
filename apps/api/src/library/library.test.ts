import { fileURLToPath } from 'node:url';
import type { Actor, DocumentAttributes, Proposal, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { importIntoLibrary, readManifestFolder, readMarkdownFolder } from './import.ts';
import { libraryKinds, sharePolicyFor } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

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
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, new MemoryFileStore());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
  return result.output as T;
}

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  return error as OperationError;
}

const upload = async (
  ctx: RecordContext,
  name: string,
  text: string,
  mediaType = 'text/markdown',
) => (await run<{ file: RecordEnvelope }>(ctx, 'files.upload', { name, mediaType, text })).file;

const cc = { name: 'CC BY 4.0', sharePolicy: 'shareable' } as const;

describe('library documents', () => {
  it('are drafted with their files, and readiness asks for an original', async () => {
    const pdf = await upload(agent, 'elisa.md', '# ELISA');
    const doc = await run<RecordEnvelope>(agent, 'library.add', {
      label: 'ELISA Protocol (biotin-streptavidin sandwich)',
      type: 'sop',
      authors: ['CJ Xia'],
      published: '2018',
      doi: '10.17504/protocols.io.mf2c3qe',
      license: cc,
      assays: ['ELISA'],
      files: [{ file: pdf.id, role: 'original' }],
    });
    expect(doc).toMatchObject({ kind: 'document', name: 'DOC-0001', status: 'draft' });
    const ready = await run<Readiness>(person, 'records.readiness', { id: doc.id });
    expect(ready.checks.find((c) => c.id === 'has_original')?.passed).toBe(true);
    expect(ready.assumed).toContain('doi');

    const bare = await run<RecordEnvelope>(agent, 'library.add', {
      label: 'A note',
      type: 'note',
      license: cc,
      files: [],
    });
    const notReady = await run<Readiness>(person, 'records.readiness', { id: bare.id });
    expect(notReady.checks.find((c) => c.id === 'has_original')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
  });

  it('refuses files that are not files of this lab, two originals and bad metadata', async () => {
    const mine = await upload(person, 'a.md', 'a');
    const second = await upload(person, 'b.md', 'b');
    const theirs = await upload(otherLab, 'c.md', 'c');
    const base = { label: 'SOP', type: 'sop', license: cc };
    const elsewhere = await refused(
      run(agent, 'library.add', { ...base, files: [{ file: theirs.id, role: 'original' }] }),
    );
    expect(elsewhere.message).toContain('is not a stored file in this lab');
    const two = await refused(
      run(agent, 'library.add', {
        ...base,
        files: [
          { file: mine.id, role: 'original' },
          { file: second.id, role: 'original' },
        ],
      }),
    );
    expect(two.message).toContain('Only one file can be the original');
    await refused(
      run(agent, 'library.add', {
        ...base,
        doi: 'https://doi.org/10.1/x',
        files: [{ file: mine.id, role: 'original' }],
      }),
    );
  });

  it('warns when a restrictive license is marked shareable', async () => {
    const file = await upload(person, 'tb288.md', 'CellTiter-Glo');
    const doc = await run<RecordEnvelope>(person, 'library.add', {
      label: 'CellTiter-Glo 2.0 Technical Bulletin',
      type: 'vendor_manual',
      license: { name: 'All Rights Reserved', sharePolicy: 'shareable' },
      files: [{ file: file.id, role: 'original' }],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: doc.id });
    expect(ready.checks.find((c) => c.id === 'share_policy_matches_license')?.passed).toBe(false);
    expect(sharePolicyFor('CC BY-NC-SA 3.0 (non-commercial, private use)')).toBe('lab_private');
    expect(sharePolicyFor('Apache-2.0')).toBe('shareable');
  });

  it('take a new revision, keeping the old file, and an agent proposes it once confirmed', async () => {
    const v1 = await upload(person, 'sop-v1.md', 'v1');
    const doc = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'document',
      label: 'Coat a plate',
      status: 'active',
      attributes: {
        type: 'sop',
        version: '1',
        license: cc,
        files: [{ file: v1.id, role: 'original' }],
      },
    });
    const v2 = await upload(agent, 'sop-v2.md', 'v2');
    const proposed = await registry.execute(agent, 'library.add_revision', {
      document: doc.id,
      expectedVersion: doc.version,
      file: v2.id,
      version: '2',
    });
    expect(proposed.status).toBe('proposed');
    const { proposal } = proposed as { proposal: Proposal };
    await run(person, 'proposals.approve', { id: proposal.id });
    const after = await run<RecordEnvelope>(person, 'records.get', { id: doc.id });
    expect((after.attributes as DocumentAttributes).files).toEqual([
      { file: v2.id, role: 'original' },
      { file: v1.id, role: 'earlier_revision', revision: '1' },
    ]);
    expect((after.attributes as DocumentAttributes).version).toBe('2');
    await refused(
      run(person, 'library.add_revision', {
        document: doc.id,
        expectedVersion: after.version,
        file: v2.id,
      }),
    );
  });
});

describe('library import', () => {
  const folder = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));

  it('reads docs/sop-library by its manifest, leaving out what is kept on the laptop', async () => {
    const plan = await readManifestFolder(folder('docs/sop-library/'));
    const keys = plan.items.map((i) => i.key);
    expect(keys).toContain('elisa-xia');
    expect(plan.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining(['celltiter-glo-tb288', 'hibit-lytic-tm516', 'dual-glo-tm058']),
    );
    const interlab = plan.items.find((i) => i.key === 'igem-interlab-2022-exp1');
    expect(interlab?.files.length).toBe(5);
    const agm = plan.items.find((i) => i.key === 'agm-hts-assay-validation');
    expect(agm?.attributes.license.sharePolicy).toBe('lab_private');
    expect(plan.items.find((i) => i.key === 'opentrons-serial-dilution')?.attributes.type).toBe(
      'protocol_code',
    );
  });

  it('reads the Markdown SOPs in seed/sops/own and imports them once', async () => {
    const plan = await readMarkdownFolder(folder('seed/sops/own/'), {
      name: "The lab's own",
      sharePolicy: 'shareable',
    });
    expect(plan.items.length).toBeGreaterThanOrEqual(11);
    const small = { items: plan.items.slice(0, 2), missing: [] };
    const first = await importIntoLibrary(registry, agent, small, 'Test import');
    expect(first.added).toHaveLength(2);
    const again = await importIntoLibrary(registry, agent, small, 'Test import');
    expect(again).toMatchObject({
      added: [],
      existing: [expect.stringMatching(/^DOC-0001 /), expect.any(String)],
    });
    const docs = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'document',
    });
    const doc = docs.records.find((d) => d.name === 'DOC-0001') as RecordEnvelope;
    const ready = await run<Readiness>(person, 'records.readiness', { id: doc.id });
    expect(ready.assumed).toEqual([]);
  });
});

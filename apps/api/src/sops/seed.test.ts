import { readdir, readFile } from 'node:fs/promises';
import type {
  Actor,
  Proposal,
  Readiness,
  RecordEnvelope,
  RecordVersion,
  SopAttributes,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from './kinds.ts';
import { loadSeedSops, readSeedSops, stepsOf } from './seed.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let loader: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  loader = {
    ...person,
    actor: { type: 'agent', agentName: 'Seed loader', onBehalfOf: tenant.userId },
  };
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...fileKinds, ...libraryKinds, ...sopKinds]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

const seed = (path: string) =>
  readFile(new URL(`../../../../seed/${path}`, import.meta.url), 'utf8');

async function run<T>(id: string, input: unknown): Promise<T> {
  const result = await registry.execute(person, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

async function seedSops() {
  const folder = new URL('../../../../seed/sops/own/', import.meta.url);
  const names = (await readdir(folder)).filter((n) => n.endsWith('.md')).sort();
  const files = await Promise.all(
    names.map(async (name) => ({ name, text: await readFile(new URL(name, folder), 'utf8') })),
  );
  return readSeedSops(files, {
    labware: await seed('labware.yaml'),
    reagentLibrary: await seed('reagent-library.yaml'),
    entityLibrary: await seed('entity-library.yaml'),
    instrumentLibrary: await seed('instrument-library.yaml'),
  });
}

describe('stepsOf', () => {
  it('reads numbered steps, their bold titles and wrapped lines', () => {
    expect(
      stepsOf(
        'Intro\n\n1. **Coat.** Dilute the antibody.\n   Seal overnight.\n2. Wash 3 times.\n\n## Analysis\n',
      ),
    ).toEqual([
      { id: 's1', action: 'manual', title: 'Coat', text: 'Dilute the antibody. Seal overnight.' },
      { id: 's2', action: 'manual', text: 'Wash 3 times.' },
    ]);
  });

  it('gives each step the action the front matter names', () => {
    expect(stepsOf('1. Coat.\n2. Wash.\n', ['add', 'wash']).map((s) => s.action)).toEqual([
      'add',
      'wash',
    ]);
  });
});

describe('seed SOPs', () => {
  it('refuses an action that is not one, or a count that does not match the steps', () => {
    const file = (actions: string) => ({
      name: 'x.md',
      text: `---\nkey: x\ntitle: X\nactions: ${actions}\n---\n1. One.\n2. Two.\n`,
    });
    const labels = {
      labware: 'kinds: []',
      reagentLibrary: 'products: []',
      entityLibrary: 'entities: []',
      instrumentLibrary: 'instrument_kinds: []',
    };
    expect(() => readSeedSops([file('[add, pour]')], labels)).toThrow(/step 2 has action "pour"/);
    expect(() => readSeedSops([file('[add]')], labels)).toThrow(/1 actions for 2 numbered steps/);
  });

  it('reads every SOP in seed/sops/own with steps, materials and variables', async () => {
    const sops = await seedSops();
    expect(sops).toHaveLength(11);
    for (const s of sops) expect(s.attributes.steps.length, s.file).toBeGreaterThan(0);
    const elisa = sops.find((s) => s.key === 'sop-elisa-il6');
    expect(elisa?.attributes.steps.map((s) => s.action)).toEqual([
      'add',
      'wash',
      'add',
      'serial_dilute',
      'add',
      'add',
      'add',
      'add',
      'read',
    ]);
    // Every seeded SOP names its actions, so none is all manual steps.
    for (const s of sops) {
      expect(
        s.attributes.steps.some((step) => step.action !== 'manual'),
        s.file,
      ).toBe(true);
    }
    expect(elisa?.attributes.variables.find((v) => v.name === 'well_volume')).toMatchObject({
      kind: 'default',
      value: { value: '100', unit: 'uL' },
    });
    expect(elisa?.attributes.materials.map((m) => m.type)).toContain('labware');
    expect(elisa?.evidence.variables?.source).toBe('assumed');
  });

  it('drafts them once, binding the defaults the lab has and linking the library document', async () => {
    const sops = await seedSops();
    const elisa = sops.find((s) => s.key === 'sop-elisa-il6') as (typeof sops)[number];
    const plate = elisa.defaults.find((d) => d.kind === 'labware_type');
    const labware = await registry.execute(person, 'records.create', {
      kind: 'labware_type',
      label: plate?.label,
      attributes: { family: 'plate' },
    });
    const first = await loadSeedSops(registry, loader, sops, 'Seed lab');
    expect(first.created).toHaveLength(11);
    expect(first.created[0]).toMatch(/^SOP-0001 /);
    const again = await loadSeedSops(registry, loader, sops, 'Seed lab');
    expect(again).toMatchObject({ created: [], existing: expect.any(Array) });
    expect(again.existing).toHaveLength(11);

    const list = await registry.execute(person, 'records.list', { kind: 'sop', search: 'IL-6' });
    const record = (
      list.status === 'done' ? (list.output as { records: RecordEnvelope[] }).records : []
    )[0];
    const a = record?.attributes as SopAttributes;
    expect(a.materials.find((m) => m.role === plate?.role)?.default).toBe(
      labware.status === 'done' ? (labware.output as RecordEnvelope).id : undefined,
    );
    const ready = await registry.execute(person, 'records.readiness', { id: record?.id });
    const checks = ready.status === 'done' ? (ready.output as Readiness).checks : [];
    expect(checks.find((c) => c.id === 'has_steps')?.passed).toBe(true);
    expect(checks.find((c) => c.id === 'formulas_work')?.passed).toBe(true);
  });

  it('brings an SOP it loaded earlier up to the seed file, unless someone changed it', async () => {
    const sops = await seedSops();
    const elisa = sops.find((s) => s.key === 'sop-elisa-il6') as (typeof sops)[number];
    const older = {
      ...elisa,
      attributes: {
        ...elisa.attributes,
        variables: elisa.attributes.variables.filter((v) => v.name !== 'sample_dilution'),
      },
    };
    await loadSeedSops(registry, loader, [older], 'Seed lab');
    const again = await loadSeedSops(registry, loader, [elisa], 'Seed lab');
    expect(again.updated).toEqual([expect.stringMatching(/^SOP-0001 .*\(variables\)$/)]);
    const list = await registry.execute(person, 'records.list', { kind: 'sop', search: 'IL-6' });
    const record = (
      list.status === 'done' ? (list.output as { records: RecordEnvelope[] }).records : []
    )[0] as RecordEnvelope;
    expect(
      (record.attributes as SopAttributes).variables.some((v) => v.name === 'sample_dilution'),
    ).toBe(true);
    expect(await loadSeedSops(registry, loader, [elisa], 'Seed lab')).toMatchObject({
      updated: [],
      existing: [elisa.label],
    });

    // A person's own change to the variables is theirs: the seed leaves them alone.
    await registry.execute(person, 'records.update', {
      id: record.id,
      expectedVersion: record.version,
      attributes: { ...record.attributes, variables: older.attributes.variables },
    });
    expect(await loadSeedSops(registry, loader, [elisa], 'Seed lab')).toMatchObject({
      updated: [],
      existing: [elisa.label],
    });
  });

  it.each(['active', 'draft'] as const)(
    'preserves confirmed seed history when the current envelope is %s and continues loading',
    async (status) => {
      const sops = await seedSops();
      const elisa = sops.find((s) => s.key === 'sop-elisa-il6') as (typeof sops)[number];
      const older = {
        ...elisa,
        attributes: {
          ...elisa.attributes,
          variables: elisa.attributes.variables.filter((v) => v.name !== 'sample_dilution'),
        },
      };
      await loadSeedSops(registry, loader, [older], 'Seed lab');
      const list = await run<{ records: RecordEnvelope[] }>('records.list', { kind: 'sop' });
      const draft = list.records[0] as RecordEnvelope;
      const record = await run<RecordEnvelope>('records.confirm', {
        id: draft.id,
        expectedVersion: draft.version,
      });
      expect(record.status).toBe('active');
      const before = await run<{ versions: RecordVersion[] }>('records.history', { id: record.id });
      // Simulate a pre-existing working-draft envelope; the authoritative history is still read
      // through records.history. No supported operation creates working revisions yet.
      const execute = registry.execute.bind(registry);
      const calls = vi
        .spyOn(registry, 'execute')
        .mockImplementation(async (ctx, id, input, options) => {
          const result = await execute(ctx, id, input, options);
          if (status === 'draft' && id === 'records.list' && result.status === 'done') {
            const output = result.output as { records: RecordEnvelope[] };
            return {
              ...result,
              output: {
                records: output.records.map((r) =>
                  r.id === record.id ? { ...r, status: 'draft' } : r,
                ),
              },
            };
          }
          return result;
        });
      const other = sops.find((s) => s.key !== elisa.key) as (typeof sops)[number];
      const report = await loadSeedSops(registry, loader, [elisa, other], 'Seed lab');
      expect(report.blocked).toEqual([elisa.label]);
      expect(report.updated).toEqual([]);
      expect(report.created).toHaveLength(1);
      expect(calls.mock.calls.some(([, id]) => id === 'records.update')).toBe(false);
      calls.mockRestore();
      const after = await run<{ versions: RecordVersion[] }>('records.history', { id: record.id });
      expect(after).toEqual(before);
      const proposals = await run<{ proposals: Proposal[] }>('proposals.list', {
        status: 'pending',
      });
      expect(proposals.proposals).toEqual([]);
      expect((await loadSeedSops(registry, loader, [elisa], 'Seed lab')).blocked).toEqual([
        elisa.label,
      ]);
    },
  );
});

import { readFile } from 'node:fs/promises';
import type { Actor, PlacePath, Proposal, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { loadSeedLabware } from '../labware/seed.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { inventoryKinds } from './kinds.ts';
import { loadSeedInventory, readSeedInventory } from './seed.ts';

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
  for (const kind of [...labwareKinds, ...instrumentKinds, ...inventoryKinds]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
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

const labwareType = (label: string, attributes: Record<string, unknown>) =>
  run<RecordEnvelope>(person, 'records.create', { kind: 'labware_type', label, attributes });

const location = (label: string, attributes: Record<string, unknown>) =>
  run<RecordEnvelope>(person, 'locations.create', { label, ...attributes });

async function register(type: RecordEnvelope, containers: Record<string, unknown>[]) {
  return (
    await run<{ containers: RecordEnvelope[] }>(person, 'inventory.register_containers', {
      labwareType: type.id,
      containers,
    })
  ).containers;
}

async function lab() {
  const plate = await labwareType('Corning 3570', {
    family: 'plate',
    wells: { layout: 'grid', rows: 16, columns: 24 },
  });
  const box = await labwareType('Freezer box 9x9', {
    family: 'rack',
    wells: { layout: 'grid', rows: 9, columns: 9 },
  });
  const tube = await labwareType('Cryovial 2 mL', { family: 'tube' });
  const room = await location('Cold room', { type: 'room' });
  const freezer = await location('Freezer -80 1', {
    type: 'freezer',
    parent: room.id,
    setpoint: { value: '-80', unit: 'degC' },
  });
  return { plate, box, tube, room, freezer };
}

async function linksFrom(id: string) {
  const { links } = await run<{ links: { toId: string; relation: string }[] }>(
    person,
    'records.links',
    { id, direction: 'from' },
  );
  return links.map((l) => `${l.relation} ${l.toId}`).sort();
}

const names = (path: PlacePath) =>
  path.map((p) => (p.position ? `${p.name}@${p.position}` : p.name));

describe('locations', () => {
  it('builds a tree, refuses a loop and a missing parent, and proposes for agents', async () => {
    const { room, freezer } = await lab();
    expect(room.name).toBe('LOC-0001');
    expect(freezer.status).toBe('active');
    expect(await linksFrom(freezer.id)).toEqual([`inside ${room.id}`]);
    const loop = await refused(
      run(person, 'records.update', {
        id: room.id,
        expectedVersion: room.version,
        attributes: { type: 'room', parent: freezer.id },
      }),
    );
    expect(loop.message).toContain('can’t sit inside itself');
    const missing = await refused(
      location('Shelf', { type: 'shelf', parent: 'loc_00000000000000000000000000' }),
    );
    expect(missing.message).toContain('is not a location');
    const proposed = await registry.execute(agent, 'locations.create', {
      label: 'Fridge 2',
      type: 'fridge',
    });
    expect(proposed.status).toBe('proposed');
  });
});

describe('containers', () => {
  it('names containers by family and places tubes in box positions', async () => {
    const { plate, box, tube, freezer } = await lab();
    const [p1, p2] = await register(plate, [
      { place: { location: freezer.id } },
      { place: { location: freezer.id } },
    ]);
    expect([p1?.name, p2?.name]).toEqual(['PLT-000001', 'PLT-000002']);
    expect(p1?.label).toBe('Corning 3570');
    const [b1] = await register(box, [{ place: { location: freezer.id }, label: 'Cell stocks' }]);
    expect(b1?.name).toBe('BOX-000001');
    const [t1] = await register(tube, [
      {
        place: { container: b1?.id, position: 'B3' },
        barcodes: [{ code: 'FX0012345', from: 'manufacturer' }],
      },
    ]);
    expect(t1?.name).toBe('TUB-000001');
    expect(await linksFrom(t1?.id as string)).toEqual([`held_in ${b1?.id}`, `is_a ${tube.id}`]);

    const taken = await refused(register(tube, [{ place: { container: b1?.id, position: 'B3' } }]));
    expect(taken.message).toContain('B3 in BOX-000001 already holds TUB-000001');
    const nowhere = await refused(
      register(tube, [{ place: { container: b1?.id, position: 'K1' } }]),
    );
    expect(nowhere.message).toContain('has no position K1');
    const notBox = await refused(
      register(tube, [{ place: { container: p1?.id, position: 'A1' } }]),
    );
    expect(notBox.message).toContain('is not a rack or box');
    const twice = await refused(
      register(tube, [{ barcodes: [{ code: 'FX0012345', from: 'manufacturer' }] }]),
    );
    expect(twice.message).toContain('already on TUB-000001');
    // Nothing from a refused batch is kept.
    const tubes = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'container',
    });
    expect(tubes.records).toHaveLength(4);
  });

  it('moves a box with its tubes, refuses a box inside itself, and scans codes', async () => {
    const { box, tube, room, freezer } = await lab();
    const [outer, inner] = await register(box, [
      { place: { location: freezer.id } },
      { place: { location: freezer.id } },
    ]);
    const [t1] = await register(tube, [
      {
        place: { container: outer?.id, position: 'A1' },
        barcodes: [{ code: 'FX99', from: 'vendor' }],
      },
    ]);
    const moved = await run<{ container: RecordEnvelope; path: PlacePath }>(
      person,
      'inventory.move',
      {
        container: outer?.id,
        expectedVersion: outer?.version,
        to: { container: inner?.id, position: 'C4' },
      },
    );
    expect(names(moved.path)).toEqual(['LOC-0001', 'LOC-0002', 'BOX-000002', 'BOX-000001@C4']);
    const loop = await refused(
      run(person, 'inventory.move', {
        container: inner?.id,
        expectedVersion: inner?.version,
        to: { container: outer?.id, position: 'A2' },
      }),
    );
    expect(loop.message).toContain('can’t sit inside itself');

    const byName = await run<{ record: RecordEnvelope; matched: string; path: PlacePath }>(
      person,
      'inventory.scan',
      { code: 'tub000001' },
    );
    expect(byName).toMatchObject({ matched: 'name', record: { id: t1?.id } });
    expect(names(byName.path)).toEqual([
      'LOC-0001',
      'LOC-0002',
      'BOX-000002',
      'BOX-000001@C4',
      'TUB-000001@A1',
    ]);
    const byCode = await run<{ record: RecordEnvelope; matched: string }>(
      person,
      'inventory.scan',
      { code: 'FX99' },
    );
    expect(byCode).toMatchObject({ matched: 'barcode', record: { id: t1?.id } });
    expect((await refused(run(person, 'inventory.scan', { code: 'NOPE123' }))).message).toContain(
      'Nothing in this lab has the code NOPE123',
    );

    const shallow = await run<{ containers: { container: RecordEnvelope }[] }>(
      person,
      'inventory.list_place',
      { place: room.id },
    );
    expect(shallow.containers).toHaveLength(0);
    const deep = await run<{
      locations: RecordEnvelope[];
      containers: { container: RecordEnvelope; position?: string }[];
    }>(person, 'inventory.list_place', { place: room.id, deep: true });
    expect(deep.locations.map((l) => l.id)).toEqual([freezer.id]);
    expect(deep.containers.map((c) => [c.container.name, c.position])).toEqual(
      expect.arrayContaining([
        ['BOX-000002', undefined],
        ['BOX-000001', 'C4'],
        ['TUB-000001', 'A1'],
      ]),
    );
  });

  it('proposes agent registrations and moves, and keeps other labs out', async () => {
    const { plate, freezer, room } = await lab();
    const proposed = await registry.execute(agent, 'inventory.register_containers', {
      labwareType: plate.id,
      containers: [{ place: { location: freezer.id } }],
    });
    expect(proposed.status).toBe('proposed');
    const [p1] = await register(plate, [{ place: { location: freezer.id } }]);
    const move = await registry.execute(agent, 'inventory.move', {
      container: p1?.id,
      expectedVersion: p1?.version,
      to: { location: room.id },
    });
    expect(move.status).toBe('proposed');
    const hidden = await refused(run(otherLab, 'inventory.scan', { code: 'PLT-000001' }));
    expect(hidden.message).toContain('Nothing in this lab');
    const foreign = await refused(
      run(otherLab, 'inventory.register_containers', {
        labwareType: plate.id,
        containers: [{}],
      }),
    );
    expect(foreign.message).toContain('is not a labware type in this lab');
    const wrongType = await refused(
      run(person, 'inventory.register_containers', { labwareType: 'plate', containers: [{}] }),
    );
    expect(wrongType).toBeDefined();
  });

  it('warns while the labware type is a draft', async () => {
    const { plate, freezer } = await lab();
    const [p1] = await register(plate, [{ place: { location: freezer.id } }]);
    const readiness = await run<{ checks: { id: string; passed: boolean }[] }>(
      person,
      'records.readiness',
      { id: p1?.id },
    );
    expect(readiness.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'type_confirmed', passed: false })]),
    );
  });
});

describe('seed inventory', () => {
  it('proposes rooms, then storage, then containers, as each is approved', async () => {
    const seedFile = (name: string) =>
      readFile(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');
    const labware = await seedFile('labware.yaml');
    const seeder: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    await loadSeedLabware(registry, seeder, labware);
    const seed = readSeedInventory({
      lab: await seedFile('lab.yaml'),
      inventory: await seedFile('inventory.yaml'),
      labware,
    });
    const approveAll = async () => {
      const { proposals } = await run<{ proposals: Proposal[] }>(person, 'proposals.list', {
        status: 'pending',
      });
      for (const p of proposals) await run(person, 'proposals.approve', { id: p.id });
      return proposals.length;
    };

    const first = await loadSeedInventory(registry, seeder, seed);
    expect(first.locations.proposed).toHaveLength(4);
    expect(first.locations.waiting).toHaveLength(7);
    expect(first.containers.waiting).toHaveLength(8);
    expect(first.skipped.map((s) => s.key)).toEqual(['flask-hek293-01']);
    const again = await loadSeedInventory(registry, seeder, seed);
    expect(again.locations.proposed).toHaveLength(0);
    expect(await approveAll()).toBe(4);

    expect((await loadSeedInventory(registry, seeder, seed)).locations.proposed).toHaveLength(7);
    expect(await approveAll()).toBe(7);
    expect((await loadSeedInventory(registry, seeder, seed)).containers.proposed).toHaveLength(8);
    expect(await approveAll()).toBe(8);
    const last = await loadSeedInventory(registry, seeder, seed);
    expect(last.containers.existing).toHaveLength(8);
    expect(last.locations.existing).toHaveLength(11);

    const tubes = await run<{ record: RecordEnvelope; path: PlacePath }>(person, 'inventory.scan', {
      code: 'TUB-000001',
    });
    expect(tubes.path.map((p) => p.label).slice(0, 2)).toEqual([
      'Cold room and freezer alcove (B2.10)',
      'Freezer -20 1',
    ]);
    const plates = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'container',
      search: 'PLT',
    });
    expect(plates.records.map((p) => p.name).sort()).toEqual([
      'PLT-000001',
      'PLT-000002',
      'PLT-000003',
    ]);
  });
});

import { readFile } from 'node:fs/promises';
import type {
  Actor,
  EquipmentKindAttributes,
  InstrumentKindAttributes,
  Readiness,
  RecordEnvelope,
  ResolvedConfiguration,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { instrumentKinds } from './kinds.ts';
import { loadSeedInstruments, readSeedInstruments } from './seed.ts';

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
  for (const kind of [...labwareKinds, ...instrumentKinds]) kinds.register(kind);
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

const flex: InstrumentKindAttributes = {
  model: 'Opentrons Flex',
  category: 'liquid_handler',
  performedBy: 'machine',
  mounts: [
    {
      id: 'pipettes',
      label: 'pipette mounts',
      layout: { layout: 'slots', slots: ['left', 'right'] },
      accepts: ['flex_pipette'],
      changedBy: 'operator',
    },
    {
      id: 'deck',
      label: 'deck',
      layout: { layout: 'slots', slots: ['A1', 'B1', 'C1', 'D1'] },
      accepts: ['flex_module'],
      changedBy: 'operator',
    },
  ],
  sites: ['A1', 'B1', 'C1', 'D1'].map((slot) => ({ id: slot, mount: { mount: 'deck', slot } })),
};

const pipette: EquipmentKindAttributes = {
  model: 'Flex 8-Channel 1000 uL',
  role: 'pipette',
  fits: ['flex_pipette'],
  serialized: true,
  capabilities: [
    {
      capability: 'transfer',
      limits: {
        volume: { min: { value: '5', unit: 'uL' }, max: { value: '1000', unit: 'uL' } },
        channels: [1, 8],
      },
    },
  ],
};

const create = (ctx: RecordContext, kind: string, label: string, attributes: unknown) =>
  run<RecordEnvelope>(ctx, 'records.create', { kind, label, attributes });

describe('instruments.capabilities', () => {
  it('lists the catalog with what each capability means and needs', async () => {
    const { capabilities } = await run<{
      capabilities: { id: string; label: string; expects: string[] }[];
    }>(agent, 'instruments.capabilities', {});
    expect(capabilities.find((c) => c.id === 'transfer')).toMatchObject({
      label: 'Transfer liquid',
      expects: ['volume'],
    });
    expect(capabilities.map((c) => c.id)).toContain('magnetic_separation');
  });

  it('refuses input it does not take', async () => {
    const error = await refused(run(agent, 'instruments.capabilities', { kind: 'reader' }));
    expect(error).toMatchObject({ code: 'invalid_input' });
  });
});

describe('instrument and equipment kinds', () => {
  it('drafts kinds an agent fills in, with readiness saying what is missing', async () => {
    const kind = await create(agent, 'instrument_kind', 'Opentrons Flex', flex);
    expect(kind.name).toBe('INK-0001');
    expect(kind.id.startsWith('ink_')).toBe(true);
    const state = await run<Readiness>(person, 'records.readiness', { id: kind.id });
    expect(state.sections.map((s) => s.id)).toEqual(['identity', 'layout', 'capabilities']);
    expect(state.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['model_known']);
    const equipment = await create(agent, 'equipment_kind', 'Flex 8-Channel 1000 uL', pipette);
    expect(equipment.name).toBe('EQK-0001');
  });

  it('blocks kinds whose sites, mounts or limits do not add up', async () => {
    const kind = await create(person, 'instrument_kind', 'Broken reader', {
      category: 'plate_reader',
      performedBy: 'machine',
      mounts: [
        {
          id: 'drawer',
          label: 'drawer',
          layout: { layout: 'slots', slots: ['1', '1'] },
          accepts: ['reader_insert'],
          changedBy: 'operator',
        },
      ],
      sites: [{ id: 'plate', mount: { mount: 'tray' } }],
      capabilities: [{ capability: 'read_absorbance', sites: ['carrier'] }],
    });
    const state = await run<Readiness>(person, 'records.readiness', { id: kind.id });
    const failing = state.checks.filter((c) => !c.passed).map((c) => [c.id, c.message]);
    expect(failing).toEqual([
      ['mounts_consistent', 'The drawer lists 1 twice'],
      ['sites_consistent', 'Site plate sits on mount "tray", which isn\'t listed'],
      ['capability_sites_exist', "read_absorbance names site carrier, which isn't listed"],
      ['limits_known', 'Missing limits: read_absorbance (wavelengths)'],
      ['model_known', 'Manufacturer or model is missing'],
    ]);
  });

  it('refuses capabilities outside the catalog', async () => {
    const error = await refused(
      create(agent, 'instrument_kind', 'Teleporter', {
        category: 'other',
        performedBy: 'machine',
        capabilities: [{ capability: 'teleport' }],
      }),
    );
    expect(error).toMatchObject({ code: 'invalid_attributes' });
  });
});

describe('instruments.resolve', () => {
  it('resolves a configuration against the kinds', async () => {
    const kind = await create(agent, 'instrument_kind', 'Opentrons Flex', flex);
    const eight = await create(agent, 'equipment_kind', 'Flex 8-Channel 1000 uL', pipette);
    const result = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrumentKind: kind.id,
      configuration: {
        equipment: [
          {
            id: 'left',
            kind: eight.id,
            mount: 'pipettes',
            placement: { on: 'slot', slot: 'left' },
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.capabilities).toEqual([
      expect.objectContaining({ node: 'left', capability: 'transfer', performedBy: 'machine' }),
    ]);
    expect(result.sites.map((s) => s.site)).toEqual(['A1', 'B1', 'C1', 'D1']);
    // Both kinds are drafts, so the result says so.
    expect(result.issues.map((i) => [i.rule, i.severity])).toEqual([
      ['kind_not_confirmed', 'warning'],
      ['kind_not_confirmed', 'warning'],
    ]);
  });

  it('reports equipment kinds it cannot find as unknown', async () => {
    const kind = await create(agent, 'instrument_kind', 'Opentrons Flex', flex);
    const hidden = await create(otherLab, 'equipment_kind', 'Their pipette', pipette);
    const result = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrumentKind: kind.id,
      configuration: {
        equipment: [
          {
            id: 'left',
            kind: hidden.id,
            mount: 'pipettes',
            placement: { on: 'slot', slot: 'left' },
          },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.severity === 'error')).toMatchObject({
      rule: 'unknown_kind',
      node: 'left',
    });
  });

  it('refuses something that is not an instrument kind, and other labs', async () => {
    const eight = await create(agent, 'equipment_kind', 'Flex 8-Channel 1000 uL', pipette);
    const kind = await create(agent, 'instrument_kind', 'Opentrons Flex', flex);
    const wrongPrefix = await refused(
      run(agent, 'instruments.resolve', {
        instrumentKind: eight.id,
        configuration: { equipment: [] },
      }),
    );
    expect(wrongPrefix).toMatchObject({ code: 'invalid_input' });
    const hidden = await refused(
      run(otherLab, 'instruments.resolve', {
        instrumentKind: kind.id,
        configuration: { equipment: [] },
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('seed instrument library', () => {
  const seedFile = (name: string) =>
    readFile(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');

  it('drafts every kind and instrument once, with sources, and they resolve', async () => {
    const library = readSeedInstruments(
      await seedFile('instrument-library.yaml'),
      await seedFile('instruments.yaml'),
    );
    const seeder: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    const report = await loadSeedInstruments(registry, seeder, library);
    expect(report.created).toHaveLength(library.kinds.length);
    expect(report.registered).toHaveLength(library.instruments.length);
    const again = await loadSeedInstruments(registry, seeder, library);
    expect(again.existing).toHaveLength(library.kinds.length);
    expect(again.registeredBefore).toHaveLength(library.instruments.length);

    // The demo Flex resolves with every module it has installed.
    const flex1 = (
      await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
        kind: 'instrument',
        search: 'Flex 1',
      })
    ).records[0] as RecordEnvelope;
    const demo = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrument: flex1.id,
    });
    expect(demo.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(demo.capabilities.map((c) => c.capability)).toContain('thermocycle');

    const all = [
      ...(
        await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
          kind: 'instrument_kind',
          limit: 200,
        })
      ).records,
      ...(
        await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
          kind: 'equipment_kind',
          limit: 200,
        })
      ).records,
    ];
    // No seed kind fails a blocker; what is left is for a person to confirm.
    for (const record of all) {
      const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
      const blockers = state.checks.filter((c) => !c.passed && c.severity === 'blocker');
      expect([record.label, blockers.map((c) => c.message)]).toEqual([record.label, []]);
    }
    const byLabel = new Map(all.map((r) => [r.label, r]));
    const flexKind = byLabel.get('Opentrons Flex') as RecordEnvelope;
    expect(flexKind.evidence.mounts).toMatchObject({ source: 'datasheet' });
    expect(byLabel.get('Lab bench (manual work)')?.evidence.capabilities).toMatchObject({
      source: 'assumed',
    });

    const id = (label: string) => (byLabel.get(label) as RecordEnvelope).id;
    const slot = (s: string) => ({ on: 'slot', slot: s });
    const flexResult = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrumentKind: flexKind.id,
      configuration: {
        equipment: [
          {
            id: 'left',
            kind: id('Flex 8-Channel Pipette (1000 uL)'),
            mount: 'pipettes',
            placement: slot('left'),
          },
          {
            id: 'right',
            kind: id('Flex 1-Channel Pipette (50 uL)'),
            mount: 'pipettes',
            placement: slot('right'),
          },
          {
            id: 'gripper',
            kind: id('Flex Gripper GEN1'),
            mount: 'gripper',
            placement: { on: 'fixed' },
          },
          { id: 'tc', kind: id('Thermocycler Module GEN2'), mount: 'deck', placement: slot('B1') },
          { id: 'temp', kind: id('Temperature Module GEN2'), mount: 'deck', placement: slot('C1') },
          { id: 'hs', kind: id('Heater-Shaker Module GEN1'), mount: 'deck', placement: slot('D1') },
          { id: 'mag', kind: id('Magnetic Block GEN1'), mount: 'deck', placement: slot('C2') },
          { id: 'chute', kind: id('Flex Waste Chute'), mount: 'deck', placement: slot('D3') },
        ],
      },
    });
    expect(flexResult.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(new Set(flexResult.capabilities.map((c) => c.capability))).toEqual(
      new Set([
        'transfer',
        'move_labware',
        'thermocycle',
        'heat',
        'cool',
        'shake',
        'magnetic_separation',
      ]),
    );

    const starResult = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrumentKind: id('Hamilton Microlab STAR'),
      configuration: {
        equipment: [
          {
            id: 'channels',
            kind: id('STAR 1000 uL channels (8)'),
            mount: 'channels',
            placement: { on: 'fixed' },
          },
          {
            id: 'head',
            kind: id('CO-RE 96 Probe Head'),
            mount: 'head',
            placement: { on: 'fixed' },
          },
          {
            id: 'gripper',
            kind: id('STAR CO-RE Gripper'),
            mount: 'gripper',
            placement: { on: 'fixed' },
          },
          {
            id: 'tips',
            kind: id('Tip carrier TIP_CAR_480'),
            mount: 'tracks',
            placement: { on: 'rail', track: 1 },
          },
          {
            id: 'plates-1',
            kind: id('Plate carrier PLT_CAR_L5AC'),
            mount: 'tracks',
            placement: { on: 'rail', track: 7 },
          },
          {
            id: 'plates-2',
            kind: id('Plate carrier PLT_CAR_L5AC'),
            mount: 'tracks',
            placement: { on: 'rail', track: 13 },
          },
        ],
      },
    });
    expect(starResult.valid).toBe(true);
    expect(starResult.sites).toHaveLength(15);
  });
});

describe('registered instruments', () => {
  async function setup() {
    const kind = await create(person, 'instrument_kind', 'Opentrons Flex', flex);
    const eight = await create(person, 'equipment_kind', 'Flex 8-Channel 1000 uL', pipette);
    return { kind, eight };
  }
  const left = (kindId: string, extra: Record<string, unknown> = {}) => ({
    id: 'left',
    kind: kindId,
    mount: 'pipettes',
    placement: { on: 'slot', slot: 'left' },
    ...extra,
  });

  it('registers an instrument as a draft with a checked configuration', async () => {
    const { kind, eight } = await setup();
    const flex1 = await run<RecordEnvelope>(agent, 'instruments.register', {
      label: 'Flex 1',
      kind: kind.id,
      shortName: 'FLX-01',
      serial: 'DEMO-FLX-0001',
      configuration: { equipment: [left(eight.id)] },
    });
    expect(flex1).toMatchObject({ name: 'INS-0001', status: 'draft' });
    expect(flex1.attributes).toMatchObject({ status: 'ready', shortName: 'FLX-01' });
    const resolved = await run<ResolvedConfiguration>(agent, 'instruments.resolve', {
      instrument: flex1.id,
    });
    expect(resolved.capabilities.map((c) => c.capability)).toEqual(['transfer']);
  });

  it('refuses a configuration that does not resolve, and a kind that is not an instrument kind', async () => {
    const { kind, eight } = await setup();
    const bad = await refused(
      run(agent, 'instruments.register', {
        label: 'Flex 1',
        kind: kind.id,
        configuration: {
          equipment: [left(eight.id, { placement: { on: 'slot', slot: 'middle' } })],
        },
      }),
    );
    expect(bad).toMatchObject({ code: 'invalid_input' });
    expect(bad.message).toContain('has no slot middle');
    const wrong = await refused(
      run(agent, 'instruments.register', {
        label: 'Pipette',
        kind: eight.id.replace('eqk_', 'ink_'),
      }),
    );
    expect(wrong).toMatchObject({ code: 'not_found' });
  });

  it('changes the configuration as a whole, with items tracked by serial', async () => {
    const { kind, eight } = await setup();
    const item = await create(person, 'equipment_item', 'Flex 8-Channel 1000 uL SN 123', {
      kind: eight.id,
      serial: 'P1KM123',
    });
    const flex1 = await run<RecordEnvelope>(person, 'instruments.register', {
      label: 'Flex 1',
      kind: kind.id,
    });
    const changed = await run<RecordEnvelope>(agent, 'instruments.change_configuration', {
      id: flex1.id,
      expectedVersion: 1,
      changes: [
        { change: 'place', equipment: left(eight.id) },
        { change: 'move', id: 'left', mount: 'pipettes', placement: { on: 'slot', slot: 'right' } },
        { change: 'set_item', id: 'left', item: item.id },
      ],
    });
    expect((changed.attributes as { configuration: unknown }).configuration).toEqual({
      equipment: [{ ...left(eight.id), placement: { on: 'slot', slot: 'right' }, item: item.id }],
    });

    // The same item can't be installed on a second instrument.
    const flex2 = await run<RecordEnvelope>(person, 'instruments.register', {
      label: 'Flex 2',
      kind: kind.id,
    });
    const twice = await refused(
      run(agent, 'instruments.change_configuration', {
        id: flex2.id,
        expectedVersion: 1,
        changes: [{ change: 'place', equipment: left(eight.id, { item: item.id }) }],
      }),
    );
    expect(twice.message).toContain('is installed in Flex 1 (INS-0001)');

    const removed = await run<RecordEnvelope>(agent, 'instruments.change_configuration', {
      id: flex1.id,
      expectedVersion: 2,
      changes: [{ change: 'remove', id: 'left' }],
    });
    expect((removed.attributes as { configuration: unknown }).configuration).toEqual({
      equipment: [],
    });
    const missing = await refused(
      run(agent, 'instruments.change_configuration', {
        id: flex1.id,
        expectedVersion: 3,
        changes: [{ change: 'remove', id: 'left' }],
      }),
    );
    expect(missing.message).toBe('Nothing called "left" is installed');
  });

  it('proposes an agent change to a confirmed instrument, and status and service always', async () => {
    const { kind, eight } = await setup();
    const flex1 = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'instrument',
      label: 'Flex 1',
      status: 'active',
      attributes: { kind: kind.id, configuration: { equipment: [] }, status: 'ready' },
    });
    const change = await registry.execute(agent, 'instruments.change_configuration', {
      id: flex1.id,
      expectedVersion: 1,
      changes: [{ change: 'place', equipment: left(eight.id) }],
    });
    expect(change.status).toBe('proposed');
    const status = await registry.execute(agent, 'instruments.set_status', {
      id: flex1.id,
      expectedVersion: 1,
      status: 'maintenance',
    });
    expect(status.status).toBe('proposed');

    const set = await run<RecordEnvelope>(person, 'instruments.set_status', {
      id: flex1.id,
      expectedVersion: 1,
      status: 'maintenance',
    });
    const serviced = await run<RecordEnvelope>(person, 'instruments.log_service', {
      id: flex1.id,
      expectedVersion: set.version,
      date: '2026-09-29',
      note: 'Annual PM',
      calibrationDue: '2027-09-29',
    });
    expect(serviced.attributes).toMatchObject({
      status: 'maintenance',
      lastService: { date: '2026-09-29', note: 'Annual PM' },
      calibrationDue: '2027-09-29',
    });
  });

  it('keeps other labs out', async () => {
    const { kind } = await setup();
    const flex1 = await run<RecordEnvelope>(person, 'instruments.register', {
      label: 'Flex 1',
      kind: kind.id,
    });
    const hidden = await refused(
      run(otherLab, 'instruments.set_status', {
        id: flex1.id,
        expectedVersion: 1,
        status: 'in_use',
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

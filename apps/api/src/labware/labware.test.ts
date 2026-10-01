import { readFile } from 'node:fs/promises';
import type {
  Actor,
  ComputedWell,
  OpentronsDefinition,
  Readiness,
  RecordEnvelope,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { labwareKinds } from './kinds.ts';
import { loadSeedLabware, readDefinitions, readSeedLabware } from './seed.ts';

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
  for (const kind of labwareKinds) kinds.register(kind);
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

/** A small 2 × 3 plate shaped like an Opentrons definition. */
function definition(): OpentronsDefinition {
  const ordering = [
    ['A1', 'B1'],
    ['A2', 'B2'],
    ['A3', 'B3'],
  ];
  const wells: OpentronsDefinition['wells'] = {};
  ordering.forEach((column, c) => {
    column.forEach((name, r) => {
      wells[name] = {
        depth: 17,
        totalLiquidVolume: 3400,
        shape: 'circular',
        diameter: 16.8,
        x: 24.5 + 39 * c,
        y: 62.5 - 39 * r,
        z: 3,
      };
    });
  });
  return {
    schemaVersion: 2,
    version: 1,
    namespace: 'opentrons',
    metadata: {
      displayName: 'Corning 6 Well Plate 16.8 mL Flat',
      displayCategory: 'wellPlate',
      displayVolumeUnits: 'mL',
    },
    brand: { brand: 'Corning', brandId: ['3516'] },
    parameters: {
      format: 'irregular',
      isTiprack: false,
      loadName: 'corning_6_wellplate_16.8ml_flat',
      isMagneticModuleCompatible: false,
    },
    ordering,
    cornerOffsetFromSlot: { x: 0, y: 0, z: 0 },
    dimensions: { xDimension: 127.76, yDimension: 85.47, zDimension: 20.02 },
    wells,
    groups: [{ metadata: { wellBottomShape: 'flat' }, wells: ordering.flat() }],
  };
}

describe('labware.import_opentrons', () => {
  it('drafts a type with every value marked imported, and its vendor', async () => {
    const record = await run<RecordEnvelope>(agent, 'labware.import_opentrons', {
      definition: definition(),
    });
    expect(record).toMatchObject({ kind: 'labware_type', status: 'draft', name: 'LWT-0001' });
    expect(record.attributes).toMatchObject({
      family: 'plate',
      catalogNumber: '3516',
      opentronsLoadName: 'corning_6_wellplate_16.8ml_flat',
      wells: { layout: 'grid', rows: 2, columns: 3, pitch: { value: '39', unit: 'mm' } },
    });
    expect(record.evidence.wells).toMatchObject({
      source: 'imported',
      reference: 'Opentrons labware definition opentrons/corning_6_wellplate_16.8ml_flat/1',
    });
    const vendor = await run<RecordEnvelope>(person, 'records.get', {
      id: (record.attributes as { manufacturer: string }).manufacturer,
    });
    expect(vendor).toMatchObject({ kind: 'vendor', label: 'Corning', status: 'draft' });

    // A second import reuses the vendor.
    const again = await run<RecordEnvelope>(person, 'labware.import_opentrons', {
      definition: definition(),
    });
    expect(again.attributes).toMatchObject({ manufacturer: vendor.id });
  });

  it('refuses definitions it cannot use', async () => {
    const trash = definition();
    trash.metadata.displayCategory = 'trash';
    const error = await refused(run(person, 'labware.import_opentrons', { definition: trash }));
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect(error.message).toContain('"trash" definitions');
    const old = await refused(
      run(person, 'labware.import_opentrons', {
        definition: { ...definition(), schemaVersion: 1 },
      }),
    );
    expect(old).toMatchObject({ code: 'invalid_input' });
  });
});

describe('labware.wells and labware.export_opentrons', () => {
  it('lists wells and exports what it imported', async () => {
    const record = await run<RecordEnvelope>(person, 'labware.import_opentrons', {
      definition: definition(),
    });
    const { wells } = await run<{ wells: ComputedWell[] }>(person, 'labware.wells', {
      id: record.id,
      order: 'row',
    });
    expect(wells.map((w) => w.name)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    expect(wells[4]).toMatchObject({ x: { value: '63.5' }, y: { value: '61.97' } });

    const { definition: exported } = await run<{ definition: OpentronsDefinition }>(
      agent,
      'labware.export_opentrons',
      { id: record.id },
    );
    expect(exported.wells.B2).toEqual(definition().wells.B2);
    expect(exported.brand).toEqual({ brand: 'Corning', brandId: ['3516'] });
  });

  it('says what is missing before it can export', async () => {
    const record = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'Half-known plate',
      attributes: { family: 'plate', wells: { layout: 'grid', rows: 8, columns: 12 } },
    });
    const error = await refused(run(person, 'labware.export_opentrons', { id: record.id }));
    expect(error).toMatchObject({ code: 'not_ready' });
    expect(error.message).toContain('outer size, maximum volume, well positions');
  });

  it('refuses other kinds and other labs', async () => {
    const vendor = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'vendor',
      label: 'Corning',
      attributes: {},
    });
    const wrongPrefix = await refused(run(person, 'labware.wells', { id: vendor.id }));
    expect(wrongPrefix).toMatchObject({ code: 'invalid_input' });
    const record = await run<RecordEnvelope>(person, 'labware.import_opentrons', {
      definition: definition(),
    });
    const hidden = await refused(run(otherLab, 'labware.wells', { id: record.id }));
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('labware.use_standard_positions', () => {
  const sbsPlate = (wells: Record<string, unknown>) =>
    run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'Tip rack',
      attributes: {
        family: 'tip_rack',
        footprint: { sbs: true },
        wells: { layout: 'grid', ...wells },
      },
    });

  it('offers the fix on the failing check and fills the standard pitch and A1 offset', async () => {
    const record = await sbsPlate({ rows: 8, columns: 12 });
    const before = await run<Readiness>(person, 'records.readiness', { id: record.id });
    const [option, ...others] = before.checks.find((c) => c.id === 'wells_placed')?.options ?? [];
    expect(others).toEqual([]);
    expect(option).toEqual({
      label: 'Use the standard SBS positions',
      consequence: expect.stringContaining('pitch to 9 mm'),
      operation: 'labware.use_standard_positions',
      input: { id: record.id, expectedVersion: record.version },
    });

    // The option is the whole call: its operation with its input.
    const updated = await run<RecordEnvelope>(
      agent,
      option?.operation ?? '',
      option?.input as Record<string, unknown>,
    );
    expect(updated.attributes.wells).toEqual({
      layout: 'grid',
      rows: 8,
      columns: 12,
      pitch: { value: '9', unit: 'mm' },
      a1: { x: { value: '14.38', unit: 'mm' }, y: { value: '11.24', unit: 'mm' } },
    });
    expect(updated.evidence.wells).toMatchObject({
      source: 'calculated',
      reference: expect.stringContaining('ANSI/SLAS 4-2004'),
    });
    const after = await run<Readiness>(person, 'records.readiness', { id: updated.id });
    expect(after.checks.find((c) => c.id === 'wells_placed')).toMatchObject({ passed: true });
    expect(after.checks.find((c) => c.id === 'wells_placed')?.options).toBeUndefined();
  });

  it('refuses grids the standard does not place, and a pitch that disagrees', async () => {
    const six = await sbsPlate({ rows: 2, columns: 3 });
    const odd = await refused(
      run(person, 'labware.use_standard_positions', { id: six.id, expectedVersion: 1 }),
    );
    expect(odd).toMatchObject({ code: 'invalid_input' });
    expect(odd.message).toContain('not 2 × 3');
    const state = await run<Readiness>(person, 'records.readiness', { id: six.id });
    expect(state.checks.find((c) => c.id === 'wells_placed')?.options).toBeUndefined();

    const wide = await sbsPlate({ rows: 8, columns: 12, pitch: { value: '9.5', unit: 'mm' } });
    const pitch = await refused(
      run(person, 'labware.use_standard_positions', { id: wide.id, expectedVersion: 1 }),
    );
    expect(pitch.message).toContain('9.5 mm pitch');
  });

  it('keeps other labs out', async () => {
    const record = await sbsPlate({ rows: 16, columns: 24 });
    const hidden = await refused(
      run(otherLab, 'labware.use_standard_positions', { id: record.id, expectedVersion: 1 }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
    const mine = await run<RecordEnvelope>(person, 'records.get', { id: record.id });
    expect(mine.attributes.wells).not.toHaveProperty('a1');
  });
});

describe('labware type checks', () => {
  it('blocks a draft whose SBS plate has the wrong well spacing', async () => {
    const record = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'Odd plate',
      attributes: {
        family: 'plate',
        footprint: {
          sbs: true,
          length: { value: '127.76', unit: 'mm' },
          width: { value: '85.48', unit: 'mm' },
          height: { value: '14.2', unit: 'mm' },
        },
        wells: { layout: 'grid', rows: 8, columns: 12, pitch: { value: '9.5', unit: 'mm' } },
        maxVolume: { value: '300', unit: 'uL' },
        deadVolume: { value: '400', unit: 'uL' },
      },
    });
    const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
    const failing = state.checks.filter((c) => !c.passed && c.severity === 'blocker');
    expect(failing.map((c) => [c.id, c.message])).toEqual([
      ['sbs_pitch', '8 × 12 wells should be 9 mm apart, not 9.5 mm'],
      ['volumes_consistent', 'Dead volume 400 µL is not less than the maximum 300 µL'],
    ]);
  });

  it('asks a tube only what applies to a tube', async () => {
    const record = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: 'Conical tube',
      attributes: {
        family: 'tube',
        footprint: { sbs: false, diameter: { value: '30', unit: 'mm' } },
        wells: { layout: 'grid', rows: 1, columns: 1 },
        maxVolume: { value: '50', unit: 'mL' },
      },
    });
    const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
    const ids = state.checks.map((c) => c.id);
    expect(ids).not.toContain('wells_placed');
    expect(ids).not.toContain('sbs_footprint');
    expect(ids).not.toContain('tip_known');
    expect(ids).toContain('dead_volume_known');
    expect(state.notApplicable).toEqual(expect.arrayContaining(['wells.a1', 'wells.pitch', 'tip']));
    expect(state.notApplicable).not.toContain('footprint.diameter');
  });

  it('refuses attributes outside the schema', async () => {
    const error = await refused(
      run(agent, 'records.create', {
        kind: 'labware_type',
        label: 'Typo',
        attributes: { family: 'plate', wellCount: 96 },
      }),
    );
    expect(error).toMatchObject({ code: 'invalid_attributes' });
  });
});

describe('seed labware', () => {
  const seedFile = () =>
    readFile(new URL('../../../../seed/labware.yaml', import.meta.url), 'utf8');
  const seedDefinitions = () =>
    readDefinitions(new URL('../../../../seed/opentrons/', import.meta.url));

  it('reads every labware entry in the seed file and says why it skips the rest', async () => {
    const { types, skipped } = readSeedLabware(await seedFile());
    expect(types).toHaveLength(32);
    expect(skipped).toEqual([
      {
        key: 'formulatrix-233580',
        reason: '"dispense_chip (consumable, not labware)" is not a labware family',
      },
    ]);
    const plate = types.find((t) => t.key === 'corning-3590');
    expect(plate?.evidence.deadVolume).toMatchObject({ source: 'assumed' });
    expect(plate?.evidence.maxVolume).toMatchObject({
      source: 'datasheet',
      reference: expect.stringContaining('corning.com'),
    });
  });

  it('places wells from the Opentrons definition the seed names', async () => {
    const { types } = readSeedLabware(await seedFile(), await seedDefinitions());
    const tips = types.find((t) => t.key === 'opentrons-991-00104');
    expect(tips?.attributes.wells).toMatchObject({
      layout: 'grid',
      rows: 8,
      columns: 12,
      pitch: { value: '9', unit: 'mm' },
      a1: { x: { value: '14.38', unit: 'mm' }, y: { value: '11.37', unit: 'mm' } },
      well: { top: { shape: 'circular', diameter: { value: '5.58', unit: 'mm' } } },
    });
    expect(tips?.evidence.wells).toMatchObject({
      source: 'datasheet',
      reference: expect.stringContaining('opentrons_flex_96_filtertiprack_50ul/1.json'),
    });
    // The Corning plate keeps its datasheet well size and gains the definition's positions.
    const plate = types.find((t) => t.key === 'corning-3590');
    expect(plate?.attributes.wells).toMatchObject({ a1: { x: { value: '14.38', unit: 'mm' } } });
    expect(plate?.evidence.wells?.note).toContain('well size from the seed source');
    // A load name the seed only estimated is not trusted for positions.
    const pcr = types.find((t) => t.key === 'biorad-hsp9655');
    expect(pcr?.attributes.wells).not.toHaveProperty('a1');
  });

  it('loads drafts once, through the operations, as the seed loader', async () => {
    const loader: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    const text = await seedFile();
    const first = await loadSeedLabware(registry, loader, text);
    expect(first.created).toHaveLength(32);
    const again = await loadSeedLabware(registry, loader, text, await seedDefinitions());
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual(
      expect.arrayContaining([expect.stringContaining('opentrons-991-00104')]),
    );
    expect(again.existing).toContain('falcon-352096');
    const once = await loadSeedLabware(registry, loader, text, await seedDefinitions());
    expect(once.updated).toEqual([]);

    expect(once.proposed).toEqual([]);

    const { records } = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'vendor',
      limit: 50,
    });
    expect(records.map((r) => r.label)).toContain('Corning');
    const { records: types } = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'labware_type',
      search: 'EIA/RIA',
    });
    expect(types[0]).toMatchObject({ status: 'draft', createdBy: { agentName: 'Seed loader' } });
  });

  it('proposes new seed wells for a type a person already confirmed, once', async () => {
    const loader: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    const text = await seedFile();
    await loadSeedLabware(registry, loader, text);
    const { records } = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'labware_type',
      search: 'Flex Tips, 50 uL',
    });
    let tips = records[0] as RecordEnvelope;
    for (const section of ['identity', 'geometry', 'volumes', 'instruments']) {
      tips = await run<RecordEnvelope>(person, 'records.confirm_section', {
        id: tips.id,
        expectedVersion: tips.version,
        section,
      });
    }
    expect(tips.status).toBe('active');

    const report = await loadSeedLabware(registry, loader, text, await seedDefinitions());
    expect(report.proposed).toEqual([expect.stringContaining('opentrons-991-00104')]);
    const unchanged = await run<RecordEnvelope>(person, 'records.get', { id: tips.id });
    expect(unchanged.attributes.wells).not.toHaveProperty('a1');
    const again = await loadSeedLabware(registry, loader, text, await seedDefinitions());
    expect(again.proposed).toEqual([]);
  });
});

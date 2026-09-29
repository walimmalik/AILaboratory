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

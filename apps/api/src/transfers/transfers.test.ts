import type { Actor, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { inventoryKinds } from '../inventory/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';

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
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...inventoryKinds,
  ]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
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

const nL = (value: string) => ({ value, unit: 'nL' });
const uL = (value: string) => ({ value, unit: 'uL' });
const create = (label: string, kind: string, attributes: unknown) =>
  run<RecordEnvelope>(person, 'records.create', { kind, label, attributes });

/** An Echo with 2.5 nL droplets and a Flex with an 8-channel 1000 uL pipette. */
async function lab() {
  const echoKind = await create('Echo 650', 'instrument_kind', {
    model: 'Echo 650',
    category: 'liquid_handler',
    performedBy: 'machine',
    capabilities: [
      {
        capability: 'transfer',
        limits: { volume: { min: nL('2.5'), max: uL('10') }, volumeStep: nL('2.5') },
      },
    ],
  });
  const flexKind = await create('Opentrons Flex', 'instrument_kind', {
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
    ],
  });
  const eight = await create('Flex 8-Channel 1000 uL', 'equipment_kind', {
    model: 'Flex 8-Channel 1000 uL',
    role: 'pipette',
    fits: ['flex_pipette'],
    serialized: true,
    capabilities: [
      {
        capability: 'transfer',
        limits: { volume: { min: uL('5'), max: uL('1000') }, channels: [1, 8] },
      },
    ],
  });
  const echo = await run<RecordEnvelope>(person, 'instruments.register', {
    label: 'Echo 1',
    kind: echoKind.id,
  });
  const flex = await run<RecordEnvelope>(person, 'instruments.register', {
    label: 'Flex 1',
    kind: flexKind.id,
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
  const pp = await create('Echo 384PP', 'labware_type', {
    family: 'plate',
    wells: { layout: 'grid', rows: 16, columns: 24 },
    maxVolume: uL('65'),
    workingVolume: { min: uL('15'), max: uL('65') },
    deadVolume: uL('15'),
  });
  return { echo, flex, pp };
}

describe('transfers.dilution_options', () => {
  it('says which targets an Echo reaches straight from the stock and which need an intermediate', async () => {
    const { echo } = await lab();
    const out = await run<{
      device: { label: string; step?: unknown };
      points: {
        target: unknown;
        reachable: boolean;
        direct: { ok: boolean; volume: { steps?: number } };
        intermediate?: { factor: string };
      }[];
    }>(agent, 'transfers.dilution_options', {
      stock: { value: '10', unit: 'mM' },
      targets: [
        { value: '10', unit: 'uM' },
        { value: '1', unit: 'nM' },
      ],
      finalVolume: uL('25'),
      device: { instrument: echo.id },
      maxSolventPercent: '1',
    });
    expect(out.device).toMatchObject({ label: 'Echo 1', step: nL('2.5') });
    expect(out.points[0]).toMatchObject({
      reachable: true,
      direct: { ok: true, volume: { steps: 10 } },
    });
    expect(out.points[1]?.direct.ok).toBe(false);
    expect(out.points[1]?.intermediate?.factor).toBeDefined();
  });

  it('refuses an instrument that moves no liquid, a device with more than one choice, and bad input', async () => {
    const { flex } = await lab();
    const input = {
      stock: { value: '10', unit: 'mM' },
      targets: [{ value: '10', unit: 'uM' }],
      finalVolume: uL('25'),
      device: { instrument: flex.id, node: 'right' },
    };
    const none = await refused(run(agent, 'transfers.dilution_options', input));
    expect(none).toMatchObject({ code: 'invalid_input' });
    expect(none.message).toContain('nothing called right');
    const bad = await refused(
      run(agent, 'transfers.dilution_options', {
        ...input,
        device: { instrument: flex.id },
        targets: [],
      }),
    );
    expect(bad).toMatchObject({ code: 'invalid_input' });
    const units = await refused(
      run(agent, 'transfers.dilution_options', {
        ...input,
        device: { limits: { step: nL('2.5') } },
        stock: { value: '10', unit: 'mg' },
      }),
    );
    expect(units).toMatchObject({ code: 'invalid_input' });
  });

  it("does not read another lab's instruments", async () => {
    const { echo } = await lab();
    const hidden = await refused(
      run(otherLab, 'transfers.dilution_options', {
        stock: { value: '10', unit: 'mM' },
        targets: [{ value: '10', unit: 'uM' }],
        finalVolume: uL('25'),
        device: { instrument: echo.id },
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('transfers.optimize_dilution', () => {
  it('plans intermediate wells on the plate type given', async () => {
    const { echo, pp } = await lab();
    const out = await run<{
      points: { from: string; intermediate?: string }[];
      intermediates: { id: string; well: string; plate: number }[];
      plates: number;
      unreachable: unknown[];
    }>(agent, 'transfers.optimize_dilution', {
      compounds: [
        {
          id: 'staurosporine',
          stock: { value: '10', unit: 'mM' },
          points: ['10', '1', '0.1', '0.01', '0.001'].map((value) => ({ value, unit: 'uM' })),
          wellsPerPoint: 2,
        },
      ],
      finalVolume: uL('25'),
      device: { instrument: echo.id },
      maxSolventPercent: '1',
      intermediatePlate: pp.id,
    });
    expect(out.unreachable).toEqual([]);
    expect(out.points[0]?.from).toBe('source');
    expect(out.points.some((p) => p.from === 'intermediate')).toBe(true);
    expect(out.intermediates[0]).toMatchObject({ id: 'I1', well: 'A1', plate: 1 });
    expect(out.plates).toBe(1);
  });

  it('refuses a plate type without a dead volume or wells', async () => {
    const { echo } = await lab();
    const tube = await create('Tube', 'labware_type', { family: 'tube', maxVolume: uL('1500') });
    const error = await refused(
      run(agent, 'transfers.optimize_dilution', {
        compounds: [
          { id: 'x', stock: { value: '10', unit: 'mM' }, points: [{ value: '1', unit: 'uM' }] },
        ],
        finalVolume: uL('25'),
        device: { instrument: echo.id },
        maxSolventPercent: '1',
        intermediatePlate: tube.id,
      }),
    );
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect(error.message).toContain('dead volume');
  });
});

describe('transfers.source_volumes', () => {
  it('adds dead volume and overage to what is drawn, and says which wells are short', async () => {
    const { pp } = await lab();
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: pp.id, containers: [{}] },
    );
    const plate = containers[0] as RecordEnvelope;
    const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
      label: 'DMSO',
      attributes: { category: 'solvent', origin: 'bought' },
    });
    const dmso = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'A1',
    });
    await run(person, 'inventory.fill', {
      container: plate.id,
      fills: [
        {
          wells: ['A1'],
          volume: uL('20'),
          components: [{ source: dmso.id, concentration: { value: '100', unit: '%v/v' } }],
        },
      ],
    });
    const out = await run<{ sources: Record<string, unknown>[]; notes: string[] }>(
      agent,
      'transfers.source_volumes',
      {
        draws: [
          { container: plate.id, well: 'A1', volume: nL('2500') },
          { container: plate.id, well: 'A1', volume: nL('2500') },
          { container: plate.id, well: 'B1', volume: uL('1') },
        ],
        overage: '0.1',
      },
    );
    expect(out.sources[0]).toMatchObject({
      well: 'A1',
      drawn: uL('5'),
      dead: uL('15'),
      overage: uL('0.5'),
      needed: uL('20.5'),
      draws: 2,
      holds: uL('20'),
      short: uL('0.5'),
    });
    expect(out.sources[1]).toMatchObject({ well: 'B1', holds: uL('0'), draws: 1 });
    expect(out.notes).toEqual([]);
  });

  it('refuses records that are not containers and other labs', async () => {
    const { pp } = await lab();
    const wrong = await refused(
      run(agent, 'transfers.source_volumes', {
        draws: [{ container: pp.id.replace('lwt_', 'lw_'), well: 'A1', volume: uL('1') }],
      }),
    );
    expect(['invalid_input', 'not_found']).toContain(wrong.code);
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: pp.id, containers: [{}] },
    );
    const hidden = await refused(
      run(otherLab, 'transfers.source_volumes', {
        draws: [{ container: containers[0]?.id, well: 'A1', volume: uL('1') }],
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('transfers.options', () => {
  it('ranks the instruments that can move a volume', async () => {
    await lab();
    const small = await run<{
      options: {
        rank: number;
        device: string;
        fit: { fits: boolean; steps?: number };
        tips: string;
      }[];
    }>(agent, 'transfers.options', { volume: nL('50') });
    expect(small.options.map((o) => [o.device, o.fit.fits, o.tips])).toEqual([
      ['Echo 1', true, 'none'],
      ['Flex 1 (left)', false, 'lab_default'],
    ]);
    const large = await run<{ options: { device: string; fit: { fits: boolean } }[] }>(
      agent,
      'transfers.options',
      { volume: uL('50') },
    );
    expect(large.options[0]).toMatchObject({ device: 'Flex 1 (left)', fit: { fits: true } });
  });

  it('refuses a volume without a volume unit, and sees nothing of other labs', async () => {
    await lab();
    const bad = await refused(
      run(agent, 'transfers.options', { volume: { value: '1', unit: 'mM' } }),
    );
    expect(bad).toMatchObject({ code: 'invalid_input' });
    const other = await run<{ options: unknown[] }>(otherLab, 'transfers.options', {
      volume: uL('5'),
    });
    expect(other.options).toEqual([]);
  });
});

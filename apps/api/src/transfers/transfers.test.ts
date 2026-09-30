import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
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
import { transferKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;
let kinds: KindRegistry;

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
  kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...inventoryKinds,
    ...transferKinds,
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
    footprint: {
      length: { value: '127.76', unit: 'mm' },
      width: { value: '85.48', unit: 'mm' },
      height: { value: '14.4', unit: 'mm' },
      sbs: true,
    },
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

/** A person confirms every section of a draft, which activates it. */
async function confirm(record: RecordEnvelope): Promise<RecordEnvelope> {
  let current = record;
  for (const section of kinds.get(record.kind).sections ?? []) {
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  return current;
}

type Checked = {
  ok: boolean;
  checks: { id: string; passed: boolean; problems: string[] }[];
  totals: { transfers: number; tips: number; sources: number };
};

describe('transfer plans', () => {
  async function setup() {
    const { echo, flex, pp } = await lab();
    const assay = await create('Assay 384', 'labware_type', {
      family: 'plate',
      footprint: {
        length: { value: '127.76', unit: 'mm' },
        width: { value: '85.48', unit: 'mm' },
        height: { value: '14.4', unit: 'mm' },
        sbs: true,
      },
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: uL('50'),
    });
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: pp.id, containers: [{}, {}] },
    );
    const [src, other] = containers as [RecordEnvelope, RecordEnvelope];
    const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
      label: 'Staurosporine',
      attributes: { category: 'compound', origin: 'bought' },
    });
    const lot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'S1',
    });
    await run(person, 'inventory.fill', {
      container: src.id,
      fills: [
        {
          wells: ['A1'],
          volume: uL('30'),
          components: [{ source: lot.id, concentration: { value: '10', unit: 'mM' } }],
        },
      ],
    });
    const draft = {
      label: 'Staurosporine into the assay plate',
      plates: [
        { id: 'src', role: 'source', labwareType: { id: pp.id, version: pp.version } },
        { id: 'assay', role: 'destination', labwareType: { id: assay.id, version: assay.version } },
      ],
      groups: [
        {
          id: 'compounds',
          label: 'Echo: compound into the assay plate',
          method: 'direct_dispense',
          instrument: { instrument: echo.id },
          reason: 'Nanolitre DMSO transfers, no tips',
          tips: 'none',
          transfers: ['A1', 'A2', 'A3', 'A4'].map((well) => ({
            from: { plate: 'src', well: 'A1' },
            to: { plate: 'assay', well },
            volume: nL('2500'),
          })),
        },
      ],
    };
    return { echo, flex, pp, assay, src, other, draft };
  }

  it('drafts a plan with its instrument limits, checks it, and reserves its sources once confirmed', async () => {
    const { echo, pp, assay, src, draft } = await setup();
    const plan = await run<RecordEnvelope>(agent, 'transfers.draft', draft);
    expect(plan).toMatchObject({ name: 'TFP-0001', status: 'draft' });
    expect(plan.attributes).toMatchObject({
      groups: [{ device: { label: 'Echo 1', step: nL('2.5') } }],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: plan.id });
    const failing = ready.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failing).toEqual(['sources_picked', 'inputs_confirmed']);

    const picked = await run<RecordEnvelope>(agent, 'transfers.pick_sources', {
      id: plan.id,
      expectedVersion: plan.version,
      picks: [{ plate: 'src', container: src.id }],
    });
    const checked = await run<Checked>(agent, 'transfers.check', { id: plan.id });
    expect(checked.totals).toEqual({ transfers: 4, tips: 0, sources: 1 });
    expect(checked.checks.find((c) => c.id === 'sources_enough')).toMatchObject({ passed: true });

    const ppOk = await confirm(pp);
    const assayOk = await confirm(assay);
    expect([ppOk.status, assayOk.status]).toEqual(['active', 'active']);
    const repinned = await run<RecordEnvelope>(person, 'records.update', {
      id: picked.id,
      expectedVersion: picked.version,
      attributes: {
        ...picked.attributes,
        plates: (picked.attributes as typeof draft).plates.map((p) => ({
          ...p,
          labwareType: {
            ...p.labwareType,
            version: p.id === 'src' ? ppOk.version : assayOk.version,
          },
        })),
      },
    });
    const active = await confirm(repinned);
    const state = await run<Readiness>(person, 'records.readiness', { id: active.id });
    expect(state.missing).toEqual([]);
    expect(active.status).toBe('active');

    const reserved = await run<{
      wells: { well: string; reserved: unknown; plans: { name: string }[] }[];
    }>(agent, 'transfers.reserved', { container: src.id });
    expect(reserved.wells).toEqual([
      {
        well: 'A1',
        reserved: uL('10'),
        plans: [{ id: active.id, name: 'TFP-0001', volume: uL('10') }],
      },
    ]);
    const needs = await run<{ sources: Record<string, unknown>[] }>(
      agent,
      'transfers.source_volumes',
      {
        draws: [{ container: src.id, well: 'A1', volume: uL('10') }],
      },
    );
    // 30 µL held, 10 reserved: 20 available against 10 drawn + 15 dead.
    expect(needs.sources[0]).toMatchObject({ reserved: uL('10'), short: uL('5') });
    const own = await run<{ sources: Record<string, unknown>[] }>(
      agent,
      'transfers.source_volumes',
      {
        draws: [{ container: src.id, well: 'A1', volume: uL('10') }],
        plan: active.id,
      },
    );
    expect(own.sources[0]?.short).toBeUndefined();

    // A second plan drawing the same well is warned, not blocked (V8).
    const second = await run<RecordEnvelope>(agent, 'transfers.draft', {
      ...draft,
      plates: [{ ...draft.plates[0], container: src.id }, draft.plates[1]],
    });
    const warned = await run<Checked>(agent, 'transfers.check', { id: second.id });
    expect(warned.checks.find((c) => c.id === 'sources_enough')?.problems[0]).toContain(
      'after 10 µL reserved by other plans',
    );

    // Changes to the confirmed plan are proposals.
    const proposed = await registry.execute(agent, 'transfers.set_instrument', {
      id: active.id,
      expectedVersion: active.version,
      group: 'compounds',
      why: 'Try by hand',
    });
    expect(proposed.status).toBe('proposed');
    expect(echo.id).toBeDefined();
  });

  it('reports volumes its instrument cannot move, overfull wells and intermediates used too early', async () => {
    const { flex, draft } = await setup();
    const plan = await run<RecordEnvelope>(agent, 'transfers.draft', {
      ...draft,
      plates: [
        ...draft.plates,
        { id: 'mid', role: 'intermediate', labwareType: draft.plates[0]?.labwareType },
      ],
      groups: [
        {
          ...draft.groups[0],
          transfers: [
            {
              from: { plate: 'mid', well: 'A1' },
              to: { plate: 'assay', well: 'B1' },
              volume: nL('2.5'),
            },
            {
              from: { plate: 'src', well: 'A1' },
              to: { plate: 'assay', well: 'A1' },
              volume: nL('1'),
            },
            {
              from: { plate: 'src', well: 'A1' },
              to: { plate: 'assay', well: 'A2' },
              volume: uL('60'),
            },
          ],
        },
      ],
    });
    const ready = await run<Readiness>(person, 'records.readiness', { id: plan.id });
    const byId = new Map(ready.checks.map((c) => [c.id, c]));
    expect(byId.get('volumes_fit')?.message).toContain('1 nL is less than one step of 2.5 nL');
    expect(byId.get('wells_hold')?.message).toBe('assay A2 gets 60 µL; it holds 50 µL');
    expect(byId.get('intermediates_first')?.message).toContain('draws from mid A1 before anything');

    const switched = await run<RecordEnvelope>(agent, 'transfers.set_instrument', {
      id: plan.id,
      expectedVersion: plan.version,
      group: 'compounds',
      instrument: { instrument: flex.id },
      why: 'Microlitre volumes',
    });
    expect(switched.attributes).toMatchObject({
      groups: [{ device: { label: 'Flex 1 (left)', min: uL('5') }, reason: 'Microlitre volumes' }],
    });
    const after = await run<Readiness>(person, 'records.readiness', { id: plan.id });
    expect(after.checks.find((c) => c.id === 'volumes_fit')?.message).toContain(
      '2.5 nL is below the minimum of 5 µL',
    );
  });

  it('refuses plates and wells that do not add up, and other labs', async () => {
    const { draft, other } = await setup();
    const bad = (groups: unknown, plates: unknown = draft.plates) =>
      refused(run(agent, 'transfers.draft', { ...draft, plates, groups }));
    const noWell = await bad([
      {
        ...draft.groups[0],
        transfers: [
          {
            from: { plate: 'src', well: 'A1' },
            to: { plate: 'assay', well: 'Q1' },
            volume: nL('25'),
          },
        ],
      },
    ]);
    expect(noWell.message).toContain('assay has no well Q1');
    const wrongWay = await bad([
      {
        ...draft.groups[0],
        transfers: [
          {
            from: { plate: 'assay', well: 'A1' },
            to: { plate: 'src', well: 'A2' },
            volume: nL('25'),
          },
        ],
      },
    ]);
    expect(wrongWay.message).toContain("assay is a destination plate, so it can't be drawn from");
    const wrongType = await bad(draft.groups, [
      draft.plates[0],
      { ...draft.plates[1], container: other.id },
    ]);
    expect(wrongType.message).toContain("can't be assay");
    const plan = await run<RecordEnvelope>(agent, 'transfers.draft', draft);
    const pick = await refused(
      run(agent, 'transfers.pick_sources', {
        id: plan.id,
        expectedVersion: plan.version,
        picks: [{ plate: 'assay', container: other.id }],
      }),
    );
    expect(pick.message).toBe('assay is a destination plate, not a source');
    const hidden = await refused(run(otherLab, 'transfers.check', { id: plan.id }));
    expect(hidden).toMatchObject({ code: 'not_found' });
    const hiddenReserved = await refused(
      run(otherLab, 'transfers.reserved', { container: other.id }),
    );
    expect(hiddenReserved).toMatchObject({ code: 'not_found' });
  });
});

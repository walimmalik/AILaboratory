import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Actor, Readiness, RecordEnvelope, WellState } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { inventoryKinds } from '../inventory/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { type EchoRow, echoPickList, readEchoReport } from './echo.ts';
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
    ...plateMapKinds,
    ...fileKinds,
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
    category: 'acoustic_dispenser',
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
    echoPlateTypes: ['384PP_DMSO2'],
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
    const unknown = await refused(
      run(agent, 'transfers.dilution_options', {
        ...input,
        device: { limits: { min: nL('2.5'), max: nL('500'), step: nL('2.5') } },
        stock: { value: '10', unit: 'undefined' },
      }),
    );
    expect(unknown).toMatchObject({ code: 'invalid_input' });
    expect(unknown.message).toContain('Unknown unit "undefined"');
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
  let skipped = false;
  for (const section of kinds.get(record.kind).sections ?? []) {
    // A section the person edited themselves is already theirs (ADR 0056).
    if (await confirmedAlready(current, section.id)) {
      skipped = true;
      continue;
    }
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  // Editing never activates a draft; one Confirm does once every section is confirmed.
  if (skipped && current.status === 'draft') {
    current = await run<RecordEnvelope>(person, 'records.confirm', {
      id: current.id,
      expectedVersion: current.version,
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
      echoPlateTypes: ['Corning_384_3570'],
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
              to: { plate: 'assay', well: 'A3' },
              volume: nL('3'),
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
    expect(byId.get('volumes_fit')?.message).toContain(
      '3 nL is not a whole number of 2.5 nL steps (it would move 2.5 nL)',
    );
    expect(byId.get('volumes_fit')?.message).not.toContain('2.5 nL is not');
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

  it('writes an Echo pick list from a confirmed plan and stores it with the plan version', async () => {
    const { flex, pp, assay, src, draft } = await setup();
    const ppOk = await confirm(pp);
    const assayOk = await confirm(assay);
    const plan = await run<RecordEnvelope>(agent, 'transfers.draft', {
      ...draft,
      plates: [
        {
          id: 'src',
          label: 'Compound source 1',
          role: 'source',
          labwareType: { id: ppOk.id, version: ppOk.version },
          container: src.id,
        },
        {
          id: 'assay',
          label: 'Assay plate 1',
          role: 'destination',
          labwareType: { id: assayOk.id, version: assayOk.version },
        },
      ],
      groups: [
        { ...draft.groups[0], transfers: draft.groups[0]?.transfers.slice(0, 2) },
        {
          id: 'buffer',
          label: 'Flex: buffer into the assay plate',
          method: 'reagent_addition',
          instrument: { instrument: flex.id },
          reason: 'Microlitre volumes',
          tips: 'new_each',
          transfers: [
            {
              from: { plate: 'src', well: 'B1' },
              to: { plate: 'assay', well: 'A1' },
              volume: uL('10'),
            },
          ],
        },
        {
          id: 'mix',
          label: 'By hand: top up',
          method: 'reagent_addition',
          reason: 'One well',
          transfers: [
            {
              from: { plate: 'src', well: 'B1' },
              to: { plate: 'assay', well: 'A2' },
              volume: uL('10'),
            },
          ],
        },
      ],
    });
    const early = await refused(run(agent, 'transfers.export', { id: plan.id }));
    expect(early).toMatchObject({ code: 'invalid_state' });
    expect(early.message).toContain('not confirmed');

    const active = await confirm(plan);
    expect(active.status).toBe('active');
    const out = await run<{
      files: { group: string; file: RecordEnvelope; filename: string; rows: number }[];
      skipped: { group: string; why: string }[];
    }>(agent, 'transfers.export', { id: active.id });
    expect(out.skipped).toEqual([
      {
        group: 'buffer',
        why: 'Flex 1 has no trash bin or waste chute installed; add one with instruments.change_configuration',
      },
      { group: 'mix', why: 'Done by hand; no instrument file' },
    ]);
    expect(out.files).toMatchObject([
      {
        group: 'compounds',
        filename: `TFP-0001 v${active.version} compounds Echo pick list.csv`,
        rows: 2,
      },
    ]);
    const file = out.files[0]?.file as RecordEnvelope;
    expect(file.attributes).toMatchObject({
      mediaType: 'text/csv',
      source: { from: 'export', record: active.id, version: active.version },
    });
    const { text } = await run<{ text: string }>(agent, 'files.get', { id: file.id });
    expect(text).toBe(
      [
        'Source Plate Name,Source Plate Barcode,Source Plate Type,Source Well,Transfer Volume,Destination Plate Name,Destination Plate Barcode,Destination Plate Type,Destination Well',
        `Compound source 1,${src.name},384PP_DMSO2,A1,2500,Assay plate 1,,Corning_384_3570,A1`,
        `Compound source 1,${src.name},384PP_DMSO2,A1,2500,Assay plate 1,,Corning_384_3570,A2`,
        '',
      ].join('\n'),
    );

    const onlyFlex = await refused(
      run(agent, 'transfers.export', { id: active.id, group: 'buffer' }),
    );
    expect(onlyFlex.message).toBe(
      'Flex: buffer into the assay plate: Flex 1 has no trash bin or waste chute installed; add one with instruments.change_configuration',
    );
    const noGroup = await refused(run(agent, 'transfers.export', { id: active.id, group: 'x' }));
    expect(noGroup.message).toBe('TFP-0001 has no group x');
    const hidden = await refused(run(otherLab, 'transfers.export', { id: active.id }));
    expect(hidden).toMatchObject({ code: 'not_found' });
  });

  it('reads an Echo transfer report into the ledger once, and compares a survey with the inventory', async () => {
    const { pp, assay, src, draft } = await setup();
    const ppOk = await confirm(pp);
    const assayOk = await confirm(assay);
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: assayOk.id, containers: [{}] },
    );
    const dest = containers[0] as RecordEnvelope;
    const drafted = await run<RecordEnvelope>(agent, 'transfers.draft', {
      ...draft,
      plates: [
        {
          id: 'src',
          label: 'Compound source 1',
          role: 'source',
          labwareType: { id: ppOk.id, version: ppOk.version },
          container: src.id,
        },
        {
          id: 'assay',
          label: 'Assay plate 1',
          role: 'destination',
          labwareType: { id: assayOk.id, version: assayOk.version },
        },
      ],
      groups: [{ ...draft.groups[0], transfers: draft.groups[0]?.transfers.slice(0, 3) }],
    });
    const upload = async (name: string, text: string) =>
      (
        await run<{ file: RecordEnvelope }>(agent, 'files.upload', {
          name,
          mediaType: 'text/csv',
          text,
        })
      ).file;
    const head =
      'Source Plate Name,Source Plate Barcode,Source Plate Type,Source Well,Destination Plate Name,Destination Plate Barcode,Destination Plate Type,Destination Well,Transfer Volume,Actual Volume,Transfer Status';
    const report = await upload(
      'transfer report.csv',
      [
        'Run ID,1234',
        '[DETAILS]',
        head,
        `Compound source 1,${src.name},384PP_DMSO2,A1,Assay plate 1,${dest.name},Corning_384_3570,A1,2500,2500,`,
        `Compound source 1,${src.name},384PP_DMSO2,A1,Assay plate 1,${dest.name},Corning_384_3570,A2,2500,1000,Insufficient volume`,
        `Compound source 1,${src.name},384PP_DMSO2,A1,Assay plate 1,${dest.name},Corning_384_3570,B9,2500,0,`,
        '',
      ].join('\n'),
    );
    const early = await refused(
      run(agent, 'transfers.import_report', { id: drafted.id, file: report.id }),
    );
    expect(early.message).toContain('not confirmed');
    const plan = await confirm(drafted);

    type Imported = {
      report: string;
      counts: Record<string, number>;
      problems: { kind: string; message: string }[];
      recorded: number;
      event?: string;
      notes: string[];
    };
    const unmatched = await run<Imported>(agent, 'transfers.import_report', {
      id: plan.id,
      file: report.id,
    });
    // Plates match by name, but the assay plate has no container in the plan, so nothing is recorded.
    expect(unmatched.recorded).toBe(0);
    expect(unmatched.counts).toMatchObject({ done: 1, short: 1, notInPlan: 1 });
    expect(unmatched.notes[0]).toBe(
      'Nothing was recorded in the inventory: assay has no container; give them as containers and import again',
    );

    const read = await run<Imported>(agent, 'transfers.import_report', {
      id: plan.id,
      file: report.id,
      containers: [{ plate: 'assay', container: dest.id }],
    });
    expect(read.report).toBe('echo_transfer');
    expect(read.counts).toEqual({
      rows: 3,
      done: 1,
      short: 1,
      failed: 0,
      notInReport: 1,
      notInPlan: 1,
      flagged: 0,
    });
    expect(read.problems.map((p) => p.message)).toEqual([
      'assay A2 got 1000 nL of 2500 nL: Insufficient volume',
      'src A1 to assay B9 is not a planned transfer',
      'assay A3 from src A1 is not in the report',
    ]);
    expect(read.recorded).toBe(2);
    const held = await run<{ wells: { well: string; state: WellState }[] }>(
      person,
      'inventory.wells',
      { container: dest.id },
    );
    expect(held.wells.map((w) => [w.well, w.state.volume])).toEqual([
      ['A1', nL('2500')],
      ['A2', nL('1000')],
    ]);
    const history = await run<{ events: { runLog?: string }[] }>(person, 'inventory.history', {
      container: dest.id,
    });
    expect(history.events[0]?.runLog).toBe(report.id);
    const twice = await refused(
      run(agent, 'transfers.import_report', {
        id: plan.id,
        file: report.id,
        containers: [{ plate: 'assay', container: dest.id }],
      }),
    );
    expect(twice.message).toContain('is already recorded in the inventory');

    // 30 µL less 3.5 µL moved: 26.5 µL. The survey says 20 µL.
    const survey = await upload(
      'survey.csv',
      [
        'Source Plate Name,Source Plate Barcode,Source Plate Type,Source Well,Survey Fluid Volume,Current Fluid Volume,Fluid Composition,Fluid Units,Fluid Type,Survey Status',
        `Compound source 1,${src.name},384PP_DMSO2,A1,20,20,99.1,%,DMSO,`,
        `Compound source 1,${src.name},384PP_DMSO2,B1,0,0,0,%,DMSO,No fluid`,
        `Compound source 1,${src.name},384PP_DMSO2,C1,0,0,0,%,DMSO,`,
      ].join('\n'),
    );
    const surveyed = await run<Imported>(agent, 'transfers.import_report', {
      id: plan.id,
      file: survey.id,
    });
    expect(surveyed).toMatchObject({ report: 'echo_survey', recorded: 0 });
    expect(surveyed.counts.flagged).toBe(2);
    expect(surveyed.problems.map((p) => p.message)).toEqual([
      'src A1: measured 20 µL, the inventory has 26.5 µL',
      'src B1: No fluid',
    ]);

    const notEcho = await upload('notes.csv', 'Well,Value\nA1,3\n');
    const wrong = await refused(
      run(agent, 'transfers.import_report', { id: plan.id, file: notEcho.id }),
    );
    expect(wrong.message).toBe(
      'notes.csv: This is not an Echo report: no Source Plate Name column',
    );
    const hidden = await refused(
      run(otherLab, 'transfers.import_report', { id: plan.id, file: report.id }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('Echo pick list', () => {
  it('writes the lab example exactly', async () => {
    const example = readFileSync(
      fileURLToPath(
        new URL('../../../../seed/worklists/echo-pick-list-single-point.csv', import.meta.url),
      ),
      'utf8',
    );
    const [, ...lines] = example.trimEnd().split('\n');
    const rows = lines.map((line) => {
      const c = line.split(',') as string[];
      return {
        source: { name: c[0], barcode: c[1], type: c[2] },
        sourceWell: c[3],
        volume: c[4],
        destination: { name: c[5], barcode: c[6], type: c[7] },
        destinationWell: c[8],
      } as EchoRow;
    });
    expect(rows).toHaveLength(96);
    expect(echoPickList(rows)).toBe(example);
  });

  it('quotes names that hold commas or quotes', () => {
    const plate = { name: 'Plate "A", left', barcode: '', type: '384PP_DMSO2' };
    const csv = echoPickList([
      { source: plate, sourceWell: 'A1', volume: '2.5', destination: plate, destinationWell: 'B1' },
    ]);
    expect(csv.split('\n')[1]).toBe(
      '"Plate ""A"", left",,384PP_DMSO2,A1,2.5,"Plate ""A"", left",,384PP_DMSO2,B1',
    );
  });
});

describe('transfers.draft_from_plate_map', () => {
  async function setup() {
    const { echo, pp } = await lab();
    const plate96 = await create('Assay 96', 'labware_type', {
      family: 'plate',
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: uL('300'),
    });
    const layout = await confirm(
      await run<RecordEnvelope>(agent, 'layouts.draft', {
        label: '4-point curve',
        wells: 96,
        subjectRole: 'compound',
        subjectRegion: ['rows A-B'],
        subjectSeries: { top: { value: '10', unit: 'uM' }, factor: '10', points: 4 },
        fixed: [{ id: 'dmso', role: 'neutral_control', label: 'DMSO', region: ['H1:H2'] }],
      }),
    );
    const kind = await run<RecordEnvelope>(agent, 'entities.draft_kind', {
      label: 'Compound',
      attributes: { base: 'chemical', prefix: 'CPD', fields: [] },
    });
    const a = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'Staurosporine',
      entityKind: kind.id,
    });
    const b = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'Imatinib',
      entityKind: kind.id,
    });
    const map = await run<RecordEnvelope>(agent, 'platemaps.draft', {
      label: 'Two compounds',
      layout: layout.id,
      labware: { id: plate96.id, version: plate96.version },
      subjects: [{ record: a.id }, { record: b.id }],
    });
    const input = {
      label: 'Two compounds, 4 points',
      map: map.id,
      sourcePlates: [{ id: 'src', labwareType: { id: pp.id, version: pp.version } }],
      sources: [
        { subject: a.id, plate: 'src', well: 'A1', stock: { value: '10', unit: 'mM' } },
        { subject: b.id, plate: 'src', well: 'A2', stock: { value: '10', unit: 'mM' } },
      ],
      solvent: { plate: 'src', well: 'P24' },
      finalVolume: uL('25'),
      maxSolventPercent: '1',
      instrument: { instrument: echo.id },
      why: 'Nanolitre DMSO transfers without tips',
      intermediatePlate: pp.id,
    };
    return { input, a, map };
  }

  type Drafted = {
    plan: RecordEnvelope;
    summary: {
      wells: number;
      fromSource: number;
      fromIntermediates: number;
      intermediateWells: number;
      backfilled: number;
    };
  };

  it('dispenses from the source or intermediates, and backfills every well to the same solvent', async () => {
    const { input } = await setup();
    const out = await run<Drafted>(agent, 'transfers.draft_from_plate_map', input);
    expect(out.summary).toMatchObject({ wells: 8, fromSource: 4, fromIntermediates: 4 });
    expect(out.summary.intermediateWells).toBeGreaterThan(0);
    const groups = (
      out.plan.attributes as {
        groups: {
          id: string;
          transfers: {
            to: { plate: string; well: string };
            volume: { value: string; unit: string };
          }[];
        }[];
      }
    ).groups;
    expect(groups.map((g) => g.id)).toEqual([
      'intermediate_solvent',
      'intermediate_stock',
      'compounds',
      'backfill',
    ]);
    // 10 µM from 10 mM into 25 µL is 25 nL, ten droplets.
    expect(groups[2]?.transfers[0]?.volume).toEqual(nL('25'));
    // The DMSO wells get the full solvent volume by backfill.
    const h1 = groups[3]?.transfers.find((t) => t.to.well === 'H1');
    expect(h1?.volume).toEqual(nL('25'));
    const ready = await run<Readiness>(person, 'records.readiness', { id: out.plan.id });
    // Echo volumes fit, the intermediates' stock in whole droplets too; the intermediate diluent is
    // too much for it, which readiness says.
    expect(ready.checks.find((c) => c.id === 'volumes_fit')?.message).toMatch(
      /^Solvent into the intermediate wells: 2 transfers: .* is above the maximum of 10 µL$/,
    );
    expect(ready.checks.find((c) => c.id === 'intermediates_first')?.passed).toBe(true);
    expect(out.summary.backfilled).toBe(6);
    const flex = (
      await run<{ options: { instrument: { id: string } }[] }>(agent, 'transfers.options', {
        volume: uL('15'),
      })
    ).options[0]?.instrument.id;
    const switched = await run<RecordEnvelope>(agent, 'transfers.set_instrument', {
      id: out.plan.id,
      expectedVersion: out.plan.version,
      group: 'intermediate_solvent',
      instrument: { instrument: flex },
      why: 'Microlitres of DMSO',
    });
    const after = await run<Readiness>(person, 'records.readiness', { id: switched.id });
    expect(after.checks.find((c) => c.id === 'volumes_fit')?.passed).toBe(true);
  });

  it('refuses missing stocks, unreachable points and other labs', async () => {
    const { input, a } = await setup();
    const missing = await refused(
      run(agent, 'transfers.draft_from_plate_map', { ...input, sources: input.sources.slice(1) }),
    );
    expect(missing.message).toContain('Say where the stock is for');
    const tight = await refused(
      run(agent, 'transfers.draft_from_plate_map', { ...input, intermediatePlate: undefined }),
    );
    expect(tight.message).toContain('give the intermediatePlate type');
    const low = await refused(
      run(agent, 'transfers.draft_from_plate_map', {
        ...input,
        sources: input.sources.map((s) =>
          s.subject === a.id ? { ...s, stock: { value: '1', unit: 'uM' } } : s,
        ),
      }),
    );
    expect(low.message).toContain('No route reaches');
    const hidden = await refused(run(otherLab, 'transfers.draft_from_plate_map', input));
    expect(hidden).toMatchObject({ code: 'not_found' });
  });
});

describe('Echo reports', () => {
  const example = (name: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../../../seed/worklists/${name}`, import.meta.url)),
      'utf8',
    );

  it('reads the lab example transfer report and survey', () => {
    const transfer = readEchoReport(example('echo-transfer-report.csv'));
    expect(transfer.report).toBe('echo_transfer');
    expect(transfer.rows).toHaveLength(9);
    expect(transfer.rows[4]).toEqual({
      source: { name: 'Compound source 1', barcode: 'PLT-000101' },
      sourceWell: 'C3',
      destination: { name: 'Assay plate 1', barcode: 'PLT-000201' },
      destinationWell: 'C3',
      requested: '25',
      actual: '0',
      status: 'Insufficient volume',
    });
    const survey = readEchoReport(example('echo-survey-report.csv'));
    expect(survey.report).toBe('echo_survey');
    expect(survey.rows[2]).toEqual({
      plate: { name: 'Compound source 1', barcode: 'PLT-000101' },
      well: 'C3',
      volume: '14.1',
      status: 'Below minimum working volume',
    });
  });

  it('refuses files that are not Echo reports, or hold values that are not numbers', () => {
    expect(() => readEchoReport('a,b\n1,2\n')).toThrow('no Source Plate Name column');
    expect(() =>
      readEchoReport(
        'Source Plate Name,Source Plate Barcode,Source Well,Destination Plate Name,Destination Plate Barcode,Destination Well,Transfer Volume,Actual Volume\nS,,A1,D,,A1,25,lots\n',
      ),
    ).toThrow('Row 1: Actual Volume is "lots", not a number');
  });
});

async function confirmedAlready(record: RecordEnvelope, section: string) {
  const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
  return state.sections.find((s) => s.id === section)?.state === 'confirmed';
}

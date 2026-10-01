import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Actor,
  FlexProtocolRequest,
  FlexProtocolResult,
  ProtocolCheck,
  RecordEnvelope,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
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
import { transferKinds } from './kinds.ts';
import type { ProtocolWriter } from './simulator.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;
let sent: FlexProtocolRequest[];
let simulated: ProtocolCheck;

/** Stands in for the science service: keeps what it was sent, answers with `simulated`. */
const writer: ProtocolWriter = {
  flex: async (request): Promise<FlexProtocolResult> => {
    sent.push(request);
    return { protocol: `# ${request.name}\n`, check: simulated };
  },
};

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
    ...inventoryKinds,
    ...transferKinds,
    ...plateMapKinds,
    ...fileKinds,
  ]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, { protocols: writer });
  sent = [];
  simulated = { ok: true, simulator: '10.0.0', commands: 40, tips: 3 };
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

const uL = (value: string) => ({ value, unit: 'uL' });
const mm = (value: string) => ({ value, unit: 'mm' });
const create = (label: string, kind: string, attributes: unknown) =>
  run<RecordEnvelope>(person, 'records.create', { kind, label, attributes });
const confirm = (r: RecordEnvelope) =>
  run<RecordEnvelope>(person, 'records.confirm', { id: r.id, expectedVersion: r.version });
const pin = (r: RecordEnvelope) => ({ id: r.id, version: r.version });

const sbs = { length: mm('127.76'), width: mm('85.48'), height: mm('14.2'), sbs: true };

/** A Flex with a 1-channel 1000 uL pipette on the left, a module in D1 and the trash in A3. */
async function lab() {
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
      {
        id: 'deck',
        label: 'deck',
        layout: {
          layout: 'slots',
          slots: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'],
        },
        accepts: ['flex_module', 'flex_fixture'],
        changedBy: 'operator',
      },
    ],
  });
  const pipette = (model: string, max: string) =>
    create(model, 'equipment_kind', {
      model,
      role: 'pipette',
      fits: ['flex_pipette'],
      serialized: true,
      capabilities: [
        {
          capability: 'transfer',
          limits: { volume: { min: uL('1'), max: uL(max) }, channels: [1] },
        },
      ],
    });
  const single = await pipette('Flex 1-Channel 1000 uL', '1000');
  const small = await pipette('Flex 1-Channel 50 uL', '50');
  const bin = await create('Flex Trash Bin', 'equipment_kind', {
    role: 'fixture',
    fits: ['flex_fixture'],
    placement: { slots: ['A3', 'D3'] },
    serialized: false,
  });
  const shaker = await create('Heater-Shaker Module GEN1', 'equipment_kind', {
    model: 'Heater-Shaker Module GEN1',
    role: 'module',
    fits: ['flex_module'],
    serialized: true,
  });
  const flex = await run<RecordEnvelope>(person, 'instruments.register', {
    label: 'Flex 1',
    kind: flexKind.id,
    configuration: {
      equipment: [
        { id: 'left', kind: single.id, mount: 'pipettes', placement: { on: 'slot', slot: 'left' } },
        { id: 'trash', kind: bin.id, mount: 'deck', placement: { on: 'slot', slot: 'A3' } },
        { id: 'shaker', kind: shaker.id, mount: 'deck', placement: { on: 'slot', slot: 'D1' } },
      ],
    },
  });
  const tips = async (volume: string) =>
    confirm(
      await create(`Flex filter tips ${volume} uL`, 'labware_type', {
        family: 'tip_rack',
        footprint: { ...sbs, height: mm('99') },
        wells: { layout: 'grid', rows: 8, columns: 12 },
        maxVolume: uL(volume),
        opentronsLoadName: `opentrons_flex_96_filtertiprack_${volume}ul`,
      }),
    );
  await tips('50');
  await tips('200');
  await tips('1000');
  const reservoir = await confirm(
    await create('NEST 12-channel reservoir', 'labware_type', {
      family: 'reservoir',
      footprint: { ...sbs, height: mm('31.4') },
      wells: { layout: 'grid', rows: 1, columns: 12 },
      maxVolume: uL('15000'),
      opentronsLoadName: 'nest_12_reservoir_15ml',
    }),
  );
  const plate = await confirm(
    await create('Corning 96 flat', 'labware_type', {
      family: 'plate',
      footprint: sbs,
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: uL('360'),
      opentronsLoadName: 'corning_96_wellplate_360ul_flat',
    }),
  );
  const { containers } = await run<{ containers: RecordEnvelope[] }>(
    person,
    'inventory.register_containers',
    { labwareType: reservoir.id, containers: [{}] },
  );
  return { flex, small, reservoir, plate, container: containers[0] as RecordEnvelope };
}

async function confirmedPlan(groupsOf?: (flex: RecordEnvelope) => unknown[]) {
  const { flex, reservoir, plate, container, small } = await lab();
  const move = (from: string, to: string, volume: string) => ({
    from: { plate: 'reservoir', well: from },
    to: { plate: 'elisa', well: to },
    volume: uL(volume),
  });
  const draft = await run<RecordEnvelope>(agent, 'transfers.draft', {
    label: 'ELISA buffer',
    plates: [
      {
        id: 'reservoir',
        label: 'Reagent diluent',
        role: 'source',
        labwareType: pin(reservoir),
        container: container.id,
      },
      { id: 'elisa', label: 'ELISA plate', role: 'destination', labwareType: pin(plate) },
    ],
    groups: groupsOf?.(flex) ?? [
      {
        id: 'buffer',
        label: 'Flex: buffer and standards into the ELISA plate',
        method: 'reagent_addition',
        instrument: { instrument: flex.id },
        reason: 'Microlitre volumes',
        tips: 'lab_default',
        transfers: [
          move('A1', 'A1', '100'),
          move('A1', 'B1', '100'),
          move('A2', 'A1', '50'),
          move('A2', 'B1', '250'),
        ],
      },
    ],
  });
  const plan = await confirm(draft);
  expect(plan.status).toBe('active');
  return { plan, flex, small, container, reservoir, plate };
}

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../science/tests/fixtures/${name}`, import.meta.url)),
    'utf8',
  );

describe('Opentrons protocols', () => {
  it('sends the science service the plan as data, the same as its golden request', async () => {
    const { plan, container } = await confirmedPlan();
    const out = await run<{
      files: {
        group: string;
        format: string;
        file: RecordEnvelope;
        filename: string;
        check?: ProtocolCheck;
        deck?: { slot: string; holds: string }[];
      }[];
      skipped: unknown[];
    }>(agent, 'transfers.export', { id: plan.id });

    expect(sent).toHaveLength(1);
    const golden = JSON.parse(fixture('flex-protocol-request.json')) as FlexProtocolRequest;
    const label = `Reagent diluent (${container.name})`;
    // The science service's own tests write this request and run it in the simulator.
    expect(sent[0]).toEqual(golden);

    expect(out.skipped).toEqual([]);
    expect(out.files).toMatchObject([
      {
        group: 'buffer',
        format: 'opentrons_protocol',
        filename: `${plan.name} v${plan.version} buffer Opentrons protocol.py`,
        check: { ok: true, tips: 3 },
        deck: [
          { slot: 'D2', holds: label },
          { slot: 'D3', holds: 'ELISA plate' },
          { slot: 'C1', holds: 'Flex filter tips 1000 uL' },
          { slot: 'A3', holds: 'Trash bin' },
        ],
      },
    ]);
    const file = out.files[0]?.file as RecordEnvelope;
    expect(file.attributes).toMatchObject({
      mediaType: 'text/x-python',
      source: { from: 'export', record: plan.id, version: plan.version },
    });
    const { text } = await run<{ text: string }>(agent, 'files.get', { id: file.id });
    expect(text).toBe(`# ${plan.name} v${plan.version} buffer\n`);
  });

  it('writes a definition for labware Opentrons does not name, and refuses one it cannot', async () => {
    const { plan } = await confirmedPlan();
    const custom = await confirm(
      await create('Lab 96 plate', 'labware_type', {
        family: 'plate',
        footprint: sbs,
        wells: {
          layout: 'grid',
          rows: 8,
          columns: 12,
          a1: { x: mm('14.38'), y: mm('11.24') },
          pitch: mm('9'),
          well: {
            top: { shape: 'circular', diameter: mm('6.86') },
            depth: mm('10.67'),
            bottom: 'flat',
          },
        },
        maxVolume: uL('360'),
      }),
    );
    const bare = await confirm(
      await create('Unmeasured plate', 'labware_type', {
        family: 'plate',
        footprint: sbs,
        wells: { layout: 'grid', rows: 8, columns: 12 },
        maxVolume: uL('360'),
      }),
    );
    const withType = async (type: RecordEnvelope) => {
      const a = plan.attributes as { plates: { id: string }[] };
      const draft = await run<RecordEnvelope>(agent, 'transfers.draft', {
        label: 'ELISA buffer again',
        plates: a.plates.map((p) => (p.id === 'elisa' ? { ...p, labwareType: pin(type) } : p)),
        groups: (plan.attributes as { groups: { device?: unknown }[] }).groups.map(
          ({ device: _device, ...g }) => g,
        ),
      });
      return confirm(draft);
    };
    await run(agent, 'transfers.export', { id: (await withType(custom)).id });
    const definition = sent.at(-1)?.labware.find((l) => l.id === 'elisa')?.definition as {
      namespace: string;
      parameters: { loadName: string };
    };
    expect(definition).toMatchObject({
      namespace: 'custom_beta',
      parameters: { loadName: 'lab_96_plate' },
    });

    const unmeasured = await withType(bare);
    const error = await refused(
      run(agent, 'transfers.export', { id: unmeasured.id, group: 'buffer' }),
    );
    expect(error).toMatchObject({ code: 'invalid_state' });
    expect(error.message).toContain(
      'Unmeasured plate (plate elisa) has no Opentrons load name and no definition can be written from it',
    );
  });

  it('skips a group the simulator stops, and refuses it when asked for by name', async () => {
    const { plan } = await confirmedPlan();
    simulated = { ok: false, simulator: '10.0.0', commands: 0, tips: 0, problem: 'OutOfTipsError' };
    const out = await run<{ files: unknown[]; skipped: unknown[] }>(agent, 'transfers.export', {
      id: plan.id,
    });
    expect(out.files).toEqual([]);
    expect(out.skipped).toEqual([
      { group: 'buffer', why: 'The Opentrons simulator stopped the protocol: OutOfTipsError' },
    ]);
    const one = await refused(run(agent, 'transfers.export', { id: plan.id, group: 'buffer' }));
    expect(one.message).toBe(
      'Flex: buffer and standards into the ELISA plate: The Opentrons simulator stopped the protocol: OutOfTipsError',
    );
  });

  it('takes a new tip per transfer, picks tips the pipette takes, and adds racks as tips run out', async () => {
    const { plan } = await confirmedPlan((flex) => [
      {
        id: 'buffer',
        label: 'Flex: buffer into every well',
        method: 'reagent_addition',
        instrument: { instrument: flex.id },
        reason: 'Microlitre volumes',
        tips: 'new_each',
        transfers: Array.from({ length: 97 }, (_, i) => ({
          from: { plate: 'reservoir', well: 'A1' },
          to: { plate: 'elisa', well: `${'ABCDEFGH'[i % 8]}${(Math.floor(i / 8) % 12) + 1}` },
          volume: uL('20'),
        })),
      },
    ]);
    await run(agent, 'transfers.export', { id: plan.id });
    const request = sent[0] as FlexProtocolRequest;
    expect(request.transfers.every((t) => t.newTip)).toBe(true);
    expect(request.tipRacks).toEqual([
      { loadName: 'opentrons_flex_96_filtertiprack_50ul', slot: 'C1' },
      { loadName: 'opentrons_flex_96_filtertiprack_50ul', slot: 'C2' },
    ]);
    expect(request.pipette).toEqual({
      loadName: 'flex_1channel_1000',
      mount: 'left',
      nozzles: 'all',
    });
  });

  it("refuses a group that says no tips, and reads nothing of another lab's plans", async () => {
    const { plan } = await confirmedPlan((flex) => [
      {
        id: 'buffer',
        label: 'Flex: buffer',
        method: 'reagent_addition',
        instrument: { instrument: flex.id },
        reason: 'Microlitre volumes',
        tips: 'none',
        transfers: [
          {
            from: { plate: 'reservoir', well: 'A1' },
            to: { plate: 'elisa', well: 'A1' },
            volume: uL('20'),
          },
        ],
      },
    ]);
    const all = await run<{ skipped: unknown[] }>(agent, 'transfers.export', { id: plan.id });
    expect(all.skipped).toEqual([
      {
        group: 'buffer',
        why: 'A Flex pipette uses tips, but the group says none; set its tip rule',
      },
    ]);
    const none = await refused(run(agent, 'transfers.export', { id: plan.id, group: 'buffer' }));
    expect(none.message).toBe(
      'Flex: buffer: A Flex pipette uses tips, but the group says none; set its tip rule',
    );
    const hidden = await refused(run(otherLab, 'transfers.export', { id: plan.id }));
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(sent).toHaveLength(0);
  });
});

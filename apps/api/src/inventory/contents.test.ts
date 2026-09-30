import { readFile } from 'node:fs/promises';
import type { Actor, InventoryEvent, Proposal, RecordEnvelope, WellState } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { loadSeedEntities, readSeedEntities } from '../entities/seed.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { loadSeedLabware } from '../labware/seed.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { loadSeedReagents, readSeedReagents } from '../reagents/seed.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { loadSeedContents, readSeedContents } from './contents-seed.ts';
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

type Changed = { event: InventoryEvent; warnings: string[] };
type Wells = { positions: string[]; wells: { well: string; state: WellState }[] };

async function lot(label: string) {
  const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
    label,
    attributes: { category: 'compound', origin: 'bought' },
  });
  return run<RecordEnvelope>(person, 'reagents.receive_lot', {
    product: product.id,
    lotNumber: 'A1',
  });
}

async function lab() {
  const echoType = await run<RecordEnvelope>(person, 'records.create', {
    kind: 'labware_type',
    label: 'Echo 384PP',
    attributes: {
      family: 'plate',
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: { value: '65', unit: 'uL' },
      deadVolume: { value: '15', unit: 'uL' },
    },
  });
  const tubeType = await run<RecordEnvelope>(person, 'records.create', {
    kind: 'labware_type',
    label: 'Tube 1.5 mL',
    attributes: { family: 'tube', maxVolume: { value: '1.5', unit: 'mL' } },
  });
  const boxType = await run<RecordEnvelope>(person, 'records.create', {
    kind: 'labware_type',
    label: 'Box',
    attributes: { family: 'rack', wells: { layout: 'grid', rows: 9, columns: 9 } },
  });
  const register = async (type: RecordEnvelope) =>
    (
      await run<{ containers: RecordEnvelope[] }>(person, 'inventory.register_containers', {
        labwareType: type.id,
        containers: [{}],
      })
    ).containers[0] as RecordEnvelope;
  return {
    source: await register(echoType),
    assay: await register(echoType),
    tube: await register(tubeType),
    box: await register(boxType),
    compound: await lot('Staurosporine'),
    dmso: await lot('DMSO'),
    medium: await lot('DMEM'),
  };
}

const stock = (compound: RecordEnvelope, dmso: RecordEnvelope) => [
  { source: compound.id, concentration: { value: '10', unit: 'mM' } },
  { source: dmso.id, concentration: { value: '100', unit: '%v/v' } },
];

describe('fill, transfer and the ledger', () => {
  it('fills a source plate, transfers into medium, and keeps every step', async () => {
    const { source, assay, compound, dmso, medium } = await lab();
    const filled = await run<Changed>(person, 'inventory.fill', {
      container: source.id,
      fills: [
        {
          wells: ['A3:A4'],
          volume: { value: '40', unit: 'uL' },
          components: stock(compound, dmso),
        },
      ],
      reason: 'Library plated',
    });
    expect(filled.event.lines.map((l) => l.well)).toEqual(['A3', 'A4']);
    await run(person, 'inventory.fill', {
      container: assay.id,
      fills: [
        {
          wells: ['B2'],
          volume: { value: '25', unit: 'uL' },
          components: [{ source: medium.id, concentration: { value: '100', unit: '%v/v' } }],
        },
      ],
    });
    const moved = await run<Changed>(person, 'inventory.transfer', {
      transfers: [
        {
          from: { container: source.id, well: 'A3' },
          to: { container: assay.id, well: 'B2' },
          volume: { value: '25', unit: 'nL' },
        },
      ],
    });
    expect(moved.event.lines.map((l) => [l.change, l.well])).toEqual([
      ['out', 'A3'],
      ['in', 'B2'],
    ]);
    const plate = await run<Wells>(person, 'inventory.wells', { container: assay.id });
    expect(plate.positions).toHaveLength(384);
    const b2 = plate.wells[0]?.state;
    expect(b2?.volume).toEqual({ value: '25.025', unit: 'uL' });
    const byId = Object.fromEntries((b2?.components ?? []).map((c) => [c.source, c.concentration]));
    expect(Number(byId[compound.id]?.value)).toBeCloseTo(0.00999, 5);
    const sourceWells = await run<Wells>(person, 'inventory.wells', { container: source.id });
    expect(sourceWells.wells.map((w) => [w.well, w.state.volume])).toEqual([
      ['A3', { value: '39.975', unit: 'uL' }],
      ['A4', { value: '40', unit: 'uL' }],
    ]);
    const history = await run<{ events: InventoryEvent[] }>(person, 'inventory.history', {
      container: source.id,
      well: 'A3',
    });
    expect(history.events.map((e) => e.type)).toEqual(['transfer', 'fill']);
    expect(history.events[1]?.reason).toBe('Library plated');
    const activity = await run<{ entries: { operationId: string; recordIds: string[] }[] }>(
      person,
      'activity.list',
      {},
    );
    expect(
      activity.entries.find((e) => e.operationId === 'inventory.transfer')?.recordIds.sort(),
    ).toEqual([source.id, assay.id].sort());
  });

  it('refuses overfills, taking too much, wrong wells and things that hold no liquid; warns below dead volume', async () => {
    const { source, tube, box, compound, dmso } = await lab();
    const fill = (container: string, wells: string[], value: string) =>
      run<Changed>(person, 'inventory.fill', {
        container,
        fills: [{ wells, volume: { value, unit: 'uL' }, components: stock(compound, dmso) }],
      });
    const over = await refused(fill(source.id, ['A1'], '70'));
    expect(over.message).toContain('would hold 70 µL, more than its 65 µL');
    await fill(source.id, ['A1'], '40');
    const tooMuch = await refused(
      run(person, 'inventory.consume', {
        container: source.id,
        wells: ['A1'],
        volume: { value: '50', unit: 'uL' },
      }),
    );
    expect(tooMuch.message).toContain('Only 40 uL is there');
    const low = await run<Changed>(person, 'inventory.consume', {
      container: source.id,
      wells: ['A1'],
      volume: { value: '30', unit: 'uL' },
    });
    expect(low.warnings).toEqual([
      'PLT-000001 A1 is left with 10 µL, below its dead volume of 15 µL',
    ]);
    expect((await refused(fill(source.id, ['Q1'], '1'))).message).toContain('There is no well Q1');
    expect((await refused(fill(box.id, ['A1'], '1'))).message).toContain('holds no liquid');
    const tubeFill = await fill(tube.id, ['A1'], '500');
    expect(tubeFill.event.lines[0]?.well).toBe('A1');
    const notALot = await refused(
      run(person, 'inventory.fill', {
        container: tube.id,
        fills: [
          {
            wells: ['A1'],
            volume: { value: '1', unit: 'uL' },
            components: [{ source: 'lot_01M3QZX866A5SB53SPYV40HA9G' }],
          },
        ],
      }),
    );
    expect(notALot.message).toContain('is not a lot or sample in this lab');
    // A failed transfer changes nothing, even its earlier lines.
    await refused(
      run(person, 'inventory.transfer', {
        transfers: [
          {
            from: { container: tube.id, well: 'A1' },
            to: { container: source.id, well: 'B1' },
            volume: { value: '10', unit: 'uL' },
          },
          {
            from: { container: tube.id, well: 'A1' },
            to: { container: source.id, well: 'B2' },
            volume: { value: '1', unit: 'mL' },
          },
        ],
      }),
    );
    const wells = await run<Wells>(person, 'inventory.wells', { container: source.id });
    expect(wells.wells.map((w) => w.well)).toEqual(['A1']);
  });

  it('corrects to a measured state, empties to nothing, and refuses discarded containers', async () => {
    const { tube, compound, dmso } = await lab();
    await run(person, 'inventory.fill', {
      container: tube.id,
      fills: [
        { wells: ['A1'], volume: { value: '200', unit: 'uL' }, components: stock(compound, dmso) },
      ],
    });
    const corrected = await run<Changed>(person, 'inventory.correct', {
      container: tube.id,
      wells: ['A1'],
      state: {
        volume: { value: '180', unit: 'uL' },
        components: [{ source: compound.id, concentration: { value: '9.6', unit: 'mM' } }],
      },
      reason: 'Measured by weight and LC-MS',
    });
    expect(corrected.event.lines[0]?.change).toBe('set');
    await run(person, 'inventory.consume', {
      container: tube.id,
      wells: ['A1'],
      volume: { value: '180', unit: 'uL' },
    });
    expect((await run<Wells>(person, 'inventory.wells', { container: tube.id })).wells).toEqual([]);
    const history = await run<{ events: InventoryEvent[] }>(person, 'inventory.history', {
      container: tube.id,
    });
    expect(history.events.map((e) => e.type)).toEqual(['consume', 'correct', 'fill']);

    const current = await run<RecordEnvelope>(person, 'records.get', { id: tube.id });
    await run(person, 'records.update', {
      id: tube.id,
      expectedVersion: current.version,
      attributes: { ...current.attributes, status: 'discarded' },
    });
    const discarded = await refused(
      run(person, 'inventory.fill', {
        container: tube.id,
        fills: [
          { wells: ['A1'], volume: { value: '1', unit: 'uL' }, components: stock(compound, dmso) },
        ],
      }),
    );
    expect(discarded.message).toContain('is discarded');
  });

  it('proposes agent events, lets agents read, and keeps other labs out', async () => {
    const { tube, compound, dmso } = await lab();
    const proposed = await registry.execute(agent, 'inventory.fill', {
      container: tube.id,
      fills: [
        { wells: ['A1'], volume: { value: '10', unit: 'uL' }, components: stock(compound, dmso) },
      ],
    });
    expect(proposed.status).toBe('proposed');
    expect((await run<Wells>(agent, 'inventory.wells', { container: tube.id })).wells).toEqual([]);
    const hidden = await refused(run(otherLab, 'inventory.wells', { container: tube.id }));
    expect(hidden.message).toContain('is not a container in this lab');
    const foreign = await refused(run(otherLab, 'inventory.history', { container: tube.id }));
    expect(foreign.code).toBe('invalid_input');
  });
});

describe('samples and discarding', () => {
  it('registers a miniprep with its QC, fills a tube with it, and discards the tube', async () => {
    const { tube, box, compound } = await lab();
    const kind = await run<RecordEnvelope>(person, 'entities.draft_kind', {
      label: 'Plasmid',
      attributes: { base: 'dna', prefix: 'PLS', fields: [] },
    });
    const plasmid = await run<RecordEnvelope>(person, 'entities.draft', {
      label: 'pIL6p-luc2',
      entityKind: kind.id,
      fields: {},
    });
    const miniprep = await run<RecordEnvelope>(person, 'samples.register', {
      label: 'pIL6p-luc2 miniprep, colony 1',
      entity: plasmid.id,
      method: 'miniprep',
      made: '2026-09-25',
      qc: [
        { key: 'concentration', value: { value: '185', unit: 'ng/uL' }, method: 'NanoDrop' },
        { key: 'sequence_verified', value: true, method: 'Sanger' },
      ],
    });
    expect(miniprep).toMatchObject({ name: 'SMP-0001', status: 'active' });
    const wrong = await refused(
      run(person, 'samples.register', {
        label: 'Bad',
        entity: plasmid.id,
        method: 'miniprep',
        derivedFrom: ['lot_01M3QZX866A5SB53SPYV40HA9G'],
        qc: [
          { key: 'concentration', value: '1' },
          { key: 'concentration', value: '2' },
        ],
      }),
    );
    expect(wrong.message).toContain('is not a sample or lot in this lab');
    expect(wrong.message).toContain('QC concentration is listed twice');
    const proposed = await registry.execute(agent, 'samples.register', {
      label: 'Proposed prep',
      entity: plasmid.id,
      method: 'miniprep',
    });
    expect(proposed.status).toBe('proposed');

    await run(person, 'inventory.fill', {
      container: tube.id,
      fills: [
        {
          wells: ['A1'],
          volume: { value: '48', unit: 'uL' },
          components: [{ source: miniprep.id, concentration: { value: '185', unit: 'ng/uL' } }],
        },
      ],
    });
    // A box holding the tube can't be discarded.
    const current = await run<RecordEnvelope>(person, 'records.get', { id: tube.id });
    await run(person, 'inventory.move', {
      container: tube.id,
      expectedVersion: current.version,
      to: { container: box.id, position: 'A1' },
    });
    const full = await refused(
      run(person, 'inventory.discard', { container: box.id, expectedVersion: box.version }),
    );
    expect(full.message).toContain('still holds TUB-000001');
    const moved = await run<RecordEnvelope>(person, 'records.get', { id: tube.id });
    const discarded = await run<{ container: RecordEnvelope; event?: InventoryEvent }>(
      person,
      'inventory.discard',
      { container: tube.id, expectedVersion: moved.version, reason: 'Used up' },
    );
    expect(discarded.container.attributes).toMatchObject({ status: 'discarded' });
    expect(discarded.event?.type).toBe('discard');
    expect((await run<Wells>(person, 'inventory.wells', { container: tube.id })).wells).toEqual([]);
    const again = await refused(
      run(person, 'inventory.discard', {
        container: tube.id,
        expectedVersion: discarded.container.version,
      }),
    );
    expect(again.message).toContain('already discarded');
    const emptyBox = await run<{ container: RecordEnvelope; event?: InventoryEvent }>(
      person,
      'inventory.discard',
      { container: box.id, expectedVersion: box.version },
    );
    expect(emptyBox.event).toBeUndefined();
    void compound;
  });
});

describe('stamping and lineage', () => {
  it('maps plates, stamps a 96 into a 384 quadrant, and traces a well back to its lot', async () => {
    const { assay, compound, dmso } = await lab();
    const p96 = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'labware_type',
      label: '96 PP',
      attributes: { family: 'plate', wells: { layout: 'grid', rows: 8, columns: 12 } },
    });
    const [mother] = (
      await run<{ containers: RecordEnvelope[] }>(person, 'inventory.register_containers', {
        labwareType: p96.id,
        containers: [{}],
      })
    ).containers as [RecordEnvelope];

    const byGrid = await run<{ pairs: { from: string; to: string }[]; explanation: string }>(
      agent,
      'inventory.map_plates',
      {
        from: { rows: 8, columns: 12 },
        to: { rows: 16, columns: 24 },
        mapping: { type: 'quadrant', quadrant: 4 },
        wells: ['A1'],
      },
    );
    expect(byGrid.pairs).toEqual([{ from: 'A1', to: 'B2' }]);
    const byPlate = await run<{ pairs: unknown[]; explanation: string }>(
      person,
      'inventory.map_plates',
      { from: mother.id, to: assay.id, mapping: { type: 'quadrant', quadrant: 1 } },
    );
    expect(byPlate.pairs).toHaveLength(96);
    expect(byPlate.explanation).toContain(
      '96 wells of PLT-000003 land on PLT-000002 into quadrant 1',
    );
    const wrong = await refused(
      run(person, 'inventory.map_plates', {
        from: mother.id,
        to: assay.id,
        mapping: { type: 'one_to_one' },
      }),
    );
    expect(wrong.message).toContain('same grid');

    await run(person, 'inventory.fill', {
      container: mother.id,
      fills: [
        {
          wells: ['A1:A2'],
          volume: { value: '50', unit: 'uL' },
          components: stock(compound, dmso),
        },
      ],
    });
    const stamped = await run<Changed>(person, 'inventory.stamp', {
      from: mother.id,
      to: assay.id,
      mapping: { type: 'quadrant', quadrant: 2 },
      volume: { value: '5', unit: 'uL' },
    });
    expect(stamped.event.type).toBe('stamp');
    expect(stamped.event.lines.filter((l) => l.change === 'in').map((l) => l.well)).toEqual([
      'A2',
      'A4',
    ]);
    const self = await refused(
      run(person, 'inventory.stamp', {
        from: mother.id,
        to: mother.id,
        mapping: { type: 'one_to_one' },
        volume: { value: '1', unit: 'uL' },
      }),
    );
    expect(self.message).toContain('onto itself');

    const lineage = await run<{
      steps: { type: string; depth: number; from?: { well: string }; components?: unknown[] }[];
    }>(person, 'inventory.lineage', { container: assay.id, well: 'A4' });
    expect(lineage.steps.map((s) => [s.type, s.depth, s.from?.well])).toEqual([
      ['stamp', 1, 'A2'],
      ['fill', 2, undefined],
    ]);
    expect(lineage.steps[1]?.components).toEqual(stock(compound, dmso));
  });
});

describe('seed contents', () => {
  it('loads the demo lab layer by layer until every container holds what the seed says', async () => {
    const seedFile = (name: string) =>
      readFile(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');
    const [labware, reagentLibrary, entityLibrary, lab, inventory] = (await Promise.all(
      [
        'labware.yaml',
        'reagent-library.yaml',
        'entity-library.yaml',
        'lab.yaml',
        'inventory.yaml',
      ].map(seedFile),
    )) as [string, string, string, string, string];
    const seeder: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    const contents = readSeedContents({ inventory, reagentLibrary, entityLibrary });
    const places = readSeedInventory({ lab, inventory, labware });
    let report: Awaited<ReturnType<typeof loadSeedContents>> | undefined;
    for (let round = 0; round < 8; round++) {
      if (round === 0) {
        await loadSeedLabware(registry, seeder, labware);
        await loadSeedReagents(registry, seeder, readSeedReagents(reagentLibrary));
        await loadSeedEntities(registry, seeder, readSeedEntities(entityLibrary, reagentLibrary));
      }
      await loadSeedInventory(registry, seeder, places);
      report = await loadSeedContents(registry, seeder, contents);
      const { proposals } = await run<{ proposals: Proposal[] }>(person, 'proposals.list', {
        status: 'pending',
      });
      if (proposals.length === 0) break;
      for (const p of proposals) await run(person, 'proposals.approve', { id: p.id });
    }
    expect(report?.samples.existing).toHaveLength(3);
    expect(report?.contents.existing.sort()).toEqual([
      'arp-cells-01',
      'echo-src-lib-01',
      'tube-hibit-brd4-mp2',
      'tube-pil6p-luc2-mp1',
      'tube-stauro-1mm',
    ]);
    const find = async (label: string) =>
      (
        await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
          kind: 'container',
          search: label,
        })
      ).records.find((r) => r.label === label) as RecordEnvelope;
    const source = await find('FDA library source plate 1');
    const arp = await find('Assay-ready plate for HEK293');
    expect(
      (await run<Wells>(person, 'inventory.wells', { container: source.id })).wells,
    ).toHaveLength(384);
    const arpWells = await run<Wells>(person, 'inventory.wells', { container: arp.id });
    expect(arpWells.wells).toHaveLength(384);
    expect(arpWells.wells[0]?.state.volume).toEqual({ value: '25', unit: 'nL' });
    const lineage = await run<{ steps: { type: string }[] }>(person, 'inventory.lineage', {
      container: arp.id,
      well: 'C5',
    });
    expect(lineage.steps.map((s) => s.type)).toEqual(['stamp', 'fill']);
  }, 120_000);
});

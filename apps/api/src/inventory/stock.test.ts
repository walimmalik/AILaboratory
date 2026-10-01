import type { Actor, inventoryOverview, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { inventoryKinds } from './kinds.ts';

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

type Overview = z.infer<typeof inventoryOverview.output>;
const overview = (input: Record<string, unknown> = {}, ctx = person) =>
  run<Overview>(ctx, 'inventory.overview', { today: '2026-10-01', ...input });

async function stockedLab() {
  const tubeType = await run<RecordEnvelope>(person, 'records.create', {
    kind: 'labware_type',
    label: 'Tube 1.5 mL',
    attributes: { family: 'tube', maxVolume: { value: '1.5', unit: 'mL' } },
  });
  const room = await run<RecordEnvelope>(person, 'locations.create', {
    label: 'Cold room',
    type: 'room',
  });
  const freezer = await run<RecordEnvelope>(person, 'locations.create', {
    label: 'Freezer -20 1',
    type: 'freezer',
    parent: room.id,
  });
  const bench = await run<RecordEnvelope>(person, 'locations.create', {
    label: 'Bench 2',
    type: 'bench',
  });
  const { containers } = await run<{ containers: RecordEnvelope[] }>(
    person,
    'inventory.register_containers',
    {
      labwareType: tubeType.id,
      containers: [{ place: { location: freezer.id } }, { place: { location: bench.id } }],
    },
  );
  const [cold, warm] = containers as [RecordEnvelope, RecordEnvelope];
  const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
    label: 'Staurosporine',
    attributes: { category: 'compound', origin: 'bought' },
  });
  const old = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
    product: product.id,
    lotNumber: 'A1',
    expiry: '2026-09-01',
  });
  const fresh = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
    product: product.id,
    lotNumber: 'B2',
    expiry: '2027-03-31',
  });
  for (const [container, lot, volume] of [
    [cold, old, '500'],
    [warm, fresh, '1000'],
  ] as const) {
    await run(person, 'inventory.fill', {
      container: container.id,
      fills: [
        {
          wells: ['A1'],
          volume: { value: volume, unit: 'uL' },
          components: [{ source: lot.id, concentration: { value: '1', unit: 'mM' } }],
        },
      ],
    });
  }
  const { product: unused } = await run<{ product: RecordEnvelope }>(
    person,
    'reagents.draft_product',
    { label: 'Tween 20', attributes: { category: 'detergent', origin: 'bought' } },
  );
  return { room, freezer, bench, cold, warm, product, old, fresh, unused };
}

describe('inventory.overview', () => {
  it('lists each reagent with its lots, where they are, how much is left and the earliest expiry', async () => {
    const lab = await stockedLab();
    const { rows, notInStock } = await overview();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      thing: { id: lab.product.id, label: 'Staurosporine' },
      type: 'reagent',
      category: 'compound',
      amount: { value: '1.5', unit: 'mL' },
      earliestExpiry: '2026-09-01',
      expired: true,
    });
    // Earliest expiry first, each lot with the tube holding it and where that is.
    expect(row?.batches.map((b) => b.batch.id)).toEqual([lab.old.id, lab.fresh.id]);
    expect(row?.batches[0]).toMatchObject({
      number: 'A1',
      state: 'unopened',
      amount: { value: '500', unit: 'uL' },
      containers: [
        {
          container: { id: lab.cold.id },
          wells: 1,
          path: [{ label: 'Cold room' }, { label: 'Freezer -20 1' }],
        },
      ],
    });
    expect(notInStock).toEqual([
      expect.objectContaining({ id: lab.unused.id, type: 'reagent', agentDraft: false }),
    ]);
  });

  it('keeps to a place however deep, and to text and type', async () => {
    const lab = await stockedLab();
    const inRoom = await overview({ place: lab.room.id });
    expect(inRoom.rows[0]?.batches.map((b) => b.batch.id)).toEqual([lab.old.id]);
    expect(inRoom.rows[0]?.amount).toEqual({ value: '500', unit: 'uL' });
    expect(inRoom.notInStock).toEqual([]);
    expect((await overview({ text: 'stauro' })).rows).toHaveLength(1);
    expect((await overview({ text: 'nothing like it' })).rows).toEqual([]);
    expect((await overview({ type: 'materials' })).rows).toEqual([]);
  });

  it('shows an entity and the product it names as one row, with samples and lots', async () => {
    await stockedLab();
    const kind = await run<RecordEnvelope>(person, 'entities.draft_kind', {
      label: 'Cell line',
      attributes: {
        base: 'cells',
        prefix: 'CL',
        fields: [{ key: 'product', label: 'Product', type: { type: 'link', kind: 'product' } }],
      },
    });
    const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
      label: 'HEK293 vial',
      attributes: { category: 'other', origin: 'bought' },
    });
    await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'C3',
    });
    const cells = await run<RecordEnvelope>(agent, 'entities.draft', {
      label: 'HEK293',
      entityKind: kind.id,
      fields: { product: product.id },
    });
    const { rows } = await overview({ type: 'materials' });
    expect(rows).toEqual([
      expect.objectContaining({
        thing: expect.objectContaining({ id: cells.id, agentDraft: true }),
        type: 'material',
        category: 'cell line',
        linked: [expect.objectContaining({ id: product.id })],
      }),
    ]);
    // The product does not show again on its own.
    expect((await overview({ text: 'HEK293 vial' })).rows.map((r) => r.thing.id)).toEqual([
      cells.id,
    ]);
  });

  it('is open to agents, refuses a bad place and reads only its own lab', async () => {
    const lab = await stockedLab();
    expect((await overview({}, agent)).rows).toHaveLength(1);
    await expect(overview({ place: lab.cold.id })).rejects.toThrow();
    expect(await overview({}, otherLab)).toEqual({ rows: [], notInStock: [] });
  });
});

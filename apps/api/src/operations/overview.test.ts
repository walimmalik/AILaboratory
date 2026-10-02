import type { Actor, Connection, RecordEnvelope, RecordOverview } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assayKinds } from '../assays/kinds.ts';
import { createTenant } from '../auth.ts';
import { campaignKinds } from '../campaigns/kinds.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { inventoryKinds } from '../inventory/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { memoryKinds } from '../memory/kinds.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { transferKinds } from '../transfers/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from './index.ts';
import { FALLBACK_KINDS, overviewKinds } from './overview.ts';

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
  for (const kind of [...labwareKinds, ...instrumentKinds, ...inventoryKinds, ...reagentKinds]) {
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

const overview = (id: string, ctx = person) =>
  run<RecordOverview & { id: string }>(ctx, 'records.overview', { id });

const create = (kind: string, label: string, attributes: unknown) =>
  run<RecordEnvelope>(person, 'records.create', { kind, label, attributes });

const text = (o: RecordOverview) => o.identity.map((p) => p.text).join(' · ');
const fact = (o: RecordOverview, label: string) => o.facts.find((f) => f.label === label);

describe('records.overview', () => {
  it('says what a container is, where it is and what it holds', async () => {
    const tube = await create('labware_type', 'Cryovial 2 mL', { family: 'tube' });
    const room = await run<RecordEnvelope>(person, 'locations.create', {
      label: 'Cold room',
      type: 'room',
    });
    const freezer = await run<RecordEnvelope>(person, 'locations.create', {
      label: 'Freezer -80 1',
      type: 'freezer',
      parent: room.id,
      setpoint: { value: '-80', unit: 'degC' },
    });
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: tube.id, containers: [{ place: { location: freezer.id } }] },
    );
    const vial = containers[0] as RecordEnvelope;

    const seen = await overview(vial.id);
    expect(seen.id).toBe(vial.id);
    expect(text(seen)).toContain('in Freezer -80 1');
    // The container is never part of its own place (UX review 2026-10-01, item 23).
    expect(fact(seen, 'where')).toMatchObject({
      value: 'Freezer -80 1',
      record: freezer.id,
      detail: 'Cold room',
    });
    expect(fact(seen, 'holds')?.value).toBe('nothing recorded');
    expect(fact(seen, 'labware')).toMatchObject({ value: 'Cryovial 2 mL', record: tube.id });

    const place = await overview(freezer.id);
    expect(text(place)).toBe('Freezer · -80 °C · in Cold room');
    expect(fact(place, 'holds')?.value).toBe('1 container');
  });

  it('gives a lot its expiry, where it is and its product', async () => {
    const vendor = await create('vendor', 'Cayman Chemical', {});
    const product = await create('product', 'Staurosporine', {
      category: 'compound',
      origin: 'bought',
      form: 'powder',
      vendor: vendor.id,
      catalog: [{ number: '81590' }],
    });
    const lot = await create('lot', 'Staurosporine lot', {
      product: product.id,
      lotNumber: '0612345',
      status: 'unopened',
      expiry: '2020-01-31',
    });

    const seen = await overview(lot.id);
    expect(seen.identity[0]).toEqual({ text: 'Lot of Staurosporine', record: product.id });
    expect(fact(seen, 'expires')).toMatchObject({ value: '31 Jan 2020', tone: 'crit' });
    expect(fact(seen, 'where')?.value).toBe('not in any registered container');
    expect(fact(seen, 'lot number')?.value).toBe('0612345');
    // Its state is said once, in the identity line (N8).
    expect(text(seen)).toContain('unopened');
    expect(fact(seen, 'status')).toBeUndefined();

    const sold = await overview(product.id);
    expect(sold.identity).toContainEqual({ text: 'Cayman Chemical 81590', record: vendor.id });
    expect(fact(sold, 'in stock')).toMatchObject({ value: 'no lot in date', tone: 'warn' });

    const maker = await overview(vendor.id);
    expect(fact(maker, 'reagents')).toMatchObject({ value: '1 product', detail: 'Staurosporine' });
  });

  it('says a lot dispensed into a plate is in use, and where the plate sits against its rule', async () => {
    const plateType = await create('labware_type', 'Echo 384PP', {
      family: 'plate',
      wells: { layout: 'grid', rows: 16, columns: 24 },
    });
    const freezer = await run<RecordEnvelope>(person, 'locations.create', {
      label: 'Freezer -80 1',
      type: 'freezer',
      setpoint: { value: '-80', unit: 'degC' },
    });
    const product = await create('product', 'DMSO', {
      category: 'solvent',
      origin: 'bought',
      storage: { min: { value: '-20', unit: 'degC' }, max: { value: '-20', unit: 'degC' } },
    });
    const lot = await create('lot', 'DMSO lot', {
      product: product.id,
      lotNumber: 'D1',
      status: 'unopened',
    });
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: plateType.id, containers: [{ place: { location: freezer.id } }] },
    );
    const plate = containers[0] as RecordEnvelope;
    await run(person, 'inventory.fill', {
      container: plate.id,
      fills: [
        {
          wells: ['A1', 'A2'],
          volume: { value: '50', unit: 'uL' },
          components: [{ source: lot.id }],
        },
      ],
    });

    const seenLot = await overview(lot.id);
    expect(text(seenLot)).toContain('in use, opening not recorded');
    // The plate by its label; its code is on the page the link opens (codes after names).
    expect(fact(seenLot, 'where')).toMatchObject({ record: plate.id });
    expect(fact(seenLot, 'where')?.value).toContain(plate.label);
    expect(fact(seenLot, 'where')?.value).not.toContain(plate.name);

    const seenPlate = await overview(plate.id);
    expect(fact(seenPlate, 'store')).toMatchObject({
      value: 'at -20 °C',
      detail: 'Freezer -80 1 is at -80 °C',
      tone: 'warn',
    });
  });

  it('says what a labware type is in lab words', async () => {
    const plate = await create('labware_type', 'Corning 3570', {
      family: 'plate',
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: { value: '112', unit: 'uL' },
    });
    const seen = await overview(plate.id);
    expect(seen.identity[0]?.text).toBe('384-well plate');
    expect(fact(seen, 'well holds')?.value).toBe('112 µL');
    expect(fact(seen, 'in the lab')?.value).toBe('none registered');
  });

  it('falls back to simple values for a kind without its own summary', async () => {
    const glycerol = await create('liquid_type', 'Glycerol 50 %', {
      base: 'glycerol',
      foaming: 'low',
    });
    const seen = await overview(glycerol.id);
    expect(seen.identity[0]?.text).toBe('Liquid type');
    expect(fact(seen, 'foaming')?.value).toBe('low');
  });

  it('is open to agents and refuses a bad id or another lab’s record', async () => {
    const vendor = await create('vendor', 'Greiner', {});
    expect(fact(await overview(vendor.id, agent), 'in the library')?.value).toBe(
      'nothing linked to it yet',
    );
    await expect(run(person, 'records.overview', { id: 'not an id' })).rejects.toThrow();
    await expect(run(person, 'records.overview', {})).rejects.toThrow();
    await expect(overview(vendor.id, otherLab)).rejects.toThrow(/not found|no record/i);
  });
});

describe('records.links', () => {
  it('says each relation in words from both ends and names the record at the other end', async () => {
    const vendor = await create('vendor', 'Cayman Chemical', {});
    const product = await create('product', 'Staurosporine', {
      category: 'compound',
      origin: 'bought',
      form: 'powder',
      vendor: vendor.id,
    });

    const based = await run<{ links: Connection[] }>(agent, 'records.links', {
      id: product.id,
      direction: 'from',
    });
    expect(based.links).toEqual([
      expect.objectContaining({
        relation: 'sold_by',
        words: 'sold by',
        other: expect.objectContaining({ id: vendor.id, label: 'Cayman Chemical', kind: 'vendor' }),
      }),
    ]);

    const used = await run<{ links: Connection[] }>(person, 'records.links', {
      id: vendor.id,
      direction: 'to',
    });
    expect(used.links).toEqual([
      expect.objectContaining({
        words: 'sells',
        other: expect.objectContaining({ id: product.id, status: 'draft' }),
      }),
    ]);
    await expect(
      run(person, 'records.links', { id: vendor.id, direction: 'sideways' }),
    ).rejects.toThrow();
    await expect(
      run(otherLab, 'records.links', { id: vendor.id, direction: 'to' }),
    ).rejects.toThrow(/not found|no record/i);
  });
});

describe('overview builders', () => {
  it('cover every kind, or name it as using the fallback on purpose', () => {
    const all = [
      ...labwareKinds,
      ...instrumentKinds,
      ...reagentKinds,
      ...entityKinds,
      ...inventoryKinds,
      ...fileKinds,
      ...libraryKinds,
      ...sopKinds,
      ...campaignKinds,
      ...plateMapKinds,
      ...transferKinds,
      ...memoryKinds,
      ...assayKinds,
    ].map((k) => k.kind);
    const built = new Set(overviewKinds());
    expect(all.filter((k) => !built.has(k) && !FALLBACK_KINDS.has(k))).toEqual([]);
    expect([...FALLBACK_KINDS].filter((k) => !all.includes(k) || built.has(k))).toEqual([]);
  });
});

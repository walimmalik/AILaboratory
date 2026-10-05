import { readFile } from 'node:fs/promises';
import type { Actor, Proposal, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { lot as lotKind, reagentKinds } from './kinds.ts';
import { loadSeedReagents, readSeedReagents } from './seed.ts';

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
  for (const kind of [...labwareKinds, ...instrumentKinds, ...reagentKinds]) kinds.register(kind);
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

const pbs = {
  category: 'buffer',
  origin: 'bought',
  form: 'liquid',
  storage: { min: { value: '15', unit: 'degC' }, max: { value: '25', unit: 'degC' } },
};

async function draft(ctx: RecordContext, label: string, attributes: unknown, components?: unknown) {
  return run<{ product: RecordEnvelope; drafted: RecordEnvelope[] }>(
    ctx,
    'reagents.draft_product',
    { label, attributes, ...(components ? { components } : {}) },
  );
}

describe('reagents.draft_product', () => {
  it('drafts a kit with its new components, linked, with agent values marked assumed', async () => {
    const vendor = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'vendor',
      label: 'R&D Systems',
      attributes: {},
    });
    const { product, drafted } = await draft(
      agent,
      'Human IL-6 DuoSet ELISA',
      {
        category: 'assay_kit',
        origin: 'bought',
        form: 'kit',
        vendor: vendor.id,
        catalog: [{ number: 'DY206', packSize: '15 plates' }],
        storage: { min: { value: '2', unit: 'degC' }, max: { value: '8', unit: 'degC' } },
        handlingRules: [
          {
            rule: 'protect_from_light',
            text: 'Streptavidin-HRP and substrate steps: avoid direct light',
            source: {
              from: 'vendor',
              reference: 'https://resources.rndsystems.com/pdfs/datasheets/dy206.pdf',
            },
            enforced: true,
          },
        ],
      },
      [
        {
          draft: {
            label: 'IL-6 Capture Antibody',
            attributes: {
              category: 'antibody',
              origin: 'bought',
              form: 'lyophilized',
              lotFields: [
                { key: 'workingConcentration', label: 'Working concentration', unit: 'ug/mL' },
              ],
            },
          },
          count: 1,
        },
      ],
    );
    expect(drafted).toHaveLength(1);
    expect(product.status).toBe('draft');
    expect(product.attributes).toMatchObject({
      components: [{ product: drafted[0]?.id, count: 1 }],
    });
    expect(product.evidence.storage).toMatchObject({ source: 'assumed' });

    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: product.id, direction: 'from' },
    );
    expect(links.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toId: vendor.id, relation: 'sold_by' }),
        expect.objectContaining({ toId: drafted[0]?.id, relation: 'has_component' }),
      ]),
    );
  });

  it('flags a lab-made product without a recipe and a bought one without a vendor', async () => {
    const { product } = await draft(person, 'Reagent Diluent', {
      category: 'buffer',
      origin: 'made',
    });
    const readiness = await run<Readiness>(person, 'records.readiness', {
      id: product.id,
    });
    const failing = readiness.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failing).toContain('made_has_recipe');
    const { product: bought } = await draft(person, 'PBS', pbs);
    const other = await run<Readiness>(person, 'records.readiness', {
      id: bought.id,
    });
    expect(other.checks.find((c) => c.id === 'vendor_known')?.passed).toBe(false);
  });

  it('refuses components that are not products in this lab, and malformed rules', async () => {
    const missing = await refused(
      draft(person, 'Kit', { category: 'assay_kit', origin: 'bought' }, [
        { product: 'prd_01J9Z3K8Q4ABCDEFGHJKMNPQRS' },
      ]),
    );
    expect(missing.message).toMatch(/No product prd_/);
    const badRule = await refused(
      draft(person, 'TMB', {
        category: 'substrate',
        origin: 'bought',
        handlingRules: [
          { rule: 'freeze_thaw_limit', text: 'x', source: { from: 'vendor' }, enforced: true },
        ],
      }),
    );
    expect(badRule).toMatchObject({ code: 'invalid_input' });
  });
});

async function diluentRecipe() {
  const { product: bsa } = await draft(person, 'BSA', {
    category: 'blocking_agent',
    origin: 'bought',
    form: 'powder',
  });
  const { product: buffer } = await draft(person, 'PBS', pbs);
  const { product: diluent } = await draft(person, 'Reagent Diluent', {
    category: 'buffer',
    origin: 'made',
    composition: '1% BSA in PBS',
    recipe: {
      yields: { value: '500', unit: 'mL' },
      components: [
        { product: bsa.id, amount: { value: '5', unit: 'g' } },
        { product: buffer.id, amount: { value: '500', unit: 'mL' } },
      ],
      shelfLife: { value: '7', unit: 'd' },
    },
  });
  return { bsa, buffer, diluent };
}

describe('reagents.scale_recipe', () => {
  it('scales a recipe to a target batch', async () => {
    const { diluent } = await diluentRecipe();
    const scaled = await run<{ factor: string; components: { label: string; amount: unknown }[] }>(
      agent,
      'reagents.scale_recipe',
      { product: diluent.id, target: { value: '250', unit: 'mL' } },
    );
    expect(scaled.factor).toBe('0.5');
    expect(scaled.components).toEqual([
      expect.objectContaining({ label: 'BSA', amount: { value: '2.5', unit: 'g' } }),
      expect.objectContaining({ label: 'PBS', amount: { value: '250', unit: 'mL' } }),
    ]);
  });

  it('refuses a product without a recipe and a target in the wrong unit', async () => {
    const { diluent, buffer } = await diluentRecipe();
    const none = await refused(
      run(agent, 'reagents.scale_recipe', {
        product: buffer.id,
        target: { value: '1', unit: 'L' },
      }),
    );
    expect(none.message).toBe('PBS has no recipe');
    const wrong = await refused(
      run(agent, 'reagents.scale_recipe', {
        product: diluent.id,
        target: { value: '1', unit: 'g' },
      }),
    );
    expect(wrong.message).toMatch(/yields volume/);
  });
});

describe('lots', () => {
  it('finds duplicate lot numbers beyond the former 500-record boundary', async () => {
    const product = await antibody();
    const existing = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'duplicate',
    });
    const result = await lotKind.related?.(
      { product: product.id, lotNumber: 'duplicate', status: 'unopened' },
      {
        get: async () => product,
        getVersion: async () => undefined,
        list: async () => [
          ...Array.from({ length: 500 }, (_, i) => ({
            ...existing,
            attributes: { ...existing.attributes, lotNumber: `other-${i}` },
          })),
          existing,
        ],
        actor: person.actor,
        reservedPrefixes: [],
      },
    );
    expect(result?.invalid).toContain(`${product.label} already has lot duplicate`);
  });
  it('refuses wrong-dimensional certificate values through generic creation', async () => {
    const product = await antibody();
    const error = await refused(
      run(person, 'records.create', {
        kind: 'lot',
        label: 'Invalid certificate',
        attributes: {
          product: product.id,
          lotNumber: 'bad',
          status: 'unopened',
          values: [{ field: 'workingConcentration', value: { value: '2', unit: 'nM' } }],
        },
      }),
    );
    expect(error.code).toBe('invalid_attributes');
    expect(error.message).toContain('Working concentration is given in ug/mL, not nM');
  });
  async function antibody() {
    const { product } = await draft(person, 'IL-6 Capture Antibody', {
      category: 'antibody',
      origin: 'bought',
      lotFields: [{ key: 'workingConcentration', label: 'Working concentration', unit: 'ug/mL' }],
    });
    return product;
  }

  it('keeps optional certificates incomplete and applies the same field rules on create and update', async () => {
    const product = await antibody();
    const generic = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'lot',
      label: 'No certificate yet',
      attributes: { product: product.id, lotNumber: 'draft', status: 'unopened' },
    });
    const received = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'received',
      values: undefined,
    });
    for (const values of [
      [{ field: 'unknown', value: { value: '1', unit: 'ug/mL' } }],
      [{ field: 'workingConcentration', value: { value: '1', unit: 'nM' } }],
      [{ field: 'workingConcentration', value: { value: '1', unit: 'invented' } }],
      [{ field: 'workingConcentration', value: { ratio: '1:200' } }],
    ]) {
      for (const ctx of [person, agent]) {
        await expect(
          run(ctx, 'records.create', {
            kind: 'lot',
            label: 'Bad certificate',
            attributes: { product: product.id, lotNumber: 'bad', status: 'unopened', values },
          }),
        ).rejects.toMatchObject({ code: 'invalid_attributes' });
        await expect(
          run(ctx, 'records.update', {
            id: generic.id,
            expectedVersion: generic.version,
            attributes: { ...generic.attributes, values },
          }),
        ).rejects.toMatchObject({ code: 'invalid_attributes' });
      }
      await expect(
        run(person, 'reagents.receive_lot', {
          product: product.id,
          lotNumber: 'bad',
          values,
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
    }
    const updated = await run<RecordEnvelope>(person, 'records.update', {
      id: generic.id,
      expectedVersion: generic.version,
      attributes: {
        ...generic.attributes,
        values: [{ field: 'workingConcentration', value: { value: '0.002', unit: 'mg/mL' } }],
      },
    });
    expect(updated.version).toBe(2);
    expect(received.attributes.values).toBeUndefined();
    const { product: noFields } = await draft(person, 'PBS', pbs);
    await expect(
      run(person, 'records.create', {
        kind: 'lot',
        label: 'Undefined field map',
        attributes: {
          product: noFields.id,
          lotNumber: 'bad',
          status: 'unopened',
          values: [{ field: 'stock', value: { ratio: '1:200' } }],
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
  });

  it('checks product and component membership in this lab for generic and specialized writes', async () => {
    const component = await antibody();
    const { product: kit } = await draft(
      person,
      'Kit',
      {
        category: 'assay_kit',
        origin: 'bought',
      },
      [{ product: component.id }],
    );
    const componentLot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: component.id,
      lotNumber: 'component',
    });
    const { product: unrelated } = await draft(person, 'PBS', pbs);
    const unrelatedLot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: unrelated.id,
      lotNumber: 'unrelated',
    });
    const { product: foreign } = await draft(otherLab, 'Foreign', pbs);
    const foreignLot = await run<RecordEnvelope>(otherLab, 'reagents.receive_lot', {
      product: foreign.id,
      lotNumber: 'foreign',
    });
    const valid = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'lot',
      label: 'Valid kit',
      attributes: {
        product: kit.id,
        lotNumber: 'kit',
        status: 'unopened',
        componentLots: [componentLot.id],
      },
    });
    for (const componentLots of [[unrelatedLot.id], [foreignLot.id]]) {
      await expect(
        run(person, 'records.create', {
          kind: 'lot',
          label: 'Invalid kit',
          attributes: { ...valid.attributes, lotNumber: 'bad', componentLots },
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
      await expect(
        run(person, 'records.update', {
          id: valid.id,
          expectedVersion: valid.version,
          attributes: { ...valid.attributes, componentLots },
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
      await expect(
        run(person, 'reagents.receive_lot', { product: kit.id, lotNumber: 'bad', componentLots }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
    }
    await expect(
      run(person, 'records.create', {
        kind: 'lot',
        label: 'Foreign product',
        attributes: { product: foreign.id, lotNumber: 'bad', status: 'unopened' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      run(otherLab, 'records.update', {
        id: valid.id,
        expectedVersion: valid.version,
        attributes: valid.attributes,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      run(otherLab, 'records.restore', {
        id: valid.id,
        expectedVersion: valid.version,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses duplicate identity on create, update, restore and agent approval without counting itself', async () => {
    const product = await antibody();
    const first = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'A',
    });
    const moved = await run<RecordEnvelope>(person, 'records.update', {
      id: first.id,
      expectedVersion: first.version,
      attributes: { ...first.attributes, lotNumber: 'B' },
    });
    const second = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'lot',
      label: 'A',
      attributes: first.attributes,
    });
    await expect(
      run(person, 'records.create', {
        kind: 'lot',
        label: 'Duplicate',
        attributes: second.attributes,
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      run(person, 'records.update', {
        id: moved.id,
        expectedVersion: moved.version,
        attributes: first.attributes,
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      run(person, 'records.restore', { id: moved.id, expectedVersion: moved.version, version: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    const changed = await run<RecordEnvelope>(person, 'records.update', {
      id: moved.id,
      expectedVersion: moved.version,
      attributes: { ...moved.attributes, notes: 'Updated' },
    });
    const restored = await run<RecordEnvelope>(person, 'records.restore', {
      id: changed.id,
      expectedVersion: changed.version,
      version: 2,
    });
    expect(restored.attributes.lotNumber).toBe('B');
    const proposed = await registry.execute(agent, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'C',
    });
    expect(proposed.status).toBe('proposed');
    if (proposed.status !== 'proposed') throw new Error('Expected proposal');
    await run(person, 'reagents.receive_lot', { product: product.id, lotNumber: 'C' });
    const failed = await run<Proposal>(person, 'proposals.approve', { id: proposed.proposal.id });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'invalid_attributes' } });
  });

  it('rechecks certificate values on restore and specialized status updates after the product changes', async () => {
    const product = await antibody();
    const received = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'A',
      values: [{ field: 'workingConcentration', value: { value: '2', unit: 'ug/mL' } }],
    });
    const edited = await run<RecordEnvelope>(person, 'records.update', {
      id: received.id,
      expectedVersion: received.version,
      attributes: { ...received.attributes, notes: 'Updated' },
    });
    await run(person, 'records.update', {
      id: product.id,
      expectedVersion: product.version,
      attributes: {
        ...product.attributes,
        lotFields: [{ key: 'workingConcentration', label: 'Working concentration', unit: 'nM' }],
      },
    });
    await expect(
      run(person, 'records.restore', {
        id: received.id,
        expectedVersion: edited.version,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      run(person, 'reagents.set_lot_status', {
        id: received.id,
        expectedVersion: edited.version,
        status: 'opened',
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
  });

  it('records a lot with its certificate values, and moves it through its statuses', async () => {
    const product = await antibody();
    const lot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'P123456',
      expiry: '2027-06-30',
      received: '2026-09-29',
      values: [{ field: 'workingConcentration', value: { value: '2', unit: 'ug/mL' } }],
    });
    expect(lot).toMatchObject({
      status: 'active',
      label: 'IL-6 Capture Antibody, lot P123456',
      attributes: { status: 'unopened' },
    });
    const opened = await run<RecordEnvelope>(person, 'reagents.set_lot_status', {
      id: lot.id,
      expectedVersion: 1,
      status: 'opened',
      date: '2026-09-30',
    });
    expect(opened.attributes).toMatchObject({ status: 'opened', opened: '2026-09-30' });
  });

  it('refuses unknown fields, wrong units, a repeated lot number and foreign component lots', async () => {
    const product = await antibody();
    const wrong = await refused(
      run(person, 'reagents.receive_lot', {
        product: product.id,
        lotNumber: 'A1',
        values: [
          { field: 'stock', value: { value: '1', unit: 'mg/mL' } },
          { field: 'workingConcentration', value: { value: '2', unit: 'nM' } },
        ],
      }),
    );
    expect(wrong.message).toContain('has no lot field "stock" (it has workingConcentration)');
    expect(wrong.message).toContain('Working concentration is given in ug/mL, not nM');

    await run(person, 'reagents.receive_lot', { product: product.id, lotNumber: 'A1' });
    const again = await refused(
      run(person, 'reagents.receive_lot', { product: product.id, lotNumber: 'A1' }),
    );
    expect(again.message).toContain('already has lot A1');

    const { diluent, bsa } = await diluentRecipe();
    const bsaLot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: bsa.id,
      lotNumber: 'B7',
    });
    const antibodyLot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'A2',
    });
    const batch = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: diluent.id,
      lotNumber: '2026-09-30-1',
      made: '2026-09-30',
      componentLots: [bsaLot.id],
    });
    expect(batch.attributes).toMatchObject({ componentLots: [bsaLot.id] });
    const foreign = await refused(
      run(person, 'reagents.receive_lot', {
        product: diluent.id,
        lotNumber: '2026-09-30-2',
        componentLots: [antibodyLot.id],
      }),
    );
    expect(foreign.message).toContain("is not a lot of one of Reagent Diluent's recipe components");
  });

  it('proposes an agent lot and status change, and keeps other labs out', async () => {
    const product = await antibody();
    const proposed = await registry.execute(agent, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'X',
    });
    expect(proposed.status).toBe('proposed');
    const lot = await run<RecordEnvelope>(person, 'reagents.receive_lot', {
      product: product.id,
      lotNumber: 'Y',
    });
    const status = await registry.execute(agent, 'reagents.set_lot_status', {
      id: lot.id,
      expectedVersion: 1,
      status: 'quarantined',
    });
    expect(status.status).toBe('proposed');
    const hidden = await refused(
      run(otherLab, 'reagents.set_lot_status', {
        id: lot.id,
        expectedVersion: 1,
        status: 'expired',
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
    const dated = await refused(
      run(person, 'reagents.set_lot_status', {
        id: lot.id,
        expectedVersion: 1,
        status: 'expired',
        date: '2026-09-30',
      }),
    );
    expect(dated.message).toBe('A date goes with status opened only');
  });
});

describe('reagents.search', () => {
  it('filters by text, storage and lots in date, with each lot summary', async () => {
    const { product: buffer } = await draft(person, 'PBS', {
      ...pbs,
      catalog: [{ number: '10010-023' }],
    });
    const { product: antibody } = await draft(person, 'IL-6 Detection Antibody', {
      category: 'antibody',
      origin: 'bought',
      storage: { min: { value: '2', unit: 'degC' }, max: { value: '8', unit: 'degC' } },
    });
    for (const [lotNumber, expiry] of [
      ['L1', '2026-10-10'],
      ['L2', '2027-03-01'],
      ['L3', '2026-09-01'],
    ]) {
      await run(person, 'reagents.receive_lot', { product: antibody.id, lotNumber, expiry });
    }
    type Found = {
      products: { product: RecordEnvelope; storage?: string; lots: unknown }[];
      total: number;
    };
    const today = '2026-09-30';
    const all = await run<Found>(person, 'reagents.search', { today });
    expect(all.total).toBe(2);
    const byCatalog = await run<Found>(person, 'reagents.search', { text: '10010', today });
    expect(byCatalog.products.map((p) => p.product.id)).toEqual([buffer.id]);
    expect(byCatalog.products[0]?.storage).toBe('room');

    const cold = await run<Found>(person, 'reagents.search', { storage: 'fridge', today });
    expect(cold.products).toEqual([
      expect.objectContaining({
        storage: 'fridge',
        lots: { count: 3, inDate: 2, nextExpiry: '2026-10-10' },
      }),
    ]);
    const inDate = await run<Found>(person, 'reagents.search', { inDate: true, today });
    expect(inDate.products.map((p) => p.product.id)).toEqual([antibody.id]);
    const soon = await run<Found>(person, 'reagents.search', { expiringWithinDays: 5, today });
    expect(soon.total).toBe(0);
    const month = await run<Found>(person, 'reagents.search', { expiringWithinDays: 30, today });
    expect(month.total).toBe(1);
    const limited = await run<Found>(person, 'reagents.search', { limit: 1, today });
    expect(limited).toMatchObject({ total: 2 });
    expect(limited.products).toHaveLength(1);

    const elsewhere = await run<Found>(otherLab, 'reagents.search', { today });
    expect(elsewhere.total).toBe(0);
  });

  it('refuses unknown filters and malformed values', async () => {
    await refused(run(person, 'reagents.search', { storage: 'cold' }));
    await refused(run(person, 'reagents.search', { color: 'red' }));
    await refused(run(person, 'reagents.search', { today: '30/09/2026' }));
  });
});

describe('seed reagent library', () => {
  it('drafts every product once with sources, kits linked, and proposes the lots', async () => {
    const library = readSeedReagents(
      await readFile(new URL('../../../../seed/reagent-library.yaml', import.meta.url), 'utf8'),
    );
    const seeder: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    const report = await loadSeedReagents(registry, seeder, library);
    expect(report.liquidTypes.created).toHaveLength(library.liquid_types.length);
    expect(report.products.created).toHaveLength(library.products.length);
    expect(report.lots.proposed).toHaveLength(library.lots.length);
    const again = await loadSeedReagents(registry, seeder, library);
    expect(again.products.existing).toHaveLength(library.products.length);
    expect(again.lots.existing).toHaveLength(library.lots.length);
    expect(again.lots.proposed).toEqual([]);

    const { records } = await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
      kind: 'product',
      limit: 200,
    });
    // No seed product fails a blocker; what is left is for a person to confirm.
    for (const record of records) {
      const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
      const blockers = state.checks.filter((c) => !c.passed && c.severity === 'blocker');
      expect([record.label, blockers.map((c) => c.message)]).toEqual([record.label, []]);
    }
    const byLabel = new Map(records.map((r) => [r.label, r]));
    const duoset = byLabel.get('Human IL-6 DuoSet ELISA') as RecordEnvelope;
    expect(duoset.evidence.storage).toMatchObject({ source: 'datasheet' });
    expect(duoset.evidence.components).toMatchObject({ source: 'datasheet' });
    expect((duoset.attributes as { components: unknown[] }).components).toHaveLength(4);
    const diluent = byLabel.get('Reagent Diluent (1% BSA in PBS)') as RecordEnvelope;
    expect(diluent.evidence.recipe).toMatchObject({ source: 'assumed' });
    const scaled = await run<{ components: { amount: unknown }[] }>(
      agent,
      'reagents.scale_recipe',
      {
        product: diluent.id,
        target: { value: '100', unit: 'mL' },
      },
    );
    expect(scaled.components[0]?.amount).toEqual({ value: '1', unit: 'g' });

    // A person approves the DuoSet lot; its certificate values arrive with it.
    const { proposals } = await run<{ proposals: Proposal[] }>(person, 'proposals.list', {
      status: 'pending',
    });
    const duosetLot = proposals.find(
      (p) => (p.input as { lotNumber: string }).lotNumber === 'DEMO-P123456',
    ) as Proposal;
    const approved = await run<Proposal>(person, 'proposals.approve', { id: duosetLot.id });
    expect(approved.status).toBe('approved');
    const lots = await run<{ records: RecordEnvelope[] }>(person, 'records.list', { kind: 'lot' });
    expect(lots.records[0]?.attributes).toMatchObject({
      product: duoset.id,
      values: expect.arrayContaining([
        { field: 'captureWorkingConcentration', value: { value: '2', unit: 'ug/mL' } },
      ]),
    });
  });
});

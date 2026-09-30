import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
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
import { reagentKinds } from './kinds.ts';

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
  async function antibody() {
    const { product } = await draft(person, 'IL-6 Capture Antibody', {
      category: 'antibody',
      origin: 'bought',
      lotFields: [{ key: 'workingConcentration', label: 'Working concentration', unit: 'ug/mL' }],
    });
    return product;
  }

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

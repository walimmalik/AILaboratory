import {
  type EvidenceInput,
  KitComponent,
  LiquidTypeAttributes,
  LotAttributes,
  ProductAttributes,
  type Proposal,
  Quantity,
  Recipe,
  type RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns `seed/reagent-library.yaml` into liquid types, product drafts and lot proposals (plan 009a).
 * A product's first datasheet is the evidence for every attribute except those it lists as assumed.
 * Entries name each other by key: kits their components, recipes their ingredients, products their
 * liquid type, lots their product.
 */

const Key = z.string().min(1);

const LiquidTypeEntry = z.strictObject({
  key: Key,
  label: z.string().min(1),
  attributes: LiquidTypeAttributes,
});

const ProductEntry = z.strictObject({
  key: Key,
  label: z.string().min(1),
  vendor: z.string().min(1).optional(),
  assumed: z.array(z.string().min(1)).optional(),
  attributes: ProductAttributes.omit({
    vendor: true,
    liquidType: true,
    recipe: true,
    components: true,
  }).extend({
    liquidType: Key.optional(),
    recipe: Recipe.omit({ components: true })
      .extend({ components: z.array(z.strictObject({ component: Key, amount: Quantity })).min(1) })
      .optional(),
  }),
  components: z.array(KitComponent.omit({ product: true }).extend({ component: Key })).optional(),
});

const LotEntry = z.strictObject({
  key: Key,
  ...LotAttributes.pick({
    lotNumber: true,
    expiry: true,
    received: true,
    values: true,
    notes: true,
  }).shape,
  product: Key,
});

const Library = z.strictObject({
  liquid_types: z.array(LiquidTypeEntry),
  products: z.array(ProductEntry),
  lots: z.array(LotEntry),
});
export type SeedReagents = z.infer<typeof Library>;

/** Reads the library file, refusing one that doesn't parse or names a key it doesn't have. */
export function readSeedReagents(yaml: string): SeedReagents {
  const library = Library.parse(parse(yaml));
  const types = new Set(library.liquid_types.map((t) => t.key));
  const seen = new Set<string>();
  for (const p of library.products) {
    const uses = [
      ...(p.components ?? []).map((c) => c.component),
      ...(p.attributes.recipe?.components ?? []).map((c) => c.component),
    ];
    for (const key of uses) {
      if (!seen.has(key)) throw new Error(`${p.key}: "${key}" must come earlier in the file`);
    }
    if (p.attributes.liquidType && !types.has(p.attributes.liquidType)) {
      throw new Error(`${p.key}: no liquid type "${p.attributes.liquidType}"`);
    }
    if (seen.has(p.key)) throw new Error(`${p.key} appears twice`);
    seen.add(p.key);
  }
  for (const lot of library.lots) {
    if (!seen.has(lot.product)) throw new Error(`${lot.key}: no product "${lot.product}"`);
  }
  return library;
}

export interface ReagentSeedReport {
  liquidTypes: { created: string[]; existing: string[] };
  products: { created: string[]; existing: string[] };
  /** Lots proposed for a person to approve, and those already recorded or waiting. */
  lots: { proposed: string[]; existing: string[] };
}

/**
 * Creates what the lab doesn't have yet, matched by kind and label, through the operations people
 * and agents use. Lots go through reagents.receive_lot; run as an agent, they wait on Review.
 */
export async function loadSeedReagents(
  registry: OperationRegistry,
  ctx: RecordContext,
  library: SeedReagents,
): Promise<ReagentSeedReport> {
  const call = (operation: string, input: unknown) => registry.execute(ctx, operation, input);
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await call(operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const byLabel = async (kind: string) => new Map((await list(kind)).map((r) => [r.label, r]));
  const reason = 'Seed lab (plan 006), loaded by plan 009';
  const report: ReagentSeedReport = {
    liquidTypes: { created: [], existing: [] },
    products: { created: [], existing: [] },
    lots: { proposed: [], existing: [] },
  };

  const typeId = new Map<string, string>();
  const types = await byLabel('liquid_type');
  for (const entry of library.liquid_types) {
    const earlier = types.get(entry.label);
    if (earlier) {
      typeId.set(entry.key, earlier.id);
      report.liquidTypes.existing.push(entry.key);
      continue;
    }
    const record = await run<RecordEnvelope>('records.create', {
      kind: 'liquid_type',
      label: entry.label,
      attributes: entry.attributes,
      reason,
    });
    typeId.set(entry.key, record.id);
    report.liquidTypes.created.push(`${record.name} ${entry.key}`);
  }

  const productId = new Map<string, string>();
  const products = await byLabel('product');
  const vendors = new Map((await list('vendor')).map((v) => [v.label.toLowerCase(), v.id]));
  const idOf = (key: string) => productId.get(key) as string;
  for (const entry of library.products) {
    const earlier = products.get(entry.label);
    if (earlier) {
      productId.set(entry.key, earlier.id);
      report.products.existing.push(entry.key);
      continue;
    }
    const { liquidType, recipe, ...rest } = entry.attributes;
    const attributes: Record<string, unknown> = {
      ...rest,
      ...(liquidType ? { liquidType: typeId.get(liquidType) } : {}),
      ...(recipe
        ? {
            recipe: {
              ...recipe,
              components: recipe.components.map((c) => ({
                product: idOf(c.component),
                amount: c.amount,
              })),
            },
          }
        : {}),
    };
    const reference = entry.attributes.datasheets?.[0];
    const assumed = new Set(entry.assumed ?? []);
    const evidence: Record<string, EvidenceInput> = {};
    if (reference) {
      for (const field of [
        ...Object.keys(attributes),
        ...(entry.components ? ['components'] : []),
      ]) {
        if (assumed.has(field)) continue;
        evidence[field] = {
          source: 'datasheet',
          reference,
          note: 'Seed data (seed/reagents.yaml)',
        };
      }
    }
    if (entry.vendor) {
      let vendorId = vendors.get(entry.vendor.toLowerCase());
      if (!vendorId) {
        const vendor = await run<RecordEnvelope>('records.create', {
          kind: 'vendor',
          label: entry.vendor,
          attributes: {},
          reason,
        });
        vendorId = vendor.id;
        vendors.set(entry.vendor.toLowerCase(), vendorId);
      }
      attributes.vendor = vendorId;
      evidence.vendor = { source: 'imported', reference: 'seed/reagent-library.yaml' };
    }
    const { product } = await run<{ product: RecordEnvelope }>('reagents.draft_product', {
      label: entry.label,
      attributes,
      ...(entry.components
        ? {
            components: entry.components.map(({ component, ...amounts }) => ({
              product: idOf(component),
              ...amounts,
            })),
          }
        : {}),
      evidence,
      reason,
    });
    productId.set(entry.key, product.id);
    report.products.created.push(`${product.name} ${entry.key}`);
  }

  // Lots already recorded, or already proposed and waiting, are left alone.
  const recorded = new Set(
    (await list('lot')).map((r) => {
      const a = r.attributes as { product: string; lotNumber: string };
      return `${a.product}/${a.lotNumber}`;
    }),
  );
  const pending = await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' });
  for (const p of pending.proposals) {
    if (p.operationId !== 'reagents.receive_lot') continue;
    const input = p.input as { product: string; lotNumber: string };
    recorded.add(`${input.product}/${input.lotNumber}`);
  }
  for (const { key, product, ...lot } of library.lots) {
    const id = idOf(product);
    if (recorded.has(`${id}/${lot.lotNumber}`)) {
      report.lots.existing.push(key);
      continue;
    }
    const result = await call('reagents.receive_lot', { product: id, ...lot, reason });
    if (result.status === 'preview') throw new Error('reagents.receive_lot was only previewed');
    report.lots.proposed.push(`${key}${result.status === 'done' ? ' (recorded)' : ''}`);
  }
  return report;
}

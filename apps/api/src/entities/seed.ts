import {
  EntityAttributes,
  EntityKindAttributes,
  type EvidenceInput,
  type RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns `seed/entity-library.yaml` into entity kind and entity drafts (plan 010a). Entities name
 * their kind, parent entity and product by key, and their vendor by name.
 */

const Key = z.string().min(1);

const KindEntry = z.strictObject({
  key: Key,
  label: z.string().min(1),
  attributes: EntityKindAttributes,
});

const EntityEntry = z.strictObject({
  key: Key,
  kind: Key,
  label: z.string().min(1),
  vendor: z.string().min(1).optional(),
  product: Key.optional(),
  parent: Key.optional(),
  sources: z.array(z.url()).optional(),
  estimated: z.array(Key).optional(),
  ...EntityAttributes.pick({ synonyms: true, handlingRules: true, notes: true }).shape,
  fields: EntityAttributes.shape.fields,
});

const Library = z.strictObject({
  kinds: z.array(KindEntry),
  entities: z.array(EntityEntry),
});

export interface SeedEntities {
  kinds: z.infer<typeof KindEntry>[];
  entities: z.infer<typeof EntityEntry>[];
  /** Product key in reagent-library.yaml to its label. */
  products: Map<string, string>;
}

/** Reads the library file, refusing one that names a kind, parent or product it doesn't have. */
export function readSeedEntities(yaml: string, reagentLibrary: string): SeedEntities {
  const library = Library.parse(parse(yaml));
  const products = new Map(
    (parse(reagentLibrary) as { products: { key: string; label: string }[] }).products.map((p) => [
      p.key,
      p.label,
    ]),
  );
  const kinds = new Set(library.kinds.map((k) => k.key));
  const seen = new Set<string>();
  for (const e of library.entities) {
    if (!kinds.has(e.kind)) throw new Error(`${e.key}: no kind "${e.kind}"`);
    if (e.parent && !seen.has(e.parent)) {
      throw new Error(`${e.key}: parent "${e.parent}" must come earlier in the file`);
    }
    if (e.product && !products.has(e.product)) {
      throw new Error(`${e.key}: no product "${e.product}" in reagent-library.yaml`);
    }
    for (const field of e.estimated ?? []) {
      if (!(field in e.fields)) throw new Error(`${e.key}: estimated "${field}" has no value`);
    }
    if (seen.has(e.key)) throw new Error(`${e.key} appears twice`);
    seen.add(e.key);
  }
  return { ...library, products };
}

export interface EntitySeedReport {
  kinds: { created: string[]; existing: string[] };
  entities: { created: string[]; existing: string[] };
}

/** Drafts what the lab doesn't have yet (kinds by label, entities by label within their kind). */
export async function loadSeedEntities(
  registry: OperationRegistry,
  ctx: RecordContext,
  { kinds, entities, products }: SeedEntities,
): Promise<EntitySeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = async (kind: string, search?: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', {
        kind,
        limit: 200,
        ...(search ? { search } : {}),
      })
    ).records;
  const reason = 'Seed lab (plan 006), loaded by plan 010a';
  const report: EntitySeedReport = {
    kinds: { created: [], existing: [] },
    entities: { created: [], existing: [] },
  };

  const kindId = new Map<string, string>();
  const existingKinds = new Map((await list('entity_kind')).map((k) => [k.label, k.id]));
  for (const entry of kinds) {
    const earlier = existingKinds.get(entry.label);
    if (earlier) {
      kindId.set(entry.key, earlier);
      report.kinds.existing.push(entry.key);
      continue;
    }
    const record = await run<RecordEnvelope>('entities.draft_kind', {
      label: entry.label,
      attributes: entry.attributes,
      reason,
    });
    kindId.set(entry.key, record.id);
    report.kinds.created.push(`${record.name} ${entry.label}`);
  }

  const vendors = new Map((await list('vendor')).map((v) => [v.label.toLowerCase(), v.id]));
  const vendorId = async (label: string) => {
    let id = vendors.get(label.toLowerCase());
    if (!id) {
      id = (
        await run<RecordEnvelope>('records.create', {
          kind: 'vendor',
          label,
          attributes: {},
          reason,
        })
      ).id;
      vendors.set(label.toLowerCase(), id);
    }
    return id;
  };
  const productId = async (key: string) => {
    const label = products.get(key) as string;
    const found = (await list('product', label)).find((p) => p.label === label);
    if (!found) throw new Error(`Load the reagent library first: no product "${label}"`);
    return found.id;
  };

  const entityId = new Map<string, string>();
  const existing = await list('entity');
  for (const entry of entities) {
    const kind = kindId.get(entry.kind) as string;
    const earlier = existing.find(
      (e) => e.label === entry.label && (e.attributes as EntityAttributes).entityKind === kind,
    );
    if (earlier) {
      entityId.set(entry.key, earlier.id);
      report.entities.existing.push(entry.key);
      continue;
    }
    const fields = {
      ...entry.fields,
      ...(entry.vendor ? { vendor: await vendorId(entry.vendor) } : {}),
      ...(entry.product ? { product: await productId(entry.product) } : {}),
      ...(entry.parent ? { parent: entityId.get(entry.parent) as string } : {}),
    };
    const reference = entry.sources?.[0];
    const evidence: Record<string, EvidenceInput> = {};
    if (reference) {
      const cited: EvidenceInput = {
        source: 'datasheet',
        reference,
        note: 'Seed data (seed/entities.yaml)',
      };
      for (const field of ['synonyms', 'notes'] as const) {
        if (entry[field]) evidence[field] = cited;
      }
      evidence.fields = entry.estimated?.length
        ? {
            source: 'assumed',
            reference,
            note: `Not from the source: ${entry.estimated.join(', ')}; the rest is`,
          }
        : cited;
    }
    const record = await run<RecordEnvelope>('entities.draft', {
      label: entry.label,
      entityKind: kind,
      fields,
      ...(entry.synonyms ? { synonyms: entry.synonyms } : {}),
      ...(entry.handlingRules ? { handlingRules: entry.handlingRules } : {}),
      ...(entry.notes ? { notes: entry.notes } : {}),
      ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
      reason,
    });
    entityId.set(entry.key, record.id);
    report.entities.created.push(`${record.name} ${entry.label}`);
  }
  return report;
}

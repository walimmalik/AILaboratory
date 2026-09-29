import {
  EquipmentKindAttributes,
  type EvidenceInput,
  InstrumentKindAttributes,
  type RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns `seed/instrument-library.yaml` into instrument and equipment kind drafts (plan 008a). Each
 * entry names its research entry in `seed/instruments.yaml`; that entry's first source URL is the
 * datasheet evidence for every attribute except those the entry lists as assumed, which load with no
 * evidence and so show as assumed.
 */

const Entry = <A extends z.ZodType>(attributes: A) =>
  z.strictObject({
    key: z.string().min(1),
    research: z.string().min(1).optional(),
    label: z.string().min(1),
    manufacturer: z.string().min(1).optional(),
    assumed: z.array(z.string().min(1)).optional(),
    attributes: attributes,
  });

const Library = z.strictObject({
  instrument_kinds: z.array(Entry(InstrumentKindAttributes.omit({ manufacturer: true }))),
  equipment_kinds: z.array(Entry(EquipmentKindAttributes.omit({ manufacturer: true }))),
});

const Research = z.looseObject({
  kinds: z.array(z.looseObject({ key: z.string(), source_urls: z.array(z.string()).optional() })),
});

export interface SeedKind {
  kind: 'instrument_kind' | 'equipment_kind';
  key: string;
  label: string;
  manufacturer?: string;
  attributes: Record<string, unknown>;
  evidence: Record<string, EvidenceInput>;
}

/** Reads the library file, citing the research file's sources. Refuses a file that doesn't parse. */
export function readSeedInstruments(libraryYaml: string, researchYaml: string): SeedKind[] {
  const library = Library.parse(parse(libraryYaml));
  const sources = new Map(
    Research.parse(parse(researchYaml)).kinds.map((k) => [k.key, k.source_urls?.[0]]),
  );
  const convert = (kind: SeedKind['kind'], entry: z.infer<ReturnType<typeof Entry>>): SeedKind => {
    const reference = entry.research ? sources.get(entry.research) : undefined;
    if (entry.research && !reference) {
      throw new Error(
        `${entry.key}: research entry "${entry.research}" has no source in instruments.yaml`,
      );
    }
    const assumed = new Set(entry.assumed ?? []);
    const attributes = entry.attributes as Record<string, unknown>;
    const evidence: Record<string, EvidenceInput> = {};
    for (const field of Object.keys(attributes)) {
      if (assumed.has(field) || !reference) continue;
      evidence[field] = {
        source: 'datasheet',
        reference,
        note: `Seed data (seed/instruments.yaml, ${entry.research})`,
      };
    }
    return {
      kind,
      key: entry.key,
      label: entry.label,
      ...(entry.manufacturer ? { manufacturer: entry.manufacturer } : {}),
      attributes,
      evidence,
    };
  };
  return [
    ...library.instrument_kinds.map((e) => convert('instrument_kind', e)),
    ...library.equipment_kinds.map((e) => convert('equipment_kind', e)),
  ];
}

export interface InstrumentSeedReport {
  created: string[];
  existing: string[];
}

/**
 * Creates a draft for every seed kind the lab doesn't have yet (matched by kind and label), through
 * the same operations people and agents use. Vendors are matched by name or created as drafts.
 */
export async function loadSeedInstruments(
  registry: OperationRegistry,
  ctx: RecordContext,
  kinds: SeedKind[],
): Promise<InstrumentSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const existing = new Set(
    [...(await list('instrument_kind')), ...(await list('equipment_kind'))].map(
      (r) => `${r.kind}/${r.label}`,
    ),
  );
  const vendors = new Map((await list('vendor')).map((v) => [v.label.toLowerCase(), v.id]));
  const reason = 'Seed lab (plan 006), loaded by plan 008';
  const report: InstrumentSeedReport = { created: [], existing: [] };
  for (const seed of kinds) {
    if (existing.has(`${seed.kind}/${seed.label}`)) {
      report.existing.push(seed.key);
      continue;
    }
    const attributes = { ...seed.attributes };
    const evidence = { ...seed.evidence };
    if (seed.manufacturer) {
      let vendorId = vendors.get(seed.manufacturer.toLowerCase());
      if (!vendorId) {
        const vendor = await run<RecordEnvelope>('records.create', {
          kind: 'vendor',
          label: seed.manufacturer,
          attributes: {},
          reason,
        });
        vendorId = vendor.id;
        vendors.set(seed.manufacturer.toLowerCase(), vendorId);
      }
      attributes.manufacturer = vendorId;
      evidence.manufacturer = { source: 'imported', reference: 'seed/instrument-library.yaml' };
    }
    const record = await run<RecordEnvelope>('records.create', {
      kind: seed.kind,
      label: seed.label,
      attributes,
      evidence,
      reason,
    });
    report.created.push(`${record.name} ${seed.key}`);
  }
  return report;
}

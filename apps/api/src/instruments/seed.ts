import {
  EquipmentKindAttributes,
  EquipmentNode,
  type EvidenceInput,
  InstrumentAttributes,
  InstrumentKindAttributes,
  type RecordEnvelope,
  WorkcellAttributes,
  WorkcellMember,
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

const Instance = z.strictObject({
  key: z.string().min(1),
  research: z.string().min(1),
  /** Keys of kinds in this file, for the instrument and each node. */
  kind: z.string().min(1),
  label: z.string().min(1),
  ...InstrumentAttributes.pick({
    shortName: true,
    serial: true,
    room: true,
    variant: true,
    notes: true,
  }).shape,
  configuration: z.array(EquipmentNode.extend({ kind: z.string().min(1) })).optional(),
});

const SeedWorkcell = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  ...WorkcellAttributes.omit({ members: true }).shape,
  /** Members name instruments by their key in this file. */
  members: z.array(WorkcellMember.extend({ instrument: z.string().min(1) })).min(1),
});

const Library = z.strictObject({
  instrument_kinds: z.array(Entry(InstrumentKindAttributes.omit({ manufacturer: true }))),
  equipment_kinds: z.array(Entry(EquipmentKindAttributes.omit({ manufacturer: true }))),
  instruments: z.array(Instance),
  workcells: z.array(SeedWorkcell).optional(),
});

export type SeedWorkcell = z.infer<typeof SeedWorkcell>;

export type SeedInstrument = z.infer<typeof Instance>;

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

export interface SeedLibrary {
  kinds: SeedKind[];
  instruments: SeedInstrument[];
  workcells: SeedWorkcell[];
}

/** Reads the library file, citing the research file's sources. Refuses a file that doesn't parse. */
export function readSeedInstruments(libraryYaml: string, researchYaml: string): SeedLibrary {
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
  const kinds = [
    ...library.instrument_kinds.map((e) => convert('instrument_kind', e)),
    ...library.equipment_kinds.map((e) => convert('equipment_kind', e)),
  ];
  const keys = new Set(kinds.map((k) => k.key));
  for (const instrument of library.instruments) {
    for (const key of [instrument.kind, ...(instrument.configuration ?? []).map((n) => n.kind)]) {
      if (!keys.has(key)) throw new Error(`${instrument.key}: no kind "${key}" in the library`);
    }
  }
  const instrumentKeys = new Set(library.instruments.map((i) => i.key));
  for (const w of library.workcells ?? []) {
    for (const m of w.members) {
      if (!instrumentKeys.has(m.instrument))
        throw new Error(`${w.key}: no instrument "${m.instrument}" in the library`);
    }
  }
  return { kinds, instruments: library.instruments, workcells: library.workcells ?? [] };
}

export interface InstrumentSeedReport {
  created: string[];
  existing: string[];
  /** Instruments registered, and those already there (matched by label). */
  registered: string[];
  registeredBefore: string[];
}

/**
 * Creates a draft for every seed kind the lab doesn't have yet (matched by kind and label), through
 * the same operations people and agents use. Vendors are matched by name or created as drafts.
 */
export async function loadSeedInstruments(
  registry: OperationRegistry,
  ctx: RecordContext,
  { kinds, instruments }: SeedLibrary,
): Promise<InstrumentSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const known = new Map(
    [...(await list('instrument_kind')), ...(await list('equipment_kind'))].map((r) => [
      `${r.kind}/${r.label}`,
      r.id,
    ]),
  );
  const idOf = new Map<string, string>(); // seed key -> record ID
  const vendors = new Map((await list('vendor')).map((v) => [v.label.toLowerCase(), v.id]));
  const reason = 'Seed lab (plan 006), loaded by plan 008';
  const report: InstrumentSeedReport = {
    created: [],
    existing: [],
    registered: [],
    registeredBefore: [],
  };
  for (const seed of kinds) {
    const earlier = known.get(`${seed.kind}/${seed.label}`);
    if (earlier) {
      idOf.set(seed.key, earlier);
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
    idOf.set(seed.key, record.id);
    report.created.push(`${record.name} ${seed.key}`);
  }

  // The demo lab's instruments, registered with their configurations (checked as they go in).
  const registered = new Set((await list('instrument')).map((r) => r.label));
  for (const seed of instruments) {
    if (registered.has(seed.label)) {
      report.registeredBefore.push(seed.key);
      continue;
    }
    const { key: _key, research, kind, configuration, ...rest } = seed;
    const record = await run<RecordEnvelope>('instruments.register', {
      ...rest,
      kind: idOf.get(kind),
      configuration: {
        equipment: (configuration ?? []).map((node) => ({ ...node, kind: idOf.get(node.kind) })),
      },
      reason: `Seed lab (plan 006), instance ${research} in seed/instruments.yaml, loaded by plan 008`,
    });
    report.registered.push(`${record.name} ${seed.key}`);
  }
  return report;
}

/**
 * Drafts the lab's workcells (plan 008d) that aren't there yet, matched by label, once their member
 * instruments are registered. The twin mapping is marked assumed until the twin connection (015)
 * checks it.
 */
export async function loadSeedWorkcells(
  registry: OperationRegistry,
  ctx: RecordContext,
  { instruments, workcells }: Pick<SeedLibrary, 'instruments' | 'workcells'>,
): Promise<{ created: string[]; existing: string[]; waiting: string[] }> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const registered = new Map((await list('instrument')).map((r) => [r.label, r.id]));
  const labelOf = new Map(instruments.map((i) => [i.key, i.label]));
  const existing = new Set((await list('workcell')).map((w) => w.label));
  const report = { created: [] as string[], existing: [] as string[], waiting: [] as string[] };
  for (const { key, label, members, ...rest } of workcells) {
    if (existing.has(label)) {
      report.existing.push(key);
      continue;
    }
    const ids = members.map((m) => registered.get(labelOf.get(m.instrument) as string));
    if (ids.some((id) => !id)) {
      report.waiting.push(key);
      continue;
    }
    const record = await run<RecordEnvelope>('workcells.draft', {
      label,
      ...rest,
      members: members.map((m, i) => ({ ...m, instrument: ids[i] })),
      evidence: {
        twin: {
          source: 'assumed',
          note: 'Device IDs from the echo650-twin catalog; not checked until the twin connection (plan 015)',
        },
        members: {
          source: 'assumed',
          note: 'Members as Wali listed them (plan 008 I10); twin devices and hand use are assumed',
        },
      },
      reason: `Seed lab (plan 006), workcell ${key}, loaded by plan 008d`,
    });
    report.created.push(`${record.name} ${key}`);
  }
  return report;
}

import { readdir, readFile } from 'node:fs/promises';
import { fromOpentrons, sameValue } from '@ailab/domain';
import {
  type EvidenceInput,
  LabwareFamily,
  LabwareTypeAttributes,
  OpentronsDefinition,
  type Proposal,
  type RecordEnvelope,
  type WellLayout,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { SBS_POSITIONS_REFERENCE } from './operations.ts';

/**
 * Turns the reviewed seed file `seed/labware.yaml` (plan 006) into labware type drafts (plan 007).
 * Values the seed marks verified carry their source URL as datasheet evidence; estimated values are
 * marked assumed; unknown values are left out, so readiness lists them as missing.
 *
 * The seed rarely gives where wells sit. When an entry names a verified Opentrons load name and
 * `seed/opentrons/` holds that definition, the pitch and A1 offset (and the well size, when the seed
 * has none) come from the definition, cited by its URL.
 */

/** Opentrons definitions by load name. */
export type Definitions = Record<string, OpentronsDefinition>;

/** Reads every Opentrons definition in a folder (`seed/opentrons/`). */
export async function readDefinitions(folder: URL): Promise<Definitions> {
  const definitions: Definitions = {};
  for (const file of (await readdir(folder)).filter((f) => f.endsWith('.json'))) {
    const definition = OpentronsDefinition.parse(
      JSON.parse(await readFile(new URL(file, folder), 'utf8')),
    );
    definitions[definition.parameters.loadName] = definition;
  }
  return definitions;
}

const definitionUrl = (d: OpentronsDefinition) =>
  `https://github.com/Opentrons/opentrons/blob/edge/shared-data/labware/definitions/2/${d.parameters.loadName}/${d.version}.json`;

/**
 * The seed's grid with the pitch and A1 offset from an Opentrons definition of the same labware, or
 * undefined when the definition doesn't describe the same grid. The well size stays the seed's when
 * it is verified (`keepWell`), otherwise the definition's.
 */
function placedBy(
  definition: OpentronsDefinition,
  family: LabwareFamily,
  grid: WellLayout,
  keepWell: boolean,
) {
  if (grid.layout !== 'grid' || grid.a1) return undefined;
  const imported = fromOpentrons(definition).attributes;
  const from = imported.wells;
  if (
    imported.family !== family ||
    from?.layout !== 'grid' ||
    from.rows !== grid.rows ||
    from.columns !== grid.columns ||
    !from.a1
  ) {
    return undefined;
  }
  const well = keepWell && grid.well ? grid.well : from.well;
  return {
    ...grid,
    ...(from.pitch ? { pitch: from.pitch } : {}),
    a1: from.a1,
    ...(well ? { well } : {}),
  };
}

export interface SeedLabware {
  key: string;
  label: string;
  /** The manufacturer's name; the loader matches it to a vendor record. */
  manufacturer: string;
  attributes: Omit<LabwareTypeAttributes, 'manufacturer'>;
  evidence: Record<string, EvidenceInput>;
}

export interface SeedSkip {
  key: string;
  reason: string;
}

const Q = z.object({ value: z.string(), unit: z.string() }).nullish();
const Entry = z.looseObject({
  key: z.string(),
  manufacturer: z.string(),
  catalog_number: z.string().nullish(),
  name: z.string(),
  format: z.string(),
  rows: z.number().nullish(),
  columns: z.number().nullish(),
  footprint: z
    .looseObject({ sbs: z.boolean(), length: Q, width: Q, height: Q, outer_diameter: Q })
    .nullish(),
  well_geometry: z
    .looseObject({
      shape: z.string().nullish(),
      bottom_shape: z.string().nullish(),
      depth: Q,
      pitch: Q,
      top_diameter: Q,
      bottom_diameter: Q,
      inner_diameter: Q,
      top_side: Q,
      bottom_side: Q,
      top_length_x: Q,
      top_length_y: Q,
      a1_row_offset: Q,
      a1_column_offset: Q,
    })
    .nullish(),
  max_volume: Q,
  working_volume: z.object({ min: Q, max: Q }).nullish(),
  dead_volume: Q,
  material: z.string().nullish(),
  color: z.string().nullish(),
  surface_treatment: z.string().nullish(),
  sterile: z.boolean().nullish(),
  pack: z.string().nullish(),
  tip_length: Q,
  filter: z.boolean().nullish(),
  conductive: z.boolean().nullish(),
  related_catalog_numbers: z.record(z.string(), z.string()).nullish(),
  echo_calibrations: z.array(z.object({ name: z.string() })).nullish(),
  opentrons_load_name: z.string().nullish(),
  hamilton_labware_file: z.string().nullish(),
  source_urls: z.array(z.string()).nullish(),
  status: z.record(z.string(), z.enum(['verified', 'estimated', 'unknown'])).nullish(),
  notes: z.string().nullish(),
});
type Entry = z.infer<typeof Entry>;

const File = z.object({ kinds: z.array(z.unknown()) });

/** Drops null and undefined values so optional attributes stay absent. */
function present<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]: NonNullable<T[K]> };
}

const bottoms: [RegExp, 'flat' | 'round' | 'v'][] = [
  [/^flat/i, 'flat'],
  [/^round|\(u\)/i, 'round'],
  [/^v\b|conical|pyramidal/i, 'v'],
];

function wellGeometry(g: NonNullable<Entry['well_geometry']>) {
  const circular = /^round/i.test(g.shape ?? '');
  const rectangular = /square|rectangular/i.test(g.shape ?? '');
  const top = circular
    ? (g.top_diameter ?? g.inner_diameter) && {
        shape: 'circular',
        diameter: g.top_diameter ?? g.inner_diameter,
      }
    : rectangular && g.top_side
      ? { shape: 'rectangular', xSize: g.top_side, ySize: g.top_side }
      : rectangular && g.top_length_x && g.top_length_y
        ? { shape: 'rectangular', xSize: g.top_length_x, ySize: g.top_length_y }
        : undefined;
  const base =
    circular && g.bottom_diameter
      ? { shape: 'circular', diameter: g.bottom_diameter }
      : rectangular && g.bottom_side
        ? { shape: 'rectangular', xSize: g.bottom_side, ySize: g.bottom_side }
        : undefined;
  const bottom = bottoms.find(([pattern]) => pattern.test(g.bottom_shape ?? ''))?.[1];
  return present({ top: top || undefined, base, depth: g.depth, bottom });
}

function convert(entry: Entry, definitions: Definitions): SeedLabware | SeedSkip {
  const family = LabwareFamily.safeParse(entry.format);
  if (!family.success) {
    return { key: entry.key, reason: `"${entry.format}" is not a labware family` };
  }
  const g = entry.well_geometry;
  const status = (field: string) => entry.status?.[field] ?? 'verified';
  const geometryKnown = g && status('well_geometry') !== 'unknown';
  const f = entry.footprint;
  const tube = family.data === 'tube';
  const draft = present({
    family: family.data,
    catalogNumber: entry.catalog_number,
    otherCatalogNumbers: entry.related_catalog_numbers
      ? Object.values(entry.related_catalog_numbers)
      : undefined,
    pack: entry.pack,
    material: entry.material,
    color: entry.color,
    surface: entry.surface_treatment,
    sterile: entry.sterile,
    footprint: f
      ? present({
          sbs: f.sbs,
          length: tube ? undefined : f.length,
          width: f.width,
          height: tube ? f.length : f.height,
          diameter: f.outer_diameter,
        })
      : undefined,
    wells: present({
      layout: 'grid',
      rows: entry.rows ?? 1,
      columns: entry.columns ?? 1,
      pitch: g?.pitch,
      a1:
        g?.a1_column_offset && g.a1_row_offset
          ? { x: g.a1_column_offset, y: g.a1_row_offset }
          : undefined,
      well: geometryKnown ? wellGeometry(g) : undefined,
    }),
    tip:
      family.data === 'tip_rack'
        ? present({
            length: entry.tip_length,
            filtered: entry.filter,
            conductive: entry.conductive,
          })
        : undefined,
    maxVolume: entry.max_volume,
    workingVolume: entry.working_volume ? present(entry.working_volume) : undefined,
    deadVolume: entry.dead_volume,
    opentronsLoadName: entry.opentrons_load_name,
    hamiltonLabware: entry.hamilton_labware_file,
    echoPlateTypes: entry.echo_calibrations?.map((c) => c.name),
    notes: entry.notes?.trim(),
  });
  const parsed = LabwareTypeAttributes.omit({ manufacturer: true }).safeParse(draft);
  if (!parsed.success) {
    return { key: entry.key, reason: z.prettifyError(parsed.error) };
  }

  // Which seed status backs each attribute.
  const statusField: Record<string, string> = {
    catalogNumber: 'catalog_number',
    footprint: 'footprint',
    wells: 'well_geometry',
    tip: 'tip_length',
    maxVolume: 'max_volume',
    workingVolume: 'working_volume',
    deadVolume: 'dead_volume',
    material: 'material',
    color: 'color',
    surface: 'surface_treatment',
    sterile: 'sterile',
    pack: 'pack',
    opentronsLoadName: 'opentrons_load_name',
    hamiltonLabware: 'hamilton_labware_file',
  };
  const reference = entry.source_urls?.[0];
  const seedNote = `Seed data (seed/labware.yaml, ${entry.key})`;
  const loadName = entry.opentrons_load_name;
  const definition =
    loadName && status('opentrons_load_name') === 'verified' ? definitions[loadName] : undefined;
  const keepWell = !!geometryKnown && status('well_geometry') === 'verified';
  const placed =
    definition && parsed.data.wells
      ? placedBy(definition, parsed.data.family, parsed.data.wells, keepWell)
      : undefined;
  if (placed) parsed.data.wells = placed;
  const evidence: Record<string, EvidenceInput> = {};
  for (const field of Object.keys(parsed.data)) {
    const backing = statusField[field];
    if (field === 'wells' && placed && definition) {
      evidence[field] = {
        source: 'datasheet',
        reference: definitionUrl(definition),
        note: `${seedNote}: pitch and A1 offset from the Opentrons labware definition; well size from ${
          keepWell ? 'the seed source' : 'the definition'
        }`,
      };
    } else if (field === 'family' || field === 'notes' || !backing) {
      evidence[field] = { source: 'imported', reference: 'seed/labware.yaml', note: seedNote };
    } else if (status(backing) === 'estimated') {
      evidence[field] = { source: 'assumed', note: `${seedNote}: estimated, see the notes` };
    } else {
      evidence[field] = {
        source: 'datasheet',
        note: `${seedNote}: verified`,
        ...(reference ? { reference } : {}),
      };
    }
  }
  return {
    key: entry.key,
    label: entry.name,
    manufacturer: entry.manufacturer,
    attributes: parsed.data,
    evidence,
  };
}

/** Reads the seed file: the types to create, and entries it can't use with the reason. */
export function readSeedLabware(
  yamlText: string,
  definitions: Definitions = {},
): { types: SeedLabware[]; skipped: SeedSkip[] } {
  const file = File.parse(parse(yamlText));
  const types: SeedLabware[] = [];
  const skipped: SeedSkip[] = [];
  for (const raw of file.kinds) {
    const entry = Entry.safeParse(raw);
    if (!entry.success) {
      const key = (raw as { key?: unknown }).key;
      skipped.push({ key: String(key ?? '?'), reason: z.prettifyError(entry.error) });
      continue;
    }
    const converted = convert(entry.data, definitions);
    if ('reason' in converted) skipped.push(converted);
    else types.push(converted);
  }
  return { types, skipped };
}

export interface SeedReport {
  created: string[];
  existing: string[];
  /** Drafts the loader made earlier whose well positions it has filled in since. */
  updated: string[];
  /** Confirmed types it made earlier whose new well positions wait on a person's review. */
  proposed: string[];
  skipped: SeedSkip[];
}

/**
 * Creates a draft for every seed labware type the lab doesn't have yet (matched by label), through
 * the same operations people and agents use. Vendors are matched by name or created as drafts. A type
 * it made earlier gets newer seed wells only while nobody else has changed them (their evidence still
 * cites the seed): a draft at once, a confirmed type as a proposal on the Review page.
 */
export async function loadSeedLabware(
  registry: OperationRegistry,
  ctx: RecordContext,
  yamlText: string,
  definitions: Definitions = {},
): Promise<SeedReport> {
  const { types, skipped } = readSeedLabware(yamlText, definitions);
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const list = (kind: string) =>
    run<{ records: RecordEnvelope[] }>('records.list', { kind, limit: 200 }).then((r) => r.records);
  const existing = new Map((await list('labware_type')).map((r) => [r.label, r]));
  const vendors = new Map((await list('vendor')).map((v) => [v.label.toLowerCase(), v.id]));
  const reason = 'Seed lab (plan 006), loaded by plan 007';
  const report: SeedReport = { created: [], existing: [], updated: [], proposed: [], skipped };
  // Records that already wait on a person for a seed change, so a rerun doesn't ask twice.
  const pending = new Set(
    (await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' })).proposals
      .filter((p) => p.operationId === 'records.update')
      .map((p) => (p.input as { id?: string }).id),
  );
  for (const type of types) {
    const earlier = existing.get(type.label);
    if (earlier) {
      const wells = type.attributes.wells;
      // Wells nobody entered or measured: still the seed's, or the standard SBS positions, which
      // the labware's own Opentrons definition supersedes.
      const was = earlier.evidence.wells;
      const seedOwned =
        (was?.note?.startsWith('Seed data') ?? false) || was?.reference === SBS_POSITIONS_REFERENCE;
      if (
        earlier.status !== 'archived' &&
        seedOwned &&
        wells &&
        !sameValue(earlier.attributes.wells, wells) &&
        !pending.has(earlier.id)
      ) {
        // A draft changes at once; a confirmed type becomes a proposal for a person to confirm.
        const result = await registry.execute(ctx, 'records.update', {
          id: earlier.id,
          expectedVersion: earlier.version,
          attributes: { ...earlier.attributes, wells },
          evidence: { wells: type.evidence.wells },
          reason: 'Well positions from the seed (Opentrons definition)',
        });
        const line = `${earlier.name} ${type.key}`;
        if (result.status === 'proposed') report.proposed.push(line);
        else if (result.status === 'done') report.updated.push(line);
        else throw new Error(`records.update was ${result.status}`);
      } else {
        report.existing.push(type.key);
      }
      continue;
    }
    let vendorId = vendors.get(type.manufacturer.toLowerCase());
    if (!vendorId) {
      const vendor = await run<RecordEnvelope>('records.create', {
        kind: 'vendor',
        label: type.manufacturer,
        attributes: {},
        reason,
      });
      vendorId = vendor.id;
      vendors.set(type.manufacturer.toLowerCase(), vendorId);
    }
    const record = await run<RecordEnvelope>('records.create', {
      kind: 'labware_type',
      label: type.label,
      attributes: { ...type.attributes, manufacturer: vendorId },
      evidence: {
        ...type.evidence,
        manufacturer: { source: 'imported', reference: 'seed/labware.yaml' },
      },
      reason,
    });
    report.created.push(`${record.name} ${type.key}`);
  }
  return report;
}

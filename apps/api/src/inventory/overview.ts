import {
  type ContainerAttributes,
  type EffectiveStorage,
  inventoryEffectiveRules,
  inventoryListPlace,
  inventoryWells,
  inventoryWhereIs,
  type LabwareTypeAttributes,
  type LocationAttributes,
  type OverviewFact,
  type PlacePath,
  type Quantity,
  type RecordEnvelope,
  type SampleAttributes,
  type WellState,
} from '@ailab/schema';
import { labwareNoun } from '../labware/overview.ts';
import {
  amount,
  capital,
  count,
  day,
  facts,
  type OverviewBuilder,
  type OverviewReader,
  parts,
  words,
} from '../records/overview.ts';

/** "Freezer -80 1", with the room above it as detail; the record itself is not part of its own place. */
export function placeFact(path: PlacePath, self?: string): OverviewFact | undefined {
  const above = path.filter((p) => p.id !== self);
  const here = above.at(-1);
  if (!here) return undefined;
  const position = path.find((p) => p.id === self)?.position;
  const outer = above.slice(0, -1).map((p) => p.label);
  return {
    label: 'where',
    value: `${here.label}${position ? `, position ${position}` : ''}`,
    record: here.id,
    ...(outer.length ? { detail: outer.join(' › ') } : {}),
    field: 'place',
  };
}

/** "−20 °C or colder", "2 to 8 °C", "at least 15 °C". */
export function storageWords(range: EffectiveStorage['range']): string {
  const t = (q: Quantity) => amount(q);
  if (range.min && range.max) {
    return range.min.value === range.max.value
      ? `at ${t(range.max)}`
      : `${range.min.value} to ${t(range.max)}`;
  }
  if (range.max) return `${t(range.max)} or colder`;
  if (range.min) return `${t(range.min)} or warmer`;
  return 'not given';
}

/** What one source is called: a lot by its product ("Staurosporine"), a sample by its label. */
async function sourceName(read: OverviewReader, id: string, names: Map<string, string>) {
  const known = names.get(id);
  if (known) return known;
  const record = await read.get(id);
  let name = record?.label ?? 'a missing record';
  if (record?.kind === 'lot') {
    const product = await read.get((record.attributes as { product?: string }).product);
    if (product) name = product.label;
  }
  names.set(id, name);
  return name;
}

/** "Staurosporine 1 mM + Dimethyl sulfoxide 100 % v/v" for one well's components. */
async function mixture(read: OverviewReader, state: WellState, names: Map<string, string>) {
  const pieces: string[] = [];
  const solvents: string[] = [];
  for (const c of state.components) {
    const name = await sourceName(read, c.source, names);
    // A solvent at 100 % v/v reads as what the rest is dissolved in.
    if (
      (c.concentration?.unit === '%v/v' || c.concentration?.unit === '% v/v') &&
      Number(c.concentration.value) >= 100
    )
      solvents.push(name);
    else pieces.push(c.concentration ? `${name} ${amount(c.concentration)}` : name);
  }
  if (pieces.length === 0) return solvents.join(' + ') || 'nothing recorded';
  return solvents.length ? `${pieces.join(' + ')} in ${solvents.join(' + ')}` : pieces.join(' + ');
}

const container: OverviewBuilder = async (record, read) => {
  const a = record.attributes as ContainerAttributes;
  const [type, wells, path] = await Promise.all([
    read.get(a.labwareType),
    read.run(inventoryWells, { container: record.id }),
    read.run(inventoryListPlace, { place: record.id }).then((p) => p.path),
  ]);
  const where = placeFact(path, record.id);

  // Wells with the same contents form one group; the largest says what the container holds.
  const names = new Map<string, string>();
  const groups = new Map<string, { state: WellState; wells: string[] }>();
  for (const w of wells.wells) {
    const key = JSON.stringify(w.state.components);
    const group = groups.get(key) ?? { state: w.state, wells: [] };
    group.wells.push(w.well);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((x, y) => y.wells.length - x.wells.length);
  const single = wells.positions.length === 1;
  const first = ordered[0];
  const holds: OverviewFact | undefined = first
    ? {
        label: 'holds',
        value: await mixture(read, first.state, names),
        ...(single
          ? first.state.volume === 'unknown'
            ? { detail: 'volume not recorded' }
            : { detail: amount(first.state.volume) }
          : ordered.length > 1
            ? {
                detail: `${count(first.wells.length, 'well')}; ${count(ordered.length - 1, 'other mixture')} in ${count(
                  ordered.slice(1).reduce((n, g) => n + g.wells.length, 0),
                  'well',
                )}`,
              }
            : { detail: `in ${count(first.wells.length, 'well')}` }),
      }
    : a.description
      ? // A description is what someone wrote, not contents the lab recorded; say which.
        {
          label: 'holds',
          value: a.description,
          detail: 'as described; no contents recorded',
          field: 'description',
        }
      : { label: 'holds', value: 'nothing recorded' };

  let storage: OverviewFact | undefined;
  if (wells.wells.length > 0) {
    const rules = await read.run(inventoryEffectiveRules, { container: record.id });
    if (rules.storage) {
      storage = {
        label: 'store',
        value: storageWords(rules.storage.range),
        detail: rules.storage.conflict ?? 'the narrowest of what it holds',
        ...(rules.storage.conflict ? { tone: 'warn' as const } : {}),
      };
    }
  }

  return {
    identity: parts(
      type ? capital(labwareNoun(type.attributes as LabwareTypeAttributes)) : 'Container',
      a.sealed && 'sealed',
      a.lidded && 'lidded',
      where && { text: `in ${where.value}`, ...(where.record ? { record: where.record } : {}) },
      words(a.status),
    ),
    facts: facts(
      holds,
      !single && {
        label: 'wells filled',
        value: `${wells.wells.length} of ${wells.positions.length}`,
      },
      where ?? { label: 'where', value: 'not recorded', field: 'place', tone: 'warn' },
      storage,
      type && { label: 'labware', value: type.label, record: type.id, field: 'labwareType' },
    ),
  };
};

const LOCATION_WORDS: Partial<Record<LocationAttributes['type'], string>> = {
  cold_room: 'cold room',
  automated_store: 'automated store',
};

const location: OverviewBuilder = async (record, read) => {
  const a = record.attributes as LocationAttributes;
  const [parent, inside, instrument] = await Promise.all([
    read.get(a.parent),
    read.run(inventoryListPlace, { place: record.id, deep: true }),
    read.get(a.instrument),
  ]);
  const containers = inside.containers.length;
  return {
    identity: parts(
      capital(LOCATION_WORDS[a.type] ?? words(a.type)),
      a.setpoint && amount(a.setpoint),
      parent && { text: `in ${parent.label}`, record: parent.id },
    ),
    facts: facts(
      {
        label: 'holds',
        value: containers === 0 ? 'nothing registered' : count(containers, 'container'),
        ...(inside.locations.length
          ? { detail: `in ${count(inside.locations.length, 'place')} inside it` }
          : {}),
      },
      a.setpoint && { label: 'kept at', value: amount(a.setpoint), field: 'setpoint' },
      a.co2 && { label: 'CO2', value: amount(a.co2), field: 'co2' },
      parent && { label: 'inside', value: parent.label, record: parent.id, field: 'parent' },
      instrument && {
        label: 'instrument',
        value: instrument.label,
        record: instrument.id,
        field: 'instrument',
      },
    ),
  };
};

const sample: OverviewBuilder = async (record, read) => {
  const a = record.attributes as SampleAttributes;
  const [entity, where] = await Promise.all([
    read.get(a.entity),
    read.run(inventoryWhereIs, { of: record.id }),
  ]);
  return {
    identity: parts(
      entity
        ? { text: `${capital(words(a.method))} of ${entity.label}`, record: entity.id }
        : capital(words(a.method)),
      a.made && `made ${day(a.made)}`,
      a.madeBy && `by ${a.madeBy}`,
    ),
    facts: facts(
      whereFact(where.containers),
      ...(a.qc ?? []).slice(0, 4).map(
        (q): OverviewFact => ({
          label: words(q.key),
          value:
            typeof q.value === 'boolean'
              ? q.value
                ? 'yes'
                : 'no'
              : typeof q.value === 'string'
                ? q.value
                : amount(q.value),
          ...(q.measured ? { detail: `measured ${day(q.measured)}` } : {}),
          field: 'qc',
        }),
      ),
      entity && { label: 'what it is', value: entity.label, record: entity.id, field: 'entity' },
    ),
  };
};

/**
 * Where a lot or sample is: one container by name with its place, or how many containers and the
 * places they are in.
 */
export function whereFact(
  containers: {
    container: RecordEnvelope;
    path: PlacePath;
    wells: { volume: WellState['volume'] }[];
  }[],
): OverviewFact {
  if (containers.length === 0) {
    return { label: 'where', value: 'not in any registered container' };
  }
  const placeOf = (path: PlacePath, self: string) =>
    placeFact(path, self)?.value ?? 'place not recorded';
  if (containers.length === 1) {
    const [only] = containers;
    if (!only) return { label: 'where', value: 'not in any registered container' };
    const volumes = only.wells.flatMap((w) => (w.volume === 'unknown' ? [] : [w.volume]));
    return {
      label: 'where',
      value: `${only.container.name}, ${placeOf(only.path, only.container.id)}`,
      record: only.container.id,
      detail:
        only.wells.length === 1 && volumes[0]
          ? amount(volumes[0])
          : count(only.wells.length, 'well'),
    };
  }
  const places = [...new Set(containers.map((c) => placeOf(c.path, c.container.id)))];
  return {
    label: 'where',
    value: count(containers.length, 'container'),
    detail: places.join(', '),
  };
}

export const inventoryOverviews: Record<string, OverviewBuilder> = { container, location, sample };

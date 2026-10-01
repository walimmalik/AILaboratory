import { computeWells } from '@ailab/domain';
import {
  type CheckResult,
  CONTAINER_PREFIX,
  ContainerAttributes,
  defineKind,
  type LabwareTypeAttributes,
  LocationAttributes,
  type RecordEnvelope,
  SampleAttributes,
} from '@ailab/schema';

const PLAN = '(plan 010 V5 and V6, inventory)';

/** A place that doesn't move (V6): a room, fridge, freezer, shelf, incubator or automated store. */
export const location = defineKind({
  kind: 'location',
  idPrefix: 'loc',
  namePrefix: 'LOC',
  nameWidth: 4,
  attributes: LocationAttributes,
  links: (a) => [
    ...(a.parent ? [{ toId: a.parent, relation: 'inside' }] : []),
    ...(a.instrument ? [{ toId: a.instrument, relation: 'is_instrument' }] : []),
  ],
  related: async (a, { get, current }) => {
    const invalid: string[] = [];
    let parent = a.parent;
    const seen = new Set<string>();
    while (parent) {
      if (parent === current?.id || seen.has(parent)) {
        invalid.push('A location can’t sit inside itself');
        break;
      }
      seen.add(parent);
      const record = await get(parent);
      if (record?.kind !== 'location') {
        invalid.push(`${parent} is not a location in this lab`);
        break;
      }
      parent = (record.attributes as LocationAttributes).parent;
    }
    if (a.instrument && (await get(a.instrument))?.kind !== 'instrument') {
      invalid.push(`${a.instrument} is not a registered instrument in this lab`);
    }
    return { invalid };
  },
});

/**
 * A barcoded plate, tube, reservoir, rack or box (V5): an instance of a labware type, named by its
 * family (PLT-000345), in a location or a position of a rack or box.
 */
export const container = defineKind({
  kind: 'container',
  idPrefix: 'lw',
  namePrefix: 'CNT',
  otherNamePrefixes: Object.values(CONTAINER_PREFIX),
  nameWidth: 6,
  attributes: ContainerAttributes,
  links: (a) => [
    { toId: a.labwareType, relation: 'is_a' },
    ...(a.place
      ? [
          'location' in a.place
            ? { toId: a.place.location, relation: 'stored_in' }
            : { toId: a.place.container, relation: 'held_in' },
        ]
      : []),
  ],
  related: async (a, { get, list, current }) => {
    const type = await get(a.labwareType);
    if (type?.kind !== 'labware_type') {
      return { invalid: [`${a.labwareType} is not a labware type in this lab`] };
    }
    const family = (type.attributes as LabwareTypeAttributes).family;
    const invalid: string[] = [];
    if (current) {
      const before = await get((current.attributes as ContainerAttributes).labwareType);
      const was = (before?.attributes as LabwareTypeAttributes | undefined)?.family;
      if (was && was !== family) {
        invalid.push(
          `${current.name} is a ${was}; its labware type can only change to another ${was}`,
        );
      }
    }
    const others = (await list('container')).filter((c) => c.id !== current?.id);
    if (a.place && 'location' in a.place) {
      if ((await get(a.place.location))?.kind !== 'location') {
        invalid.push(`${a.place.location} is not a location in this lab`);
      }
    } else if (a.place) {
      invalid.push(...(await holderProblems(a.place, current, others, get)));
    }
    const codes = new Map(
      others.flatMap((o) =>
        ((o.attributes as ContainerAttributes).barcodes ?? []).map((b) => [b.code, o.name]),
      ),
    );
    for (const { code } of a.barcodes ?? []) {
      const holder = codes.get(code);
      if (holder) invalid.push(`The barcode ${code} is already on ${holder}`);
    }
    const typeConfirmed: CheckResult = {
      id: 'type_confirmed',
      label: 'Its labware type is confirmed',
      severity: 'warning',
      source: PLAN,
      passed: type.status === 'active',
      ...(type.status === 'active' ? {} : { message: `${type.label} (${type.name}) is a draft` }),
      fix: `Confirm ${type.name}, so its wells and volumes can be relied on`,
    };
    return { invalid, checks: [typeConfirmed], namePrefix: CONTAINER_PREFIX[family] };
  },
});

async function holderProblems(
  place: { container: string; position: string },
  current: RecordEnvelope | undefined,
  others: RecordEnvelope[],
  get: (id: string) => Promise<RecordEnvelope | undefined>,
): Promise<string[]> {
  const holder = await get(place.container);
  if (holder?.kind !== 'container') return [`${place.container} is not a container in this lab`];
  const holderType = await get((holder.attributes as ContainerAttributes).labwareType);
  const layout = (holderType?.attributes as LabwareTypeAttributes | undefined)?.wells;
  if ((holderType?.attributes as LabwareTypeAttributes | undefined)?.family !== 'rack' || !layout) {
    return [`${holder.name} is not a rack or box with positions`];
  }
  if (!computeWells(layout).some((w) => w.name === place.position)) {
    return [`${holder.name} has no position ${place.position}`];
  }
  // A box can't end up inside something it holds.
  let up: RecordEnvelope | undefined = holder;
  const seen = new Set<string>();
  while (up) {
    if (up.id === current?.id || seen.has(up.id)) return ['A container can’t sit inside itself'];
    seen.add(up.id);
    const next: ContainerAttributes['place'] = (up.attributes as ContainerAttributes).place;
    up = next && 'container' in next ? await get(next.container) : undefined;
  }
  const taken = others.find((o) => {
    const a = o.attributes as ContainerAttributes;
    return (
      a.status !== 'discarded' &&
      a.place !== undefined &&
      'container' in a.place &&
      a.place.container === place.container &&
      a.place.position === place.position
    );
  });
  return taken ? [`${place.position} in ${holder.name} already holds ${taken.name}`] : [];
}

/** A batch the lab made of an entity (V2): a miniprep, a PCR product, a cell bank, with its QC. */
export const sample = defineKind({
  kind: 'sample',
  idPrefix: 'smp',
  namePrefix: 'SMP',
  nameWidth: 4,
  attributes: SampleAttributes,
  links: (a) => [
    { toId: a.entity, relation: 'is_a' },
    ...(a.derivedFrom ?? []).map((id) => ({ toId: id, relation: 'derived_from' })),
  ],
  related: async (a, { get, current }) => {
    const invalid: string[] = [];
    if ((await get(a.entity))?.kind !== 'entity') {
      invalid.push(`${a.entity} is not an entity in this lab`);
    }
    if (current && (current.attributes as SampleAttributes).entity !== a.entity) {
      invalid.push(`${current.name} is a sample of one entity; register a new sample instead`);
    }
    for (const id of a.derivedFrom ?? []) {
      if (id === current?.id) invalid.push('A sample can’t be derived from itself');
      const kind = (await get(id))?.kind;
      if (kind !== 'sample' && kind !== 'lot')
        invalid.push(`${id} is not a sample or lot in this lab`);
    }
    const keys = (a.qc ?? []).map((q) => q.key);
    const twice = keys.find((k, i) => keys.indexOf(k) !== i);
    if (twice) invalid.push(`QC ${twice} is listed twice; keep the latest`);
    return { invalid };
  },
});

export const inventoryKinds = [location, container, sample];

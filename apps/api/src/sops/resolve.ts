import { isUnit } from '@ailab/domain';
import type {
  ContainerAttributes,
  LotAttributes,
  ProductAttributes,
  Quantity,
  RecordEnvelope,
  SopAttributes,
  SopMaterial,
} from '@ailab/schema';

/**
 * Binding an SOP's roles to records and reading its record variables from them (plan 012b, G4).
 * Pure over records fetched by the caller, so the kind's readiness and the calculator share it.
 */

/** Record kinds that can fill a role of each material type. */
export const KINDS_FOR: Record<SopMaterial['type'], readonly string[]> = {
  labware: ['labware_type', 'container'],
  reagent: ['product', 'lot'],
  entity: ['entity', 'sample'],
  instrument: ['instrument_kind', 'instrument', 'equipment_kind'],
  consumable: ['labware_type', 'product', 'lot'],
  solution: ['product', 'lot'],
};

export type Fetch = (id: string) => Promise<RecordEnvelope | undefined>;

export interface ReadValue {
  value?: string | Quantity;
  /** Where it was read: the record's name and the field. */
  from?: { record: string; name: string; field: string };
  /** true when it is a product's typical value for a lot not yet picked. */
  typical?: boolean;
  problem?: string;
}

function atPath(attributes: unknown, path: string): unknown {
  let at: unknown = attributes;
  for (const part of path.split('.')) {
    if (!at || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

function asValue(raw: unknown): string | Quantity | undefined {
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw)) return raw;
  if (
    raw &&
    typeof raw === 'object' &&
    'value' in raw &&
    'unit' in raw &&
    typeof (raw as Quantity).value === 'string' &&
    isUnit((raw as Quantity).unit)
  ) {
    return { value: (raw as Quantity).value, unit: (raw as Quantity).unit };
  }
  return undefined;
}

/**
 * Reads a field from a bound record: a lot's certificate value (falling back to its product's
 * typical value), a product's typical lot value, or any attribute by dotted path. A container reads
 * through to its labware type.
 */
export async function readField(
  record: RecordEnvelope,
  field: string,
  fetch: Fetch,
): Promise<ReadValue> {
  const from = { record: record.id, name: record.name, field };
  if (record.kind === 'lot') {
    const lot = record.attributes as LotAttributes;
    const stated = lot.values?.find((v) => v.field === field);
    if (stated) {
      if ('ratio' in stated.value) {
        return {
          from,
          problem: `${record.name} gives ${field} as a ratio (${stated.value.ratio}), not a number`,
        };
      }
      return { value: stated.value, from };
    }
    const product = await fetch(lot.product);
    if (product) {
      const read = await readField(product, field, fetch);
      if (read.value !== undefined) return read;
    }
    return { from, problem: `${record.name} has no ${field} on its certificate yet` };
  }
  if (record.kind === 'product') {
    const lotField = (record.attributes as ProductAttributes).lotFields?.find(
      (f) => f.key === field,
    );
    if (lotField) {
      return lotField.typical
        ? { value: lotField.typical, from, typical: true }
        : {
            from,
            problem: `${record.name}'s ${field} comes with each lot and has no typical value`,
          };
    }
  }
  const raw = atPath(record.attributes, field);
  const value = asValue(raw);
  if (value !== undefined) return { value, from };
  if (record.kind === 'container') {
    const type = await fetch((record.attributes as ContainerAttributes).labwareType);
    if (type) return readField(type, field, fetch);
  }
  return {
    from,
    problem:
      raw === undefined
        ? `${record.name} has no ${field}`
        : `${record.name}'s ${field} is not a number or a quantity`,
  };
}

export interface Binding {
  role: string;
  record?: RecordEnvelope;
  /** How it was chosen: given for this run, or the SOP's default. */
  by?: 'given' | 'default';
  problem?: string;
}

/** Each material role's record: the one given, else the SOP's default; checks the kind fits. */
export async function bindRoles(
  a: SopAttributes,
  given: ReadonlyMap<string, string>,
  fetch: Fetch,
): Promise<Binding[]> {
  const out: Binding[] = [];
  for (const m of a.materials) {
    const id = given.get(m.role) ?? m.default;
    if (!id) {
      out.push({ role: m.role });
      continue;
    }
    const by = given.has(m.role) ? 'given' : 'default';
    const record = await fetch(id);
    if (!record) {
      out.push({ role: m.role, by, problem: `${id} is not a record in this lab` });
      continue;
    }
    const kinds = KINDS_FOR[m.type];
    out.push(
      kinds.includes(record.kind)
        ? { role: m.role, record, by }
        : {
            role: m.role,
            record,
            by,
            problem: `${record.name} is a ${record.kind.replaceAll('_', ' ')}; ${m.label} needs a ${kinds.map((k) => k.replaceAll('_', ' ')).join(' or ')}`,
          },
    );
  }
  return out;
}

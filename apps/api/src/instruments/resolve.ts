import { type ItemInfo, type KindInfo, resolveConfiguration } from '@ailab/domain';
import {
  type Configuration,
  EquipmentItemAttributes,
  EquipmentKindAttributes,
  InstrumentAttributes,
  InstrumentKindAttributes,
  type RecordEnvelope,
} from '@ailab/schema';

/** What resolving reads: records in the lab. The record service and a kind's `related` hook both give this. */
export interface Lookup {
  /** A record in this lab by ID, or undefined. */
  get: (id: string) => Promise<RecordEnvelope | undefined>;
  /** Every non-archived record of a kind in this lab. */
  list: (kind: string) => Promise<RecordEnvelope[]>;
}

const infoOf = <A>(record: RecordEnvelope, attributes: A): KindInfo<A> => ({
  label: record.label,
  attributes,
  confirmed: record.status === 'active',
});

/** A non-archived record of this kind, or undefined. */
export async function findOf(lookup: Lookup, id: string, kind: string) {
  const found = await lookup.get(id);
  return found?.kind === kind && found.status !== 'archived' ? found : undefined;
}

/**
 * Resolves a configuration of an instrument kind with what the lab has: the equipment kinds and
 * items it names, and where else those items are installed (`self` is the instrument being changed).
 * The one rule for every instrument (ADR 0041); what fits where is data on the kinds (ADR 0025, 0026).
 */
export async function resolveWith(
  lookup: Lookup,
  instrumentKind: RecordEnvelope,
  configuration: Configuration,
  self?: string,
) {
  const instrument = infoOf(
    instrumentKind,
    InstrumentKindAttributes.parse(instrumentKind.attributes),
  );
  const equipment = new Map<string, KindInfo<EquipmentKindAttributes>>();
  for (const id of new Set(configuration.equipment.map((n) => n.kind))) {
    const found = await findOf(lookup, id, 'equipment_kind');
    if (found) equipment.set(id, infoOf(found, EquipmentKindAttributes.parse(found.attributes)));
  }
  const items = new Map<string, ItemInfo>();
  const wanted = new Set(configuration.equipment.flatMap((n) => (n.item ? [n.item] : [])));
  if (wanted.size > 0) {
    const installedIn = new Map<string, string>();
    for (const other of await lookup.list('instrument')) {
      if (other.id === self) continue;
      for (const node of InstrumentAttributes.parse(other.attributes).configuration.equipment) {
        if (node.item) installedIn.set(node.item, `${other.label} (${other.name})`);
      }
    }
    for (const id of wanted) {
      const found = await findOf(lookup, id, 'equipment_item');
      if (!found) continue;
      const where = installedIn.get(id);
      items.set(id, {
        label: `${found.label} (${found.name})`,
        kind: EquipmentItemAttributes.parse(found.attributes).kind,
        ...(where ? { installedIn: where } : {}),
      });
    }
  }
  return resolveConfiguration({ instrument, equipment, configuration, items });
}

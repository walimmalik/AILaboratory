import {
  type ContainerAttributes,
  LocationAttributes,
  type LocationType,
  type Proposal,
  type RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns the rooms and storage locations in `seed/lab.yaml` into locations, and the containers in
 * `seed/inventory.yaml` into registered containers (plan 010b). What a container holds waits for
 * 010c; until then its description says it in words.
 */

const Key = z.string().min(1);

const Room = z.looseObject({
  key: Key,
  name: z.string().min(1),
  purpose: z.string().min(1).optional(),
  biosafety_level: z.number().int().optional(),
});

const Storage = z.looseObject({
  key: Key,
  name: z.string().min(1),
  kind: LocationAttributes.shape.type,
  room: Key,
  setpoint: LocationAttributes.shape.setpoint,
  co2: LocationAttributes.shape.co2,
  notes: z.string().min(1).optional(),
});

const Container = z.looseObject({
  key: Key,
  label: z.string().min(1),
  labware: Key.nullable(),
  location: Key,
  sealed: z.boolean().optional(),
  description: z.string().min(1).optional(),
});

export interface SeedLocation {
  key: string;
  label: string;
  parent?: string;
  attributes: Omit<LocationAttributes, 'parent'>;
}

export interface SeedContainer {
  key: string;
  label: string;
  /** The label of its labware type, from labware.yaml; missing when the seed has none. */
  labwareType?: string;
  location: string;
  sealed?: boolean;
  description?: string;
}

export interface SeedInventory {
  locations: SeedLocation[];
  containers: SeedContainer[];
}

/** Reads the files, refusing a room, location or labware key they don't have. */
export function readSeedInventory(files: {
  lab: string;
  inventory: string;
  labware: string;
}): SeedInventory {
  const lab = z
    .looseObject({ rooms: z.array(Room), storage_locations: z.array(Storage) })
    .parse(parse(files.lab));
  const labware = new Map(
    (parse(files.labware) as { kinds: { key: string; name: string }[] }).kinds.map((k) => [
      k.key,
      k.name,
    ]),
  );
  const locations: SeedLocation[] = lab.rooms.map((r) => {
    const notes = [r.purpose, r.biosafety_level ? `Biosafety level ${r.biosafety_level}` : '']
      .filter(Boolean)
      .join('. ');
    return {
      key: r.key,
      label: r.name,
      attributes: { type: 'room' as LocationType, ...(notes ? { notes } : {}) },
    };
  });
  const rooms = new Set(locations.map((l) => l.key));
  for (const s of lab.storage_locations) {
    if (!rooms.has(s.room)) throw new Error(`${s.key}: no room "${s.room}"`);
    locations.push({
      key: s.key,
      label: s.name,
      parent: s.room,
      attributes: {
        type: s.kind,
        ...(s.setpoint ? { setpoint: s.setpoint } : {}),
        ...(s.co2 ? { co2: s.co2 } : {}),
        ...(s.notes ? { notes: s.notes } : {}),
      },
    });
  }
  const places = new Set(locations.map((l) => l.key));
  const containers = z
    .looseObject({ containers: z.array(Container) })
    .parse(parse(files.inventory))
    .containers.map((c): SeedContainer => {
      if (!places.has(c.location)) throw new Error(`${c.key}: no location "${c.location}"`);
      const type = c.labware ? labware.get(c.labware) : undefined;
      if (c.labware && !type) throw new Error(`${c.key}: no labware "${c.labware}"`);
      return {
        key: c.key,
        label: c.label,
        ...(type ? { labwareType: type } : {}),
        location: c.location,
        ...(c.sealed !== undefined ? { sealed: c.sealed } : {}),
        ...(c.description ? { description: c.description } : {}),
      };
    });
  return { locations, containers };
}

export interface InventorySeedReport {
  locations: { created: string[]; proposed: string[]; existing: string[]; waiting: string[] };
  containers: { created: string[]; proposed: string[]; existing: string[]; waiting: string[] };
  skipped: { key: string; reason: string }[];
}

/**
 * Adds what the lab doesn't have yet, matched by label, through the operations people and agents
 * use. Run as an agent, locations and containers are proposals; one that needs a place still
 * waiting on Review is left for the next run.
 */
export async function loadSeedInventory(
  registry: OperationRegistry,
  ctx: RecordContext,
  { locations, containers }: SeedInventory,
): Promise<InventorySeedReport> {
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
  const pending = (await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' }))
    .proposals;
  const report: InventorySeedReport = {
    locations: { created: [], proposed: [], existing: [], waiting: [] },
    containers: { created: [], proposed: [], existing: [], waiting: [] },
    skipped: [],
  };

  const locationId = new Map<string, string>();
  const byLabel = new Map((await list('location')).map((l) => [l.label, l.id]));
  const proposedLocations = new Set(
    pending
      .filter((p) => p.operationId === 'locations.create')
      .map((p) => (p.input as { label: string }).label),
  );
  for (const l of locations) {
    const earlier = byLabel.get(l.label);
    if (earlier) {
      locationId.set(l.key, earlier);
      report.locations.existing.push(l.key);
      continue;
    }
    if (proposedLocations.has(l.label)) {
      report.locations.existing.push(`${l.key} (waiting on Review)`);
      continue;
    }
    const parent = l.parent ? locationId.get(l.parent) : undefined;
    if (l.parent && !parent) {
      report.locations.waiting.push(`${l.key} (needs ${l.parent} first)`);
      continue;
    }
    const result = await registry.execute(ctx, 'locations.create', {
      label: l.label,
      ...l.attributes,
      ...(parent ? { parent } : {}),
      reason: 'Seed lab (plan 006), loaded by plan 010b',
    });
    if (result.status === 'proposed') {
      report.locations.proposed.push(l.key);
    } else {
      const record = result.output as RecordEnvelope;
      locationId.set(l.key, record.id);
      report.locations.created.push(`${record.name} ${l.label}`);
    }
  }

  const existing = new Set([
    ...(await list('container')).map((c) => c.label),
    ...pending
      .filter((p) => p.operationId === 'inventory.register_containers')
      .flatMap((p) => (p.input as { containers: { label?: string }[] }).containers)
      .map((c) => c.label),
  ]);
  for (const c of containers) {
    if (existing.has(c.label)) {
      report.containers.existing.push(c.key);
      continue;
    }
    const type = c.labwareType
      ? (await list('labware_type', c.labwareType)).find((t) => t.label === c.labwareType)
      : undefined;
    if (!type) {
      report.skipped.push({
        key: c.key,
        reason: c.labwareType
          ? `load its labware type first (${c.labwareType})`
          : 'no labware type for it in the seed yet',
      });
      continue;
    }
    const location = locationId.get(c.location);
    if (!location) {
      report.containers.waiting.push(`${c.key} (needs ${c.location} first)`);
      continue;
    }
    const item: Partial<ContainerAttributes> & { label: string } = {
      label: c.label,
      place: { location },
      ...(c.sealed !== undefined ? { sealed: c.sealed } : {}),
      ...(c.description ? { description: c.description } : {}),
    };
    const result = await registry.execute(ctx, 'inventory.register_containers', {
      labwareType: type.id,
      containers: [item],
      reason: 'Seed lab (plan 006), loaded by plan 010b',
    });
    if (result.status === 'proposed') {
      report.containers.proposed.push(c.key);
    } else {
      const [record] = (result.output as { containers: RecordEnvelope[] }).containers;
      report.containers.created.push(`${record?.name} ${c.label}`);
    }
  }
  return report;
}

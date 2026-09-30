import {
  LiquidVolume,
  type LotAttributes,
  type Proposal,
  Quantity,
  type RecordEnvelope,
  SampleAttributes,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns the samples and container contents in `seed/inventory.yaml` into samples, fills and
 * stamps (plan 010c). Fills name lots and samples by key; lots are found by their lot number,
 * samples and entities by label.
 */

const Key = z.string().min(1);

const SeedSample = z.strictObject({
  key: Key,
  entity: Key,
  label: z.string().min(1),
  ...SampleAttributes.pick({ method: true, made: true, madeBy: true, qc: true, notes: true }).shape,
});

const SeedComponent = z.union([
  z.strictObject({ lot: Key, concentration: Quantity.optional() }),
  z.strictObject({ sample: Key, concentration: Quantity.optional() }),
]);

const SeedFill = z.strictObject({
  wells: z.array(z.string()).optional(),
  volume: LiquidVolume,
  components: z.array(SeedComponent).min(1),
  assumed: z.boolean().optional(),
});

const SeedStamp = z.strictObject({
  from: Key,
  mapping: z.looseObject({ type: z.string() }),
  volume: LiquidVolume,
});

const ContentsOf = z.looseObject({
  key: Key,
  label: z.string().min(1),
  labware: Key.nullable(),
  fills: z.array(SeedFill).optional(),
  stamp: SeedStamp.optional(),
});

export interface SeedContents {
  samples: (z.infer<typeof SeedSample> & { entityLabel: string })[];
  containers: z.infer<typeof ContentsOf>[];
  /** Lot key to its lot number. */
  lots: Map<string, string>;
}

/** Reads the file, refusing a lot, sample, entity or container key it doesn't have. */
export function readSeedContents(files: {
  inventory: string;
  reagentLibrary: string;
  entityLibrary: string;
}): SeedContents {
  const inventory = z
    .looseObject({ samples: z.array(SeedSample), containers: z.array(ContentsOf) })
    .parse(parse(files.inventory));
  const lots = new Map(
    (parse(files.reagentLibrary) as { lots: { key: string; lotNumber: string }[] }).lots.map(
      (l) => [l.key, l.lotNumber],
    ),
  );
  const entities = new Map(
    (parse(files.entityLibrary) as { entities: { key: string; label: string }[] }).entities.map(
      (e) => [e.key, e.label],
    ),
  );
  const samples = inventory.samples.map((s) => {
    const entityLabel = entities.get(s.entity);
    if (!entityLabel) throw new Error(`${s.key}: no entity "${s.entity}" in entity-library.yaml`);
    return { ...s, entityLabel };
  });
  const sampleKeys = new Set(samples.map((s) => s.key));
  const containerKeys = new Set(inventory.containers.map((c) => c.key));
  for (const c of inventory.containers) {
    for (const fill of c.fills ?? []) {
      for (const component of fill.components) {
        if ('lot' in component && !lots.has(component.lot)) {
          throw new Error(`${c.key}: no lot "${component.lot}" in reagent-library.yaml`);
        }
        if ('sample' in component && !sampleKeys.has(component.sample)) {
          throw new Error(`${c.key}: no sample "${component.sample}"`);
        }
      }
    }
    if (c.stamp && !containerKeys.has(c.stamp.from)) {
      throw new Error(`${c.key}: stamps from "${c.stamp.from}", which isn't a container`);
    }
  }
  return { samples, containers: inventory.containers, lots };
}

export interface ContentsSeedReport {
  samples: { created: string[]; proposed: string[]; existing: string[]; waiting: string[] };
  contents: { created: string[]; proposed: string[]; existing: string[]; waiting: string[] };
}

/**
 * Registers the samples and fills the containers the lab has, through the operations people and
 * agents use. Run as an agent, each is a proposal; a fill whose container, lots or samples are
 * still waiting on Review waits for the next run, and a stamp waits for its source to be filled.
 */
export async function loadSeedContents(
  registry: OperationRegistry,
  ctx: RecordContext,
  { samples, containers, lots }: SeedContents,
): Promise<ContentsSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const find = async (kind: string, label: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', { kind, search: label, limit: 50 })
    ).records.find((r) => r.label === label);
  const pending = (await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' }))
    .proposals;
  const reason = 'Seed lab (plan 006), loaded by plan 010c';
  const report: ContentsSeedReport = {
    samples: { created: [], proposed: [], existing: [], waiting: [] },
    contents: { created: [], proposed: [], existing: [], waiting: [] },
  };

  const sampleId = new Map<string, string>();
  for (const { key, entity: _entity, entityLabel, ...sample } of samples) {
    const earlier = await find('sample', sample.label);
    if (earlier) {
      sampleId.set(key, earlier.id);
      report.samples.existing.push(key);
      continue;
    }
    const waiting = pending.some(
      (p) =>
        p.operationId === 'samples.register' &&
        (p.input as { label: string }).label === sample.label,
    );
    if (waiting) {
      report.samples.existing.push(`${key} (waiting on Review)`);
      continue;
    }
    const entity = await find('entity', entityLabel);
    if (!entity) {
      report.samples.waiting.push(`${key} (load the entity ${entityLabel} first)`);
      continue;
    }
    const result = await registry.execute(ctx, 'samples.register', {
      ...sample,
      entity: entity.id,
      reason,
    });
    if (result.status === 'proposed') {
      report.samples.proposed.push(key);
    } else {
      const record = result.output as RecordEnvelope;
      sampleId.set(key, record.id);
      report.samples.created.push(`${record.name} ${sample.label}`);
    }
  }

  const lotId = new Map<string, string>();
  const lotFor = async (key: string) => {
    if (lotId.has(key)) return lotId.get(key);
    const lotNumber = lots.get(key) as string;
    const found = (
      await run<{ records: RecordEnvelope[] }>('records.list', {
        kind: 'lot',
        search: lotNumber,
        limit: 50,
      })
    ).records.find((r) => (r.attributes as LotAttributes).lotNumber === lotNumber);
    if (found) lotId.set(key, found.id);
    return found?.id;
  };
  const containerId = new Map<string, string>();
  const containerFor = async (key: string) => {
    if (containerId.has(key)) return containerId.get(key);
    const label = containers.find((c) => c.key === key)?.label as string;
    const found = await find('container', label);
    if (found) containerId.set(key, found.id);
    return found?.id;
  };
  const holdsSomething = async (id: string) =>
    (await run<{ wells: unknown[] }>('inventory.wells', { container: id })).wells.length > 0;
  const proposedFor = (id: string) =>
    pending.some(
      (p) =>
        (p.operationId === 'inventory.fill' &&
          (p.input as { container: string }).container === id) ||
        (p.operationId === 'inventory.stamp' && (p.input as { to: string }).to === id),
    );

  for (const c of containers) {
    // Containers the seed can't register yet (no labware type) are reported by the inventory loader.
    if ((!c.fills && !c.stamp) || c.labware === null) continue;
    const id = await containerFor(c.key);
    if (!id) {
      report.contents.waiting.push(`${c.key} (its container is not registered yet)`);
      continue;
    }
    if ((await holdsSomething(id)) || proposedFor(id)) {
      report.contents.existing.push(c.key);
      continue;
    }
    let result: Awaited<ReturnType<typeof registry.execute>>;
    if (c.stamp) {
      const from = await containerFor(c.stamp.from);
      if (!from || !(await holdsSomething(from))) {
        report.contents.waiting.push(`${c.key} (stamped from ${c.stamp.from}, not filled yet)`);
        continue;
      }
      result = await registry.execute(ctx, 'inventory.stamp', {
        from,
        to: id,
        mapping: c.stamp.mapping,
        volume: c.stamp.volume,
        reason,
      });
    } else {
      const missing: string[] = [];
      const fills = [];
      for (const fill of c.fills ?? []) {
        const components = [];
        for (const component of fill.components) {
          const source =
            'lot' in component ? await lotFor(component.lot) : sampleId.get(component.sample);
          if (!source) missing.push('lot' in component ? component.lot : component.sample);
          else
            components.push({
              source,
              ...(component.concentration ? { concentration: component.concentration } : {}),
            });
        }
        fills.push({
          wells: fill.wells ?? ['A1'],
          volume: fill.volume,
          components,
          ...(fill.assumed ? { assumed: true } : {}),
        });
      }
      if (missing.length > 0) {
        report.contents.waiting.push(`${c.key} (needs ${[...new Set(missing)].join(', ')} first)`);
        continue;
      }
      result = await registry.execute(ctx, 'inventory.fill', { container: id, fills, reason });
    }
    if (result.status === 'proposed') report.contents.proposed.push(c.key);
    else report.contents.created.push(c.key);
  }
  return report;
}

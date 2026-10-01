import { ContentsError, EMPTY_WELL_STATE, formatQuantity, transfer } from '@ailab/domain';
import {
  type ContainerAttributes,
  inventoryCalculateTransfer,
  inventoryListPlace,
  inventoryMove,
  inventoryRegisterContainers,
  inventoryScan,
  inventoryWhereIs,
  type LocationAttributes,
  locationsCreate,
  type PlacePath,
  type RecordEnvelope,
  type WellState,
} from '@ailab/schema';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { records, wellContents } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

async function find(service: RecordService, ctx: RecordContext, id: string) {
  try {
    return await service.get(ctx, id);
  } catch (error) {
    if (error instanceof RecordError && error.code === 'not_found') return undefined;
    throw error;
  }
}

/** Where a container or location is, from the outermost location down to the record itself. */
export async function pathOf(
  service: RecordService,
  ctx: RecordContext,
  record: RecordEnvelope,
): Promise<PlacePath> {
  const path: PlacePath = [];
  let current: RecordEnvelope | undefined = record;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    let next: string | undefined;
    let position: string | undefined;
    if (current.kind === 'container') {
      const place: ContainerAttributes['place'] = (current.attributes as ContainerAttributes).place;
      if (place && 'container' in place) {
        next = place.container;
        position = place.position;
      } else {
        next = place?.location;
      }
    } else if (current.kind === 'location') {
      next = (current.attributes as LocationAttributes).parent;
    }
    path.unshift({
      id: current.id,
      name: current.name,
      label: current.label,
      ...(position ? { position } : {}),
    });
    current = next ? await find(service, ctx, next) : undefined;
  }
  return path;
}

/** A1, A2 … A10, B1: row letters, then the column as a number. */
function wellOrder(a: string, b: string): number {
  const split = (w: string) => /^([A-Za-z]+)(\d+)$/.exec(w) ?? [w, w, '0'];
  const [, ra = '', ca = '0'] = split(a);
  const [, rb = '', cb = '0'] = split(b);
  return ra.length - rb.length || ra.localeCompare(rb) || Number(ca) - Number(cb);
}

/** "plt000345", "PLT-345" → "PLT-000345" style candidates for a readable name. */
function nameCandidates(code: string): string[] {
  const upper = code.trim().toUpperCase();
  const match = /^([A-Z]{2,5})-?(\d+)$/.exec(upper);
  if (!match) return [upper];
  const [, prefix, digits] = match as unknown as [string, string, string];
  return [...new Set([upper, `${prefix}-${digits}`])];
}

const volumeWords = (v: WellState['volume']) =>
  v === 'unknown' ? 'an unknown volume' : formatQuantity(v);

export const inventoryOperations = [
  implement(inventoryCalculateTransfer, {
    run: async (_ctx, input) => {
      const destination = input.destination ?? EMPTY_WELL_STATE;
      try {
        const after = transfer(input.source, destination, input.volume);
        return {
          ...after,
          explanation: `Moving ${formatQuantity(input.volume)} takes the source from ${volumeWords(input.source.volume)} to ${volumeWords(after.source.volume)} and the destination from ${volumeWords(destination.volume)} to ${volumeWords(after.destination.volume)}. Each component's concentration is its total amount (concentration × volume, from both wells) over the new volume; a component whose concentration or well volume is unknown stays unknown.`,
        };
      } catch (error) {
        if (error instanceof ContentsError)
          throw new OperationError('invalid_input', error.message);
        throw error;
      }
    },
  }),
  implement(locationsCreate, {
    agentPolicy: 'propose',
    run: async (ctx, { label, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'location',
        label,
        status: 'active',
        attributes,
        reason: reason ?? `Added ${label}`,
      }),
  }),
  implement(inventoryRegisterContainers, {
    agentPolicy: 'propose',
    touches: (_input, output) => output?.containers.map((c) => c.id) ?? [],
    run: async (ctx, input, deps) =>
      deps.db.transaction(async (tx) => {
        const service = new RecordService(tx as unknown as Db, deps.kinds);
        const type = await find(service, ctx, input.labwareType);
        if (type?.kind !== 'labware_type') {
          throw new OperationError(
            'invalid_input',
            `${input.labwareType} is not a labware type in this lab`,
          );
        }
        const containers: RecordEnvelope[] = [];
        for (const { label, ...item } of input.containers) {
          containers.push(
            await service.create(ctx, {
              kind: 'container',
              label: label ?? type.label,
              status: 'active',
              attributes: { labwareType: input.labwareType, status: 'in_use', ...item },
              reason: input.reason ?? `Registered ${input.containers.length} × ${type.label}`,
            }),
          );
        }
        return { containers };
      }),
  }),
  implement(inventoryMove, {
    agentPolicy: 'propose',
    touches: (input) => [input.container],
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await find(service, ctx, input.container);
      if (record?.kind !== 'container') {
        throw new OperationError(
          'invalid_input',
          `${input.container} is not a container in this lab`,
        );
      }
      const attributes = record.attributes as ContainerAttributes;
      if (attributes.status === 'discarded') {
        throw new OperationError('invalid_input', `${record.name} is discarded`);
      }
      const container = await service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...attributes, place: input.to },
        reason: input.reason ?? 'Moved',
      });
      return { container, path: await pathOf(service, ctx, container) };
    },
  }),
  implement(inventoryScan, {
    run: async (ctx, { code }, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      for (const name of nameCandidates(code)) {
        const found = (await service.list(ctx, { search: name, limit: 50 })).find(
          (r) => r.name === name,
        );
        if (found) {
          const placed = found.kind === 'container' || found.kind === 'location';
          return {
            record: found,
            matched: 'name' as const,
            ...(placed ? { path: await pathOf(service, ctx, found) } : {}),
          };
        }
      }
      const trimmed = code.trim();
      const containers = await service.list(ctx, { kind: 'container', limit: 50_000 });
      const byCode = containers.find((c) =>
        ((c.attributes as ContainerAttributes).barcodes ?? []).some((b) => b.code === trimmed),
      );
      if (!byCode) {
        throw new OperationError('invalid_input', `Nothing in this lab has the code ${trimmed}`);
      }
      return {
        record: byCode,
        matched: 'barcode' as const,
        path: await pathOf(service, ctx, byCode),
      };
    },
  }),
  implement(inventoryListPlace, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const place = await find(service, ctx, input.place);
      if (place?.kind !== 'location' && place?.kind !== 'container') {
        throw new OperationError(
          'invalid_input',
          `${input.place} is not a location or container in this lab`,
        );
      }
      const locations = await service.list(ctx, { kind: 'location', limit: 50_000 });
      const containers = (await service.list(ctx, { kind: 'container', limit: 50_000 })).filter(
        (c) => (c.attributes as ContainerAttributes).status !== 'discarded',
      );
      const parentOf = (r: RecordEnvelope) => {
        if (r.kind === 'location') return (r.attributes as LocationAttributes).parent;
        const where = (r.attributes as ContainerAttributes).place;
        return where ? ('location' in where ? where.location : where.container) : undefined;
      };
      const inside = new Set([place.id]);
      const pick = (records: RecordEnvelope[]) =>
        records.filter((r) => inside.has(parentOf(r) ?? ''));
      let found = { locations: pick(locations), containers: pick(containers) };
      if (input.deep) {
        let grew = true;
        while (grew) {
          const before = inside.size;
          for (const r of [...found.locations, ...found.containers]) inside.add(r.id);
          found = { locations: pick(locations), containers: pick(containers) };
          grew = inside.size > before;
        }
      }
      return {
        path: await pathOf(service, ctx, place),
        locations: found.locations,
        containers: await Promise.all(
          found.containers.map(async (c) => {
            const where = (c.attributes as ContainerAttributes).place;
            return {
              container: c,
              ...(where && 'position' in where ? { position: where.position } : {}),
              path: await pathOf(service, ctx, c),
            };
          }),
        ),
      };
    },
  }),
  implement(inventoryWhereIs, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      // A product is wherever any of its lots is.
      const sources = input.of.startsWith('prd_')
        ? (
            await deps.db
              .select({ id: records.id })
              .from(records)
              .where(
                and(
                  eq(records.labId, ctx.labId),
                  eq(records.kind, 'lot'),
                  sql`${records.attributes}->>'product' = ${input.of}`,
                ),
              )
          ).map((r) => r.id)
        : [input.of];
      if (sources.length === 0) return { containers: [] };
      const rows = await deps.db
        .select({
          containerId: wellContents.containerId,
          well: wellContents.well,
          state: wellContents.state,
        })
        .from(wellContents)
        .innerJoin(records, eq(records.id, wellContents.containerId))
        .where(
          and(
            eq(wellContents.labId, ctx.labId),
            ne(records.status, 'archived'),
            sql`coalesce(${records.attributes}->>'status', '') <> 'discarded'`,
            or(
              ...sources.map(
                (source) =>
                  sql`${wellContents.state}->'components' @> ${JSON.stringify([{ source }])}::jsonb`,
              ),
            ),
          ),
        );
      const wanted = new Set(sources);
      const byContainer = new Map<string, typeof rows>();
      for (const row of rows) {
        byContainer.set(row.containerId, [...(byContainer.get(row.containerId) ?? []), row]);
      }
      const containers = [];
      for (const [id, wells] of byContainer) {
        const container = await service.get(ctx, id);
        containers.push({
          container,
          path: await pathOf(service, ctx, container),
          wells: wells
            .sort((a, b) => wellOrder(a.well, b.well))
            .flatMap(({ well, state }) =>
              state.components
                .filter((c) => wanted.has(c.source))
                .map((component) => ({ well, volume: state.volume, component })),
            ),
        });
      }
      containers.sort((a, b) => a.container.name.localeCompare(b.container.name));
      return { containers };
    },
  }),
];

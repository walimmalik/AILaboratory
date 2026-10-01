import { readableVolume, sum } from '@ailab/domain';
import {
  type ContainerAttributes,
  type EntityAttributes,
  inventoryOverview,
  type LocationAttributes,
  type LotAttributes,
  type PlacePath,
  type ProductAttributes,
  type Quantity,
  type RecordEnvelope,
  type SampleAttributes,
} from '@ailab/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { recordLinks, records, wellContents } from '../db/schema.ts';
import { implement } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

type Output = z.infer<typeof inventoryOverview.output>;
type Row = Output['rows'][number];
type Batch = Row['batches'][number];
type Ref = Row['thing'];

const words = (value: string) => value.replaceAll('_', ' ');

const ref = (r: RecordEnvelope): Ref => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  label: r.label,
  status: r.status,
  version: r.version,
  agentDraft: r.status === 'draft' && r.updatedBy.type === 'agent',
});

/** Everything of the lab's in a kind, drafts and active ones. */
const all = (service: RecordService, ctx: RecordContext, kind: string) =>
  service.list(ctx, { kind, limit: 100_000 });

/**
 * The inventory as one list (plan 004f-4, N2 and N3): each product or entity with its lots or
 * samples, the containers holding them, where they are, how much is left and the earliest expiry.
 * An entity that names a product absorbs it, so the two read as one row; nothing is matched by name.
 */
export const inventoryOverviewOperation = implement(inventoryOverview, {
  run: async (ctx, input, deps) => {
    const service = new RecordService(deps.db, deps.kinds);
    const today = input.today ?? new Date().toISOString().slice(0, 10);
    const [products, entities, entityKinds, lots, samples, containers, locations] =
      await Promise.all(
        ['product', 'entity', 'entity_kind', 'lot', 'sample', 'container', 'location'].map((k) =>
          all(service, ctx, k),
        ),
      );
    const byId = new Map(
      [...(containers ?? []), ...(locations ?? [])].map((r) => [r.id, r] as const),
    );

    // Where each container is: its places from the room down, the container itself left out.
    const paths = new Map<string, PlacePath>();
    const placeOf = (container: RecordEnvelope): PlacePath => {
      const known = paths.get(container.id);
      if (known) return known;
      const path: PlacePath = [];
      const seen = new Set([container.id]);
      let place = (container.attributes as ContainerAttributes).place;
      let position: string | undefined;
      while (place) {
        const id: string = 'location' in place ? place.location : place.container;
        if ('container' in place) position = place.position;
        const next = byId.get(id);
        if (!next || seen.has(id)) break;
        seen.add(id);
        path.unshift({
          id: next.id,
          name: next.name,
          label: next.label,
          ...(position ? { position } : {}),
        });
        position = undefined;
        place =
          next.kind === 'container'
            ? (next.attributes as ContainerAttributes).place
            : (next.attributes as LocationAttributes).parent
              ? { location: (next.attributes as LocationAttributes).parent as string }
              : undefined;
      }
      paths.set(container.id, path);
      return path;
    };

    // The wells of containers in use, by the lot or sample they hold.
    const live = (containers ?? []).filter(
      (c) => (c.attributes as ContainerAttributes).status !== 'discarded',
    );
    const liveIds = new Set(live.map((c) => c.id));
    const wells =
      liveIds.size === 0
        ? []
        : await deps.db
            .select({
              containerId: wellContents.containerId,
              well: wellContents.well,
              state: wellContents.state,
            })
            .from(wellContents)
            .where(
              and(
                eq(wellContents.labId, ctx.labId),
                inArray(wellContents.containerId, [...liveIds]),
              ),
            );
    const holding = new Map<string, Map<string, { wells: number; volumes: Quantity[] }>>();
    for (const { containerId, state } of wells) {
      for (const component of state.components) {
        const inSource = holding.get(component.source) ?? new Map();
        const here = inSource.get(containerId) ?? { wells: 0, volumes: [] };
        here.wells += 1;
        if (state.volume !== 'unknown') here.volumes.push(state.volume);
        inSource.set(containerId, here);
        holding.set(component.source, inSource);
      }
    }
    const inPlace = (path: PlacePath) => !input.place || path.some((p) => p.id === input.place);

    const batchOf = (record: RecordEnvelope): Batch | undefined => {
      const held = [...(holding.get(record.id) ?? new Map())].flatMap(([containerId, here]) => {
        const container = byId.get(containerId);
        if (!container) return [];
        const path = placeOf(container);
        const amount = volumeOf(here.volumes);
        return inPlace(path)
          ? [{ container: ref(container), path, wells: here.wells, ...(amount ? { amount } : {}) }]
          : [];
      });
      if (input.place && held.length === 0) return undefined;
      const lot = record.kind === 'lot' ? (record.attributes as Partial<LotAttributes>) : undefined;
      // A lot used up and in no container is history, not stock.
      if (lot?.status === 'used_up' && held.length === 0) return undefined;
      const amount = volumeOf(held.flatMap((h) => (h.amount ? [h.amount] : [])));
      return {
        batch: ref(record),
        ...(lot?.lotNumber ? { number: lot.lotNumber } : {}),
        ...(lot?.status ? { state: words(lot.status) } : {}),
        ...(lot?.expiry ? { expiry: lot.expiry } : {}),
        ...(amount ? { amount } : {}),
        containers: held.sort((a, b) => a.container.name.localeCompare(b.container.name)),
      };
    };

    const lotsOf = groupBy(lots ?? [], (l) => (l.attributes as Partial<LotAttributes>).product);
    const samplesOf = groupBy(
      samples ?? [],
      (s) => (s.attributes as Partial<SampleAttributes>).entity,
    );
    const kindLabels = new Map((entityKinds ?? []).map((k) => [k.id, k.label]));

    // An entity naming a product (refers_to) reads as one row with it.
    const named =
      (entities ?? []).length === 0
        ? []
        : await deps.db
            .select({ fromId: recordLinks.fromId, toId: recordLinks.toId })
            .from(recordLinks)
            .innerJoin(records, eq(records.id, recordLinks.toId))
            .where(
              and(
                eq(recordLinks.labId, ctx.labId),
                eq(recordLinks.relation, 'refers_to'),
                eq(records.kind, 'product'),
                ne(records.status, 'archived'),
              ),
            );
    const productsOfEntity = groupBy(named, (l) => l.fromId);
    const absorbed = new Set(named.map((l) => l.toId));
    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    const text = input.text?.toLowerCase();
    const matches = (things: RecordEnvelope[]) =>
      !text ||
      things.some(
        (t) => t.label.toLowerCase().includes(text) || t.name.toLowerCase().includes(text),
      );

    const rows: Row[] = [];
    const notInStock: Output['notInStock'] = [];
    const add = (
      thing: RecordEnvelope,
      type: Row['type'],
      category: string,
      linked: RecordEnvelope[],
      sources: RecordEnvelope[],
    ) => {
      if (!matches([thing, ...linked])) return;
      const batches = sources.flatMap((s) => batchOf(s) ?? []);
      if (batches.length === 0) {
        if (!input.place) notInStock.push({ ...ref(thing), type });
        return;
      }
      batches.sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'));
      const earliestExpiry = batches.flatMap((b) => (b.expiry ? [b.expiry] : [])).sort()[0];
      const amount = volumeOf(batches.flatMap((b) => (b.amount ? [b.amount] : [])));
      rows.push({
        thing: ref(thing),
        type,
        category,
        linked: linked.map(ref),
        batches,
        ...(amount ? { amount } : {}),
        ...(earliestExpiry ? { earliestExpiry } : {}),
        expired: !!earliestExpiry && earliestExpiry < today,
      });
    };

    if (input.type !== 'reagents') {
      for (const entity of entities ?? []) {
        const linked = (productsOfEntity.get(entity.id) ?? []).flatMap((l) => {
          const product = productById.get(l.toId);
          return product ? [product] : [];
        });
        const kind = (entity.attributes as Partial<EntityAttributes>).entityKind;
        add(
          entity,
          'material',
          (kind && kindLabels.get(kind)?.toLowerCase()) || 'material',
          linked,
          [...(samplesOf.get(entity.id) ?? []), ...linked.flatMap((p) => lotsOf.get(p.id) ?? [])],
        );
      }
    }
    if (input.type !== 'materials') {
      for (const product of products ?? []) {
        if (absorbed.has(product.id)) continue;
        const category = (product.attributes as Partial<ProductAttributes>).category;
        add(
          product,
          'reagent',
          category ? words(category) : 'reagent',
          [],
          lotsOf.get(product.id) ?? [],
        );
      }
    }
    rows.sort((a, b) => a.thing.label.localeCompare(b.thing.label));
    notInStock.sort((a, b) => a.label.localeCompare(b.label));
    return { rows, notInStock };
  },
});

/** Volumes added up and written readably; undefined when there are none. */
function volumeOf(volumes: Quantity[]): Quantity | undefined {
  const total = sum(volumes);
  return total ? readableVolume(total) : undefined;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k) map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

import {
  ContentsError,
  compare,
  computeWells,
  EMPTY_WELL_STATE,
  expandWells,
  formatQuantity,
  type Grid,
  LabwareError,
  mapPlates,
  mergeHandlingRules,
  mergeStorage,
  mix,
  newId,
  type PlateMapping,
  type SourcedRule,
  type SourcedStorage,
  take,
} from '@ailab/domain';
import {
  type Component,
  type ContainerAttributes,
  type EntityAttributes,
  type EntityKindAttributes,
  type InventoryEvent,
  type InventoryEventType,
  inventoryConsume,
  inventoryCorrect,
  inventoryDiscard,
  inventoryEffectiveRules,
  inventoryFill,
  inventoryHistory,
  inventoryLineage,
  inventoryMapPlates,
  inventoryStamp,
  inventoryTransfer,
  inventoryWells,
  type LabwareTypeAttributes,
  type LedgerLine,
  type LotAttributes,
  type ProductAttributes,
  type Quantity,
  type RecordEnvelope,
  type RuleOrigin,
  type SampleAttributes,
  samplesRegister,
  type WellState,
} from '@ailab/schema';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { inventoryEvents, inventoryLines, wellContents } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/** A container that holds liquid, with its wells and the limits its labware type sets. */
interface Vessel {
  record: RecordEnvelope;
  positions: string[];
  grid?: Grid;
  deadVolume?: Quantity;
  maxVolume?: Quantity;
}

const HOLDS_NOTHING = new Set(['rack', 'tip_rack', 'lid']);

async function vessel(service: RecordService, ctx: RecordContext, id: string): Promise<Vessel> {
  let record: RecordEnvelope;
  try {
    record = await service.get(ctx, id);
  } catch (error) {
    if (error instanceof RecordError && error.code === 'not_found') {
      throw new OperationError('invalid_input', `${id} is not a container in this lab`);
    }
    throw error;
  }
  if (record.kind !== 'container') {
    throw new OperationError('invalid_input', `${record.name} is not a container`);
  }
  const type = await service.get(ctx, (record.attributes as ContainerAttributes).labwareType);
  const attributes = type.attributes as LabwareTypeAttributes;
  if (HOLDS_NOTHING.has(attributes.family)) {
    throw new OperationError(
      'invalid_input',
      `${record.name} is a ${attributes.family.replace('_', ' ')}; it holds no liquid`,
    );
  }
  return {
    record,
    positions: attributes.wells ? computeWells(attributes.wells).map((w) => w.name) : ['A1'],
    ...(attributes.wells?.layout === 'grid'
      ? { grid: { rows: attributes.wells.rows, columns: attributes.wells.columns } }
      : {}),
    ...(attributes.deadVolume ? { deadVolume: attributes.deadVolume } : {}),
    ...(attributes.maxVolume ? { maxVolume: attributes.maxVolume } : {}),
  };
}

function wellsOf(v: Vessel, specs: string[]): string[] {
  try {
    return expandWells(specs, v.positions);
  } catch (error) {
    if (error instanceof LabwareError) {
      throw new OperationError('invalid_input', `${v.record.name}: ${error.message}`);
    }
    throw error;
  }
}

function isEmpty(state: WellState): boolean {
  return (
    state.components.length === 0 &&
    state.volume !== 'unknown' &&
    Number(state.volume.value) === 0 &&
    !state.assumed
  );
}

/**
 * Serializes inventory writes in a lab until the transaction ends, so two operations can't both
 * read a well's state and each write their own result over the other's. Taken before any well
 * is read; one lock per lab also covers wells that have no row yet and avoids lock-order deadlocks.
 */
async function lockInventory(db: Db, ctx: RecordContext) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${ctx.labId}`}))`);
}

/** Collects one event's changes, then writes the event, its lines and the new well states. */
class Ledger {
  #locked = false;
  readonly #states = new Map<string, WellState>();
  readonly #vessels = new Map<string, Vessel>();
  readonly #sources = new Set<string>();
  readonly lines: LedgerLine[] = [];
  readonly warnings: string[] = [];
  readonly service: RecordService;

  constructor(
    readonly db: Db,
    readonly ctx: RecordContext,
    readonly type: InventoryEventType,
    readonly operationId: string,
    readonly reason: string | undefined,
    service: RecordService,
  ) {
    this.service = service;
  }

  async vessel(id: string): Promise<Vessel> {
    if (!this.#locked) {
      await lockInventory(this.db, this.ctx);
      this.#locked = true;
    }
    let v = this.#vessels.get(id);
    if (!v) {
      v = await vessel(this.service, this.ctx, id);
      if ((v.record.attributes as ContainerAttributes).status === 'discarded') {
        throw new OperationError('invalid_input', `${v.record.name} is discarded`);
      }
      this.#vessels.set(id, v);
    }
    return v;
  }

  /** Refuses components whose source isn't a lot or sample in this lab. */
  async checkSources(components: { source: string }[]) {
    for (const { source } of components) {
      if (this.#sources.has(source)) continue;
      const record = await this.service.get(this.ctx, source).catch((error: unknown) => {
        if (error instanceof RecordError && error.code === 'not_found') return undefined;
        throw error;
      });
      if (record?.kind !== 'lot' && record?.kind !== 'sample') {
        throw new OperationError('invalid_input', `${source} is not a lot or sample in this lab`);
      }
      this.#sources.add(source);
    }
  }

  async state(v: Vessel, well: string): Promise<WellState> {
    const key = `${v.record.id}|${well}`;
    const known = this.#states.get(key);
    if (known) return known;
    const [row] = await this.db
      .select({ state: wellContents.state })
      .from(wellContents)
      .where(and(eq(wellContents.containerId, v.record.id), eq(wellContents.well, well)));
    return row?.state ?? EMPTY_WELL_STATE;
  }

  /** Records a well's new state, refusing an overfill and warning below the dead volume. */
  set(
    v: Vessel,
    well: string,
    after: WellState,
    line: Omit<LedgerLine, 'container' | 'well' | 'after'>,
  ) {
    const name = `${v.record.name} ${well}`;
    if (after.volume !== 'unknown') {
      if (line.change !== 'out' && v.maxVolume && compare(after.volume, v.maxVolume) > 0) {
        throw new OperationError(
          'invalid_input',
          `${name} would hold ${formatQuantity(after.volume)}, more than its ${formatQuantity(v.maxVolume)}`,
        );
      }
      if (
        line.change === 'out' &&
        v.deadVolume &&
        Number(after.volume.value) > 0 &&
        compare(after.volume, v.deadVolume) < 0
      ) {
        this.warnings.push(
          `${name} is left with ${formatQuantity(after.volume)}, below its dead volume of ${formatQuantity(v.deadVolume)}`,
        );
      }
    }
    this.#states.set(`${v.record.id}|${well}`, after);
    this.lines.push({ container: v.record.id, well, after, ...line } as LedgerLine);
  }

  async commit(): Promise<{ event: InventoryEvent; warnings: string[] }> {
    const at = new Date();
    const id = newId('iev');
    await this.db.insert(inventoryEvents).values({
      id,
      orgId: this.ctx.orgId,
      labId: this.ctx.labId,
      type: this.type,
      at,
      actor: this.ctx.actor,
      operationId: this.operationId,
      reason: this.reason ?? null,
    });
    await this.db.insert(inventoryLines).values(
      this.lines.map((l, seq) => ({
        eventId: id,
        seq,
        containerId: l.container,
        well: l.well,
        change: l.change,
        volume: l.volume ?? null,
        from: l.from ?? null,
        to: l.to ?? null,
        added: l.added ?? null,
        after: l.after,
      })),
    );
    for (const [key, state] of this.#states) {
      const [containerId, well] = key.split('|') as [string, string];
      if (isEmpty(state)) {
        await this.db
          .delete(wellContents)
          .where(and(eq(wellContents.containerId, containerId), eq(wellContents.well, well)));
        continue;
      }
      await this.db
        .insert(wellContents)
        .values({
          containerId,
          well,
          orgId: this.ctx.orgId,
          labId: this.ctx.labId,
          state,
          lastEventId: id,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [wellContents.containerId, wellContents.well],
          set: { state, lastEventId: id, updatedAt: at },
        });
    }
    return {
      event: {
        id,
        type: this.type,
        at: at.toISOString(),
        actor: this.ctx.actor,
        operationId: this.operationId,
        ...(this.reason ? { reason: this.reason } : {}),
        lines: this.lines,
      },
      warnings: this.warnings,
    };
  }
}

function contentsProblem(name: string, error: unknown): never {
  if (error instanceof ContentsError)
    throw new OperationError('invalid_input', `${name}: ${error.message}`);
  throw error;
}

const touchesContainer = (input: { container: string }) => [input.container];

function gridOf(v: Vessel): Grid {
  if (!v.grid)
    throw new OperationError('invalid_input', `${v.record.name} has no grid of wells to map`);
  return v.grid;
}

function mapped(from: Grid, to: Grid, mapping: PlateMapping, wells?: string[]) {
  try {
    return mapPlates(from, to, mapping, wells);
  } catch (error) {
    contentsProblem('Mapping', error);
  }
}

const mappingWords = (m: PlateMapping) =>
  m.type === 'one_to_one'
    ? 'one to one'
    : m.type === 'quadrant'
      ? `into quadrant ${m.quadrant}`
      : `shifted ${m.rows} rows and ${m.columns} columns`;

const originOf = (record: RecordEnvelope): RuleOrigin => ({
  id: record.id,
  kind: record.kind as RuleOrigin['kind'],
  name: record.name,
  label: record.label,
});

/**
 * The records whose handling rules a component brings (plan 010d): a lot its product, a sample its
 * entity and the entity's kind.
 */
async function ruleRecords(service: RecordService, ctx: RecordContext, source: string) {
  const record = await service.get(ctx, source);
  if (record.kind === 'lot') {
    return [await service.get(ctx, (record.attributes as LotAttributes).product)];
  }
  const entity = await service.get(ctx, (record.attributes as SampleAttributes).entity);
  return [await service.get(ctx, (entity.attributes as EntityAttributes).entityKind), entity];
}

export const contentsOperations = [
  implement(samplesRegister, {
    agentPolicy: 'propose',
    run: async (ctx, { label, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'sample',
        label,
        status: 'active',
        attributes,
        reason: reason ?? `Registered ${label}`,
      }),
  }),
  implement(inventoryDiscard, {
    agentPolicy: 'propose',
    touches: (input) => [input.container],
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await service.get(ctx, input.container).catch((error: unknown) => {
        if (error instanceof RecordError && error.code === 'not_found') return undefined;
        throw error;
      });
      if (record?.kind !== 'container') {
        throw new OperationError(
          'invalid_input',
          `${input.container} is not a container in this lab`,
        );
      }
      const attributes = record.attributes as ContainerAttributes;
      if (attributes.status === 'discarded') {
        throw new OperationError('invalid_input', `${record.name} is already discarded`);
      }
      const held = (await service.list(ctx, { kind: 'container', limit: 50_000 })).filter((c) => {
        const a = c.attributes as ContainerAttributes;
        return (
          a.status !== 'discarded' &&
          a.place &&
          'container' in a.place &&
          a.place.container === record.id
        );
      });
      if (held.length > 0) {
        throw new OperationError(
          'invalid_input',
          `${record.name} still holds ${held.map((c) => c.name).join(', ')}; move or discard them first`,
        );
      }
      await lockInventory(deps.db, ctx);
      const rows = await deps.db
        .select({ well: wellContents.well })
        .from(wellContents)
        .where(eq(wellContents.containerId, record.id));
      let event: InventoryEvent | undefined;
      if (rows.length > 0) {
        const ledger = new Ledger(
          deps.db,
          ctx,
          'discard',
          inventoryDiscard.id,
          input.reason,
          service,
        );
        const v = await ledger.vessel(record.id);
        for (const { well } of rows) ledger.set(v, well, EMPTY_WELL_STATE, { change: 'set' });
        event = (await ledger.commit()).event;
      }
      const container = await service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...attributes, status: 'discarded' },
        reason: input.reason ?? 'Discarded',
      });
      return { container, ...(event ? { event } : {}) };
    },
  }),
  implement(inventoryFill, {
    agentPolicy: 'propose',
    touches: touchesContainer,
    run: async (ctx, input, deps) => {
      const ledger = new Ledger(
        deps.db,
        ctx,
        'fill',
        inventoryFill.id,
        input.reason,
        new RecordService(deps.db, deps.kinds),
      );
      const v = await ledger.vessel(input.container);
      for (const fill of input.fills) {
        await ledger.checkSources(fill.components);
        for (const well of wellsOf(v, fill.wells)) {
          const before = await ledger.state(v, well);
          const after = mix(before, {
            volume: fill.volume,
            components: fill.components,
            ...(fill.assumed ? { assumed: true } : {}),
          });
          ledger.set(v, well, after, { change: 'in', volume: fill.volume, added: fill.components });
        }
      }
      return ledger.commit();
    },
  }),
  implement(inventoryTransfer, {
    agentPolicy: 'propose',
    touches: (input) => [
      ...new Set(input.transfers.flatMap((t) => [t.from.container, t.to.container])),
    ],
    run: async (ctx, input, deps) => {
      const ledger = new Ledger(
        deps.db,
        ctx,
        'transfer',
        inventoryTransfer.id,
        input.reason,
        new RecordService(deps.db, deps.kinds),
      );
      for (const t of input.transfers) {
        const from = await ledger.vessel(t.from.container);
        const to = await ledger.vessel(t.to.container);
        const [fromWell] = wellsOf(from, [t.from.well]) as [string];
        const [toWell] = wellsOf(to, [t.to.well]) as [string];
        if (from.record.id === to.record.id && fromWell === toWell) {
          throw new OperationError(
            'invalid_input',
            `${from.record.name} ${fromWell} is both source and destination`,
          );
        }
        const source = await ledger.state(from, fromWell);
        let taken: ReturnType<typeof take>;
        try {
          taken = take(source, t.volume);
        } catch (error) {
          contentsProblem(`${from.record.name} ${fromWell}`, error);
        }
        ledger.set(from, fromWell, taken.left, {
          change: 'out',
          volume: t.volume,
          to: { container: to.record.id, well: toWell },
        });
        const destination = await ledger.state(to, toWell);
        ledger.set(to, toWell, mix(destination, taken.portion), {
          change: 'in',
          volume: t.volume,
          from: { container: from.record.id, well: fromWell },
        });
      }
      return ledger.commit();
    },
  }),
  implement(inventoryConsume, {
    agentPolicy: 'propose',
    touches: touchesContainer,
    run: async (ctx, input, deps) => {
      const ledger = new Ledger(
        deps.db,
        ctx,
        'consume',
        inventoryConsume.id,
        input.reason,
        new RecordService(deps.db, deps.kinds),
      );
      const v = await ledger.vessel(input.container);
      for (const well of wellsOf(v, input.wells)) {
        const before = await ledger.state(v, well);
        try {
          ledger.set(v, well, take(before, input.volume).left, {
            change: 'out',
            volume: input.volume,
          });
        } catch (error) {
          contentsProblem(`${v.record.name} ${well}`, error);
        }
      }
      return ledger.commit();
    },
  }),
  implement(inventoryCorrect, {
    agentPolicy: 'propose',
    touches: touchesContainer,
    run: async (ctx, input, deps) => {
      const ledger = new Ledger(
        deps.db,
        ctx,
        'correct',
        inventoryCorrect.id,
        input.reason,
        new RecordService(deps.db, deps.kinds),
      );
      const v = await ledger.vessel(input.container);
      await ledger.checkSources(input.state.components);
      for (const well of wellsOf(v, input.wells)) {
        ledger.set(v, well, input.state, { change: 'set' });
      }
      return ledger.commit();
    },
  }),
  implement(inventoryMapPlates, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const side = async (x: string | Grid) => {
        if (typeof x !== 'string')
          return { grid: x, positions: undefined, name: `${x.rows} × ${x.columns}` };
        const v = await vessel(service, ctx, x);
        return { grid: gridOf(v), positions: v.positions, name: v.record.name };
      };
      const from = await side(input.from);
      const to = await side(input.to);
      let wells: string[] | undefined;
      if (input.wells) {
        const positions =
          from.positions ??
          computeWells({ layout: 'grid', rows: from.grid.rows, columns: from.grid.columns }).map(
            (w) => w.name,
          );
        try {
          wells = expandWells(input.wells, positions);
        } catch (error) {
          if (error instanceof LabwareError)
            throw new OperationError('invalid_input', error.message);
          throw error;
        }
      }
      const pairs = mapped(from.grid, to.grid, input.mapping, wells);
      return {
        pairs,
        explanation: `${pairs.length} wells of ${from.name} land on ${to.name} ${mappingWords(input.mapping)}${pairs[0] ? `: ${pairs[0].from} goes to ${pairs[0].to}` : ''}.`,
      };
    },
  }),
  implement(inventoryStamp, {
    agentPolicy: 'propose',
    touches: (input) => [input.from, input.to],
    run: async (ctx, input, deps) => {
      const ledger = new Ledger(
        deps.db,
        ctx,
        'stamp',
        inventoryStamp.id,
        input.reason,
        new RecordService(deps.db, deps.kinds),
      );
      const from = await ledger.vessel(input.from);
      const to = await ledger.vessel(input.to);
      if (from.record.id === to.record.id) {
        throw new OperationError(
          'invalid_input',
          'A plate can’t be stamped onto itself; use inventory.transfer',
        );
      }
      let wells = input.wells ? wellsOf(from, input.wells) : undefined;
      if (!wells) {
        const rows = await deps.db
          .select({ well: wellContents.well })
          .from(wellContents)
          .where(eq(wellContents.containerId, from.record.id));
        const filled = new Set(rows.map((r) => r.well));
        wells = from.positions.filter((p) => filled.has(p));
        if (wells.length === 0)
          throw new OperationError('invalid_input', `${from.record.name} is empty`);
      }
      for (const pair of mapped(gridOf(from), gridOf(to), input.mapping, wells)) {
        const source = await ledger.state(from, pair.from);
        let taken: ReturnType<typeof take>;
        try {
          taken = take(source, input.volume);
        } catch (error) {
          contentsProblem(`${from.record.name} ${pair.from}`, error);
        }
        ledger.set(from, pair.from, taken.left, {
          change: 'out',
          volume: input.volume,
          to: { container: to.record.id, well: pair.to },
        });
        ledger.set(to, pair.to, mix(await ledger.state(to, pair.to), taken.portion), {
          change: 'in',
          volume: input.volume,
          from: { container: from.record.id, well: pair.from },
        });
      }
      return ledger.commit();
    },
  }),
  implement(inventoryLineage, {
    run: async (ctx, input, deps) => {
      const v = await vessel(new RecordService(deps.db, deps.kinds), ctx, input.container);
      const [well] = wellsOf(v, [input.well]) as [string];
      const maxDepth = input.depth ?? 5;
      const steps: {
        to: { container: string; well: string };
        from?: { container: string; well: string };
        volume?: Quantity;
        components?: Component[];
        eventId: string;
        type: string;
        at: string;
        depth: number;
      }[] = [];
      // Each well is followed back from the time liquid left it for the well asked about.
      let frontier: { container: string; well: string; before?: Date }[] = [
        { container: v.record.id, well },
      ];
      const seen = new Set<string>();
      for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: typeof frontier = [];
        for (const at of frontier) {
          const key = `${at.container}|${at.well}|${at.before?.toISOString() ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const rows = await deps.db
            .select({ line: inventoryLines, event: inventoryEvents })
            .from(inventoryLines)
            .innerJoin(inventoryEvents, eq(inventoryLines.eventId, inventoryEvents.id))
            .where(
              and(
                eq(inventoryEvents.labId, ctx.labId),
                eq(inventoryLines.containerId, at.container),
                eq(inventoryLines.well, at.well),
                eq(inventoryLines.change, 'in'),
                ...(at.before ? [lte(inventoryEvents.at, at.before)] : []),
              ),
            )
            .orderBy(desc(inventoryEvents.at), desc(inventoryLines.seq));
          for (const { line, event } of rows) {
            steps.push({
              to: { container: line.containerId, well: line.well },
              ...(line.from ? { from: line.from } : {}),
              ...(line.volume ? { volume: line.volume } : {}),
              ...(line.added ? { components: line.added } : {}),
              eventId: event.id,
              type: event.type,
              at: event.at.toISOString(),
              depth,
            });
            if (line.from) next.push({ ...line.from, before: event.at });
          }
        }
        frontier = next;
      }
      return { steps };
    },
  }),
  implement(inventoryWells, {
    run: async (ctx, input, deps) => {
      const v = await vessel(new RecordService(deps.db, deps.kinds), ctx, input.container);
      const rows = await deps.db
        .select({ well: wellContents.well, state: wellContents.state })
        .from(wellContents)
        .where(and(eq(wellContents.containerId, v.record.id), eq(wellContents.labId, ctx.labId)));
      const order = new Map(v.positions.map((p, i) => [p, i]));
      rows.sort((a, b) => (order.get(a.well) ?? 0) - (order.get(b.well) ?? 0));
      return { container: v.record, positions: v.positions, wells: rows };
    },
  }),
  implement(inventoryEffectiveRules, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const v = await vessel(service, ctx, input.container);
      const only = input.wells ? new Set(wellsOf(v, input.wells)) : undefined;
      const rows = await deps.db
        .select({ well: wellContents.well, state: wellContents.state })
        .from(wellContents)
        .where(and(eq(wellContents.containerId, v.record.id), eq(wellContents.labId, ctx.labId)));
      const wellsBySource = new Map<string, string[]>();
      for (const { well, state } of rows) {
        if (only && !only.has(well)) continue;
        for (const c of (state as WellState).components) {
          wellsBySource.set(c.source, [...(wellsBySource.get(c.source) ?? []), well]);
        }
      }
      const rules: SourcedRule[] = [];
      const storage: SourcedStorage[] = [];
      for (const [via, wells] of wellsBySource) {
        for (const record of await ruleRecords(service, ctx, via)) {
          const origin = originOf(record);
          const attributes = record.attributes as
            | ProductAttributes
            | EntityAttributes
            | EntityKindAttributes;
          for (const rule of attributes.handlingRules ?? []) {
            rules.push({ rule, origin, via, wells });
          }
          if ('storage' in attributes && attributes.storage) {
            storage.push({ range: attributes.storage, origin, via, wells });
          }
        }
      }
      const merged = mergeStorage(storage);
      return {
        container: v.record,
        rules: mergeHandlingRules(rules),
        ...(merged ? { storage: merged } : {}),
      };
    },
  }),
  implement(inventoryHistory, {
    run: async (ctx, input, deps) => {
      const v = await vessel(new RecordService(deps.db, deps.kinds), ctx, input.container);
      const touched = deps.db
        .selectDistinct({ id: inventoryLines.eventId })
        .from(inventoryLines)
        .where(
          and(
            eq(inventoryLines.containerId, v.record.id),
            ...(input.well ? [eq(inventoryLines.well, input.well)] : []),
          ),
        );
      const events = await deps.db
        .select()
        .from(inventoryEvents)
        .where(and(eq(inventoryEvents.labId, ctx.labId), inArray(inventoryEvents.id, touched)))
        .orderBy(desc(inventoryEvents.at), desc(inventoryEvents.id))
        .limit(input.limit ?? 50);
      if (events.length === 0) return { events: [] };
      const lines = await deps.db
        .select()
        .from(inventoryLines)
        .where(
          inArray(
            inventoryLines.eventId,
            events.map((e) => e.id),
          ),
        )
        .orderBy(inventoryLines.eventId, inventoryLines.seq);
      return {
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          at: e.at.toISOString(),
          actor: e.actor,
          operationId: e.operationId,
          ...(e.reason ? { reason: e.reason } : {}),
          lines: lines
            .filter((l) => l.eventId === e.id)
            .map((l) => ({
              container: l.containerId,
              well: l.well,
              change: l.change,
              ...(l.volume ? { volume: l.volume } : {}),
              ...(l.from ? { from: l.from } : {}),
              ...(l.to ? { to: l.to } : {}),
              ...(l.added ? { added: l.added } : {}),
              after: l.after,
            })) as LedgerLine[],
        })),
      };
    },
  }),
];

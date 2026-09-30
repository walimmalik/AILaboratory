import {
  ContentsError,
  compare,
  computeWells,
  EMPTY_WELL_STATE,
  expandWells,
  formatQuantity,
  LabwareError,
  mix,
  newId,
  take,
} from '@ailab/domain';
import {
  type ContainerAttributes,
  type InventoryEvent,
  type InventoryEventType,
  inventoryConsume,
  inventoryCorrect,
  inventoryFill,
  inventoryHistory,
  inventoryTransfer,
  inventoryWells,
  type LabwareTypeAttributes,
  type LedgerLine,
  type Quantity,
  type RecordEnvelope,
  type WellState,
} from '@ailab/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
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

/** Collects one event's changes, then writes the event, its lines and the new well states. */
class Ledger {
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

export const contentsOperations = [
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
          ledger.set(v, well, after, { change: 'in', volume: fill.volume });
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
              after: l.after,
            })) as LedgerLine[],
        })),
      };
    },
  }),
];

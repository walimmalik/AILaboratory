import {
  add,
  compare,
  convert,
  formatQuantity,
  subtract,
  TransferError,
  UnitError,
} from '@ailab/domain';
import {
  type InstrumentAttributes,
  type LabwareTypeAttributes,
  type Quantity,
  type TransferGroup,
  type TransferPlanAttributes,
  transfersCheck,
  transfersDraft,
  transfersPickSources,
  transfersReserved,
  transfersSetInstrument,
  type WellState,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { deviceOf, deviceOut, run } from './calculators.ts';
import { deckChanged, draftDecks, flexSetup } from './decks.ts';
import { drawsOf, reservations, totalOf } from './reservations.ts';
import { limitsOf, moveProblem, planRules, type Rule, tipsOf } from './rules.ts';

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);
const UL = 'uL';

async function planOf(deps: OperationDeps, ctx: RecordContext, id: string) {
  const record = await service(deps)
    .get(ctx, id)
    .catch(() => undefined);
  if (record?.kind !== 'transfer_plan')
    throw new OperationError('not_found', `${id} is not a transfer plan in this lab`);
  return { record, a: record.attributes as TransferPlanAttributes };
}

/** A group with its device limits copied from its instrument, or none when done by hand. */
async function withDevice(
  deps: OperationDeps,
  ctx: RecordContext,
  group: Omit<TransferGroup, 'device'>,
): Promise<TransferGroup> {
  if (!group.instrument) return group;
  const device = await deviceOf(deps, ctx, group.instrument);
  return { ...group, device: deviceOut(device) };
}

async function wellsHeld(deps: OperationDeps, ctx: RecordContext, container: string) {
  const held = await run<{ wells: { well: string; state: WellState }[] }>(
    deps,
    ctx,
    'inventory.wells',
    {
      container,
    },
  );
  return new Map(held.wells.map((w) => [w.well, w.state.volume]));
}

const sameQuantity = (a: Quantity | undefined, b: Quantity | undefined) => {
  if (a === undefined || b === undefined) return a === b;
  try {
    return compare(a, b) === 0;
  } catch (error) {
    if (error instanceof UnitError) return false;
    throw error;
  }
};

const sameLimits = (a: TransferGroup['device'], b: TransferGroup['device']) =>
  sameQuantity(a?.min, b?.min) && sameQuantity(a?.max, b?.max) && sameQuantity(a?.step, b?.step);

/** Transfer plan operations (plan 016a-3). */
export const transferPlanOperations = [
  implement(transfersDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, groups, ...rest }, deps) => {
      const withDevices: TransferGroup[] = [];
      for (const g of groups) withDevices.push(await withDevice(deps, ctx, g));
      const attributes: TransferPlanAttributes = { ...rest, groups: withDevices };
      const decks = await draftDecks(deps, ctx, attributes);
      return service(deps).create(ctx, {
        kind: 'transfer_plan',
        label,
        attributes: { ...attributes, ...(decks.length ? { decks } : {}) },
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the transfer plan ${label}`,
      });
    },
  }),
  implement(transfersSetInstrument, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const { record, a } = await planOf(deps, ctx, input.id);
      const at = a.groups.findIndex((g) => g.id === input.group);
      if (at < 0) throw new OperationError('invalid_input', `The plan has no group ${input.group}`);
      const {
        instrument: _i,
        device: _d,
        reason: _r,
        liquidClass: _l,
        tips: _t,
        worklist: _w,
        ...keep
      } = a.groups[at] as TransferGroup;
      const liquidClass = input.liquidClass;
      const group = await withDevice(deps, ctx, {
        ...keep,
        reason: input.why,
        ...(input.instrument ? { instrument: input.instrument } : {}),
        ...(liquidClass ? { liquidClass } : {}),
        ...(input.tips ? { tips: input.tips } : {}),
        ...(input.worklist ? { worklist: input.worklist } : {}),
      });
      const groups = a.groups.map((g, i) => (i === at ? group : g));
      const { decks: _decks, ...rest } = a;
      const decks = await draftDecks(deps, ctx, { ...a, groups }, [group.id]);
      return service(deps).update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...rest, groups, ...(decks.length ? { decks } : {}) },
        reason: `${keep.label}: ${group.device ? `now on ${group.device.label}` : 'now by hand'}. ${input.why}`,
      });
    },
  }),
  implement(transfersPickSources, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const { record, a } = await planOf(deps, ctx, input.id);
      const picks = new Map(input.picks.map((p) => [p.plate, p.container]));
      for (const plate of picks.keys()) {
        const p = a.plates.find((x) => x.id === plate);
        if (!p) throw new OperationError('invalid_input', `The plan has no plate ${plate}`);
        if (p.role !== 'source')
          throw new OperationError('invalid_input', `${plate} is a ${p.role} plate, not a source`);
      }
      const names: string[] = [];
      for (const container of picks.values()) {
        const c = await service(deps)
          .get(ctx, container)
          .catch(() => undefined);
        if (c?.kind !== 'container')
          throw new OperationError('not_found', `${container} is not a container in this lab`);
        names.push(c.name);
      }
      return service(deps).update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          plates: a.plates.map((p) =>
            picks.has(p.id) ? { ...p, container: picks.get(p.id) as string } : p,
          ),
        },
        reason: input.reason ?? `Picked ${names.join(', ')}`,
      });
    },
  }),
  implement(transfersCheck, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const { record, a } = await planOf(deps, ctx, input.id);
      const records = service(deps);
      const context = {
        get: (id: string) => records.get(ctx, id).catch(() => undefined),
        getVersion: async (id: string, version: number) =>
          (await records.history(ctx, id).catch(() => [])).find((v) => v.version === version)
            ?.snapshot,
      };
      const { invalid, rules, labware, methods } = await planRules(a, context);
      const live: Rule[] = [];

      // Each instrument now: ready, and still with the limits the plan used.
      const changed: string[] = [];
      for (const g of a.groups) {
        if (!g.instrument) continue;
        const instrument = await context.get(g.instrument.instrument);
        const status = (instrument?.attributes as InstrumentAttributes | undefined)?.status;
        if (instrument && status !== 'ready' && status !== 'in_use')
          changed.push(`${instrument.label} is ${status?.replaceAll('_', ' ')}`);
        const now = await deviceOf(deps, ctx, g.instrument).then(deviceOut, (e: unknown) =>
          e instanceof OperationError ? e.message : Promise.reject(e),
        );
        if (typeof now === 'string') changed.push(`${g.label}: ${now}`);
        else if (!sameLimits(now, g.device)) {
          changed.push(`${g.label}: ${now.label}'s limits changed since the plan was worked out`);
          const limits = limitsOf({ ...g, device: now });
          const misfit = limits
            ? g.transfers.filter((t) => {
                try {
                  return moveProblem(t.volume, limits) !== undefined;
                } catch (error) {
                  if (error instanceof TransferError) return true;
                  throw error;
                }
              }).length
            : 0;
          if (misfit) changed.push(`${g.label}: ${misfit} transfers no longer fit`);
        }
      }
      // Each deck layout against its Flex now.
      const decksNow: string[] = [];
      for (const deck of a.decks ?? []) {
        const g = a.groups.find((x) => x.id === deck.group);
        if (!g) continue;
        const now = await flexSetup(deps, ctx, g).catch((e: unknown) =>
          e instanceof OperationError ? e.message : Promise.reject(e),
        );
        if (typeof now === 'string') decksNow.push(`${g.label}: ${now}`);
        else if (now) decksNow.push(...deckChanged(deck, now).map((p) => `${g.label}: ${p}`));
      }
      live.push({
        id: 'decks_now',
        label: 'The deck layouts fit the instruments as installed now',
        severity: 'warning',
        section: 'decks',
        problems: decksNow,
        fix: 'Lay the deck out again with transfers.set_deck, or change the instrument back',
      });
      live.push({
        id: 'instruments_now',
        label: 'The instruments are ready as planned',
        severity: 'warning',
        section: 'transfers',
        problems: [...new Set(changed)],
        fix: 'Set the group to the instrument again to take its limits now, or pick another',
      });

      // Each source well: what is drawn plus dead volume, against what it holds less other plans.
      const reserved = await reservations(deps, ctx, record.id);
      const short: string[] = [];
      const byContainer = new Map<string, string>();
      for (const p of a.plates)
        if (p.container && p.role === 'source') byContainer.set(p.container, p.id);
      const held = new Map<string, Map<string, WellState['volume']>>();
      for (const [key, drawn] of drawsOf(a)) {
        const [container, well] = key.split('|') as [string, string];
        if (!held.has(container)) held.set(container, await wellsHeld(deps, ctx, container));
        const plate = byContainer.get(container) as string;
        const type = labware.get(plate)?.attributes as LabwareTypeAttributes | undefined;
        const dead = type?.deadVolume ? convert(type.deadVolume, UL) : undefined;
        const needed = dead ? add(drawn, dead) : drawn;
        const volume = held.get(container)?.get(well);
        const name = (await context.get(container))?.name ?? container;
        if (volume === 'unknown') {
          short.push(`${name} ${well}: how much it holds is not known`);
          continue;
        }
        const holds = volume ?? { value: '0', unit: UL };
        const others = totalOf(reserved.get(key));
        const available = others ? subtract(convert(holds, UL), others) : holds;
        if (compare(available, needed) < 0)
          short.push(
            `${name} ${well} needs ${formatQuantity(needed)}${dead ? ' with dead volume' : ''}; it has ${formatQuantity(available)}${others ? ` after ${formatQuantity(others)} reserved by other plans` : ''}`,
          );
      }
      live.push({
        id: 'sources_enough',
        label: 'The sources hold enough',
        severity: 'warning',
        section: 'plates',
        problems: short,
        fix: 'Pick fuller containers with transfers.pick_sources, or top them up first',
      });

      const all = [
        ...(invalid.length
          ? [
              {
                id: 'valid',
                label: 'The plan adds up',
                severity: 'blocker' as const,
                section: 'plates' as const,
                problems: [...new Set(invalid)],
                fix: 'Fix what it names',
              },
            ]
          : []),
        ...rules,
        ...live,
      ];
      return {
        ok: all.every((r) => r.severity !== 'blocker' || r.problems.length === 0),
        checks: all.map((r) => ({
          id: r.id,
          label: r.label,
          severity: r.severity,
          passed: r.problems.length === 0,
          problems:
            r.problems.length > 20
              ? [...r.problems.slice(0, 20), `and ${r.problems.length - 20} more`]
              : r.problems,
        })),
        totals: {
          transfers: a.groups.reduce((n, g) => n + g.transfers.length, 0),
          tips: tipsOf(a, methods),
          sources: drawsOf(a).size,
        },
      };
    },
  }),
  implement(transfersReserved, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const c = await service(deps)
        .get(ctx, input.container)
        .catch(() => undefined);
      if (c?.kind !== 'container')
        throw new OperationError('not_found', `${input.container} is not a container in this lab`);
      const all = await reservations(deps, ctx);
      const wells = [...all]
        .filter(([key]) => key.startsWith(`${c.id}|`))
        .map(([key, list]) => ({
          well: key.split('|')[1] as string,
          reserved: totalOf(list) as Quantity,
          plans: list.map((r) => ({ id: r.plan.id, name: r.plan.name, volume: r.volume })),
        }));
      return { wells };
    },
  }),
];

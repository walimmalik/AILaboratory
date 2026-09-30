import {
  compare,
  type DeviceLimits,
  type DeviceOption,
  dilutionOptions,
  optimizeDilution,
  rankDevices,
  sourceVolumes,
  subtract,
  type TipRule,
  TransferError,
} from '@ailab/domain';
import {
  type ClassChoice,
  type ContainerAttributes,
  type InstrumentAttributes,
  type LabwareTypeAttributes,
  type Quantity,
  type RecordEnvelope,
  type ResolvedConfiguration,
  ROOT_NODE,
  type TransferDevice,
  transfersDilutionOptions,
  transfersOptimizeDilution,
  transfersOptions,
  transfersSourceVolumes,
  type WellState,
} from '@ailab/schema';
import type { z } from 'zod';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * The transfer calculators (plan 016a-2, T2): read operations over the transfer math in
 * `packages/domain/src/transfers.ts`, with devices, labware and wells read from the lab's records.
 */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

const MOVES = ['transfer', 'dispense'];

/** Domain refusals become invalid input, in the domain's words. */
async function calculating<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TransferError) throw new OperationError('invalid_input', error.message);
    throw error;
  }
}

async function run<T>(deps: OperationDeps, ctx: RecordContext, id: string, input: unknown) {
  const result = await deps.registry.execute(ctx, id, input, {}, deps.db);
  if (result.status !== 'done') throw new OperationError('invalid_state', `${id} did not run`);
  return result.output as T;
}

async function recordOf(
  deps: OperationDeps,
  ctx: RecordContext,
  id: string,
  kind: string,
  noun: string,
) {
  const record = await service(deps)
    .get(ctx, id)
    .catch(() => undefined);
  if (record?.kind !== kind)
    throw new OperationError('not_found', `${id} is not ${noun} in this lab`);
  return record;
}

interface Device {
  label: string;
  limits: DeviceLimits;
}

const limitsOf = (c: ResolvedConfiguration['capabilities'][number]): DeviceLimits => ({
  min: c.limits?.volume?.min,
  max: c.limits?.volume?.max,
  step: c.limits?.volumeStep,
});
const hasVolume = (l: DeviceLimits) => !!(l.min || l.max || l.step);
const nodeLabel = (instrument: RecordEnvelope, node: string) => {
  const a = instrument.attributes as InstrumentAttributes;
  const eq = a.configuration.equipment.find((e) => e.id === node);
  return node === ROOT_NODE ? instrument.label : `${instrument.label} (${eq?.label ?? node})`;
};

/** The device a calculation uses: an instrument's transfer or dispense limits, or limits given. */
async function deviceOf(
  deps: OperationDeps,
  ctx: RecordContext,
  device: z.infer<typeof TransferDevice>,
): Promise<Device> {
  if ('limits' in device) return { label: 'The limits given', limits: device.limits };
  const instrument = await recordOf(deps, ctx, device.instrument, 'instrument', 'an instrument');
  const resolved = await run<ResolvedConfiguration>(deps, ctx, 'instruments.resolve', {
    instrument: instrument.id,
  });
  const moving = resolved.capabilities.filter(
    (c) =>
      MOVES.includes(c.capability) &&
      hasVolume(limitsOf(c)) &&
      (device.node === undefined || c.node === device.node),
  );
  const nodes = [...new Set(moving.map((c) => c.node))];
  if (nodes.length === 0)
    throw new OperationError(
      'invalid_input',
      `${instrument.name} has nothing${device.node ? ` called ${device.node}` : ''} that transfers or dispenses with known volume limits`,
    );
  if (nodes.length > 1)
    throw new OperationError(
      'invalid_input',
      `${instrument.name} has more than one device that moves liquid (${nodes.join(', ')}); say which as node`,
    );
  const c = moving[0] as ResolvedConfiguration['capabilities'][number];
  return { label: nodeLabel(instrument, c.node), limits: limitsOf(c) };
}

const deviceOut = (d: Device) => ({
  label: d.label,
  ...(d.limits.min ? { min: d.limits.min } : {}),
  ...(d.limits.max ? { max: d.limits.max } : {}),
  ...(d.limits.step ? { step: d.limits.step } : {}),
});

/** A plate type's well count, from its grid. */
function wellsOf(type: RecordEnvelope): number {
  const w = (type.attributes as LabwareTypeAttributes).wells;
  if (w?.layout === 'grid') return w.rows * w.columns;
  if (w?.layout === 'explicit') return w.wells.length;
  throw new OperationError('invalid_input', `${type.name} has no wells`);
}

/**
 * How a device uses tips, until methods declare it (T5; 016c): nothing for dispensers and for
 * acoustic transfer (a droplet step and no channels), the lab default otherwise. Estimated.
 */
function tipsOf(c: ResolvedConfiguration['capabilities'][number]): TipRule {
  if (c.capability === 'dispense') return 'none';
  if (c.limits?.volumeStep && !c.limits.channels && c.performedBy === 'machine') return 'none';
  return 'lab_default';
}

export const transferCalculators = [
  implement(transfersDilutionOptions, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const device = await deviceOf(deps, ctx, input.device);
      return calculating(() => ({
        device: deviceOut(device),
        points: dilutionOptions({
          stock: input.stock,
          targets: input.targets,
          finalVolume: input.finalVolume,
          device: device.limits,
          maxSolventPercent: input.maxSolventPercent,
          tolerance: input.tolerance,
          ...(input.factors ? { factors: input.factors } : {}),
        }),
      }));
    },
  }),
  implement(transfersOptimizeDilution, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const device = await deviceOf(deps, ctx, input.device);
      const plate = await recordOf(
        deps,
        ctx,
        input.intermediatePlate,
        'labware_type',
        'a labware type',
      );
      const a = plate.attributes as LabwareTypeAttributes;
      const maxVolume = a.workingVolume?.max ?? a.maxVolume;
      if (!a.deadVolume || !maxVolume)
        throw new OperationError(
          'invalid_input',
          `${plate.name} needs a dead volume and a working or maximum volume to plan intermediate wells`,
        );
      return calculating(() => ({
        device: deviceOut(device),
        ...optimizeDilution({
          compounds: input.compounds.map(({ wellsPerPoint, ...c }) => ({
            ...c,
            ...(wellsPerPoint ? { wellsPerPoint } : {}),
          })),
          finalVolume: input.finalVolume,
          device: device.limits,
          maxSolventPercent: input.maxSolventPercent,
          tolerance: input.tolerance ?? '0.05',
          intermediatePlate: {
            wells: wellsOf(plate),
            deadVolume: a.deadVolume as Quantity,
            maxVolume,
          },
          ...(input.factors ? { factors: input.factors } : {}),
        }),
      }));
    },
  }),
  implement(transfersSourceVolumes, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const notes: string[] = [];
      const containers = new Map<
        string,
        { record: RecordEnvelope; dead?: Quantity; wells: Map<string, WellState> }
      >();
      for (const id of new Set(input.draws.map((d) => d.container))) {
        const record = await recordOf(deps, ctx, id, 'container', 'a container');
        const type = await service(deps)
          .get(ctx, (record.attributes as ContainerAttributes).labwareType)
          .catch(() => undefined);
        const dead = (type?.attributes as LabwareTypeAttributes | undefined)?.deadVolume;
        if (!dead) notes.push(`${type?.name ?? record.name} has no dead volume; none is added`);
        const held = await run<{ wells: { well: string; state: WellState }[] }>(
          deps,
          ctx,
          'inventory.wells',
          {
            container: id,
          },
        );
        containers.set(id, {
          record,
          ...(dead ? { dead } : {}),
          wells: new Map(held.wells.map((w) => [w.well, w.state])),
        });
      }
      const key = (c: string, w: string) => `${c}|${w}`;
      const needs = await calculating(() =>
        sourceVolumes(
          input.draws.map((d) => ({ source: key(d.container, d.well), volume: d.volume })),
          {
            deadVolume: (s) => containers.get(s.split('|')[0] as string)?.dead,
            ...(input.overage ? { overage: input.overage } : {}),
          },
        ),
      );
      return {
        sources: needs.map((n) => {
          const [container, well] = n.source.split('|') as [string, string];
          const c = containers.get(container) as NonNullable<ReturnType<typeof containers.get>>;
          const volume = c.wells.get(well)?.volume;
          const holds: Quantity | undefined =
            volume === undefined
              ? { value: '0', unit: 'uL' }
              : volume === 'unknown'
                ? undefined
                : volume;
          if (volume === 'unknown')
            notes.push(`${c.record.name} ${well}: how much it holds is not known`);
          const short =
            holds && compare(holds, n.needed) < 0 ? subtract(n.needed, holds) : undefined;
          const { source: _s, ...rest } = n;
          return {
            container,
            name: c.record.name,
            well,
            ...rest,
            ...(holds ? { holds } : {}),
            ...(short ? { short } : {}),
          };
        }),
        notes,
      };
    },
  }),
  implement(transfersOptions, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const instruments = await service(deps).list(ctx, { kind: 'instrument', limit: 500 });
      const devices: (DeviceOption & {
        instrument: RecordEnvelope;
        node: string;
        capability: string;
        liquidClass?: { label?: string; verified: boolean; why: string };
      })[] = [];
      const unknown: z.infer<typeof transfersOptions.output>['unknown'] = [];
      const notes: string[] = [];
      for (const instrument of instruments.filter((i) => i.status !== 'archived')) {
        const a = instrument.attributes as InstrumentAttributes;
        const resolved = await run<ResolvedConfiguration>(deps, ctx, 'instruments.resolve', {
          instrument: instrument.id,
        }).catch(() => undefined);
        if (!resolved) continue;
        if (a.status !== 'ready' && a.status !== 'in_use')
          notes.push(`${instrument.name} ${instrument.label} is ${a.status.replaceAll('_', ' ')}`);
        const who = { id: instrument.id, name: instrument.name, label: instrument.label };
        for (const c of resolved.capabilities.filter((c) => MOVES.includes(c.capability))) {
          const limits = limitsOf(c);
          const label = nodeLabel(instrument, c.node);
          if (input.wells && c.limits?.wellCounts && !c.limits.wellCounts.includes(input.wells)) {
            notes.push(`${label} doesn't handle ${input.wells}-well plates`);
            continue;
          }
          if (!hasVolume(limits)) {
            unknown.push({
              instrument: who,
              device: label,
              capability: c.capability,
              why: 'Its volume limits are not recorded',
            });
            continue;
          }
          let liquidClass: { label?: string; verified: boolean; why: string } | undefined;
          if (input.liquid) {
            const device = a.configuration.equipment.find((e) => e.id === c.node)?.kind;
            const choice = await run<ClassChoice>(deps, ctx, 'liquids.resolve_class', {
              liquid: { liquidType: input.liquid },
              instrumentKind: a.kind,
              ...(device ? { device } : {}),
              volume: input.volume,
            }).catch(() => undefined);
            if (choice)
              liquidClass = {
                ...(choice.label ? { label: choice.label } : {}),
                verified: choice.verified,
                why: choice.issue ?? choice.why,
              };
          }
          devices.push({
            id: `${instrument.id}|${c.node}|${c.capability}`,
            label,
            limits,
            verifiedClass: !!liquidClass?.verified,
            tips: tipsOf(c),
            instrument,
            node: c.node,
            capability: c.capability,
            ...(liquidClass ? { liquidClass } : {}),
          });
        }
      }
      const ranked = await calculating(() => rankDevices(input.volume, devices));
      return {
        options: ranked.map((r) => {
          const d = devices.find((x) => x.id === r.id) as (typeof devices)[number];
          return {
            rank: r.rank,
            instrument: { id: d.instrument.id, name: d.instrument.name, label: d.instrument.label },
            node: d.node,
            device: d.label,
            capability: d.capability,
            fit: r.fit,
            tips: r.tips,
            ...(d.liquidClass ? { liquidClass: d.liquidClass } : {}),
          };
        }),
        unknown,
        notes: [...new Set(notes)],
      };
    },
  }),
];

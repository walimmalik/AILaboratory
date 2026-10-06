import {
  backfill,
  convert,
  formatQuantity,
  LabDecimal,
  type OptimizeResult,
  optimizeDilution,
} from '@ailab/domain';
import {
  type LabwareTypeAttributes,
  type LiquidVolume,
  type PlannedTransfer,
  type PlanPlate,
  type PlateMapAttributes,
  type PlatePlan,
  type Quantity,
  type TransferGroup,
  type TransferPlanAttributes,
  transfersDraftFromPlateMap,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { saveCalculation } from '../records/calculations.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { calculating, deviceOf, deviceOut, run } from './calculators.ts';

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

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

/** A volume the domain worked out, as a transfer's volume (always a volume unit). */
const vol = (q: Quantity) => q as LiquidVolume;

const key = (c: string, q: Quantity) => `${c}|${q.value}|${q.unit}`;

/**
 * A transfer plan from a plate map (plan 016a-4, T1, O1): every well's compound straight from its
 * source well or from intermediate wells the optimizer plans, then solvent to the same volume in
 * every well. Code works out every volume; the agent picks the instrument and says why.
 */
export const draftFromPlateMap = implement(transfersDraftFromPlateMap, {
  agentPolicy: 'direct',
  run: async (ctx, input, deps) => {
    const map = await recordOf(deps, ctx, input.map, 'plate_map', 'a plate map');
    const a = map.attributes as PlateMapAttributes;
    if (!a.labware)
      throw new OperationError(
        'invalid_input',
        `${map.name} has no plate type; set one on the plate map first`,
      );
    const { plates } = await run<{ plates: PlatePlan[] }>(deps, ctx, 'platemaps.wells', {
      id: map.id,
      version: map.version,
    });
    const device = await deviceOf(deps, ctx, input.instrument);
    const notes: string[] = [];

    const sourcePlates = new Set(input.sourcePlates.map((p) => p.id));
    for (const end of [...input.sources, input.solvent])
      if (!sourcePlates.has(end.plate))
        throw new OperationError('invalid_input', `No source plate called ${end.plate}`);
    const sources = new Map(input.sources.map((s) => [s.subject, s]));

    // Each subject's points and how many wells take each point, in the map's order.
    const wells = plates.flatMap((p) =>
      p.wells.filter((w) => w.role !== 'empty').map((w) => ({ ...w, plate: p.plate })),
    );
    // Solvent-only wells need no dose, even when their solvent is named. Every other occupied well must
    // say both; otherwise a missing control silently becomes solvent in the backfill below.
    const solventOnly = new Set(['neutral_control', 'blank', 'buffer']);
    const incomplete = wells.filter(
      (w) => (!w.subject || !w.concentration) && (!!w.concentration || !solventOnly.has(w.role)),
    );
    if (incomplete.length)
      throw new OperationError(
        'invalid_input',
        `Set the material and target concentration for ${incomplete
          .map((w) => `plate ${w.plate} ${w.well} (${w.label ?? w.role})`)
          .join(
            ', ',
          )} before planning compound transfers. For transfers without concentration targets, use transfers.draft`,
      );
    const missing = new Set<string>();
    const compounds = new Map<string, { points: Quantity[]; count: Map<string, number> }>();
    for (const w of wells) {
      if (!w.subject || !w.concentration) continue;
      if (!sources.has(w.subject)) {
        missing.add(w.label ?? w.subject);
        continue;
      }
      const c = compounds.get(w.subject) ?? {
        points: [] as Quantity[],
        count: new Map<string, number>(),
      };
      const k = key(w.subject, w.concentration);
      if (!c.count.has(k)) c.points.push(w.concentration);
      c.count.set(k, (c.count.get(k) ?? 0) + 1);
      compounds.set(w.subject, c);
    }
    if (missing.size)
      throw new OperationError(
        'invalid_input',
        `Say where the stock is for ${[...missing].join(', ')}`,
      );
    if (compounds.size === 0)
      throw new OperationError(
        'invalid_input',
        `${map.name} has no wells with a subject at a concentration; draft its transfers with transfers.draft`,
      );
    for (const [subject, c] of compounds) {
      const counts = new Set(c.count.values());
      if (counts.size > 1)
        notes.push(
          `${subject}: points have different numbers of wells; intermediates are sized for the most`,
        );
    }

    let intermediate:
      | {
          record: Awaited<ReturnType<typeof recordOf>>;
          wells: number;
          dead: Quantity;
          max: Quantity;
        }
      | undefined;
    if (input.intermediatePlate) {
      const record = await recordOf(
        deps,
        ctx,
        input.intermediatePlate,
        'labware_type',
        'a labware type',
      );
      const t = record.attributes as LabwareTypeAttributes;
      const max = t.workingVolume?.max ?? t.maxVolume;
      if (t.wells?.layout !== 'grid' || !t.deadVolume || !max)
        throw new OperationError(
          'invalid_input',
          `${record.name} needs a well grid, a dead volume and a working or maximum volume`,
        );
      intermediate = { record, wells: t.wells.rows * t.wells.columns, dead: t.deadVolume, max };
    }

    const optimized: OptimizeResult = await calculating(() =>
      optimizeDilution({
        compounds: [...compounds].map(([id, c]) => ({
          id,
          stock: sources.get(id)?.stock as Quantity,
          points: c.points,
          wellsPerPoint: Math.max(...c.count.values()),
        })),
        finalVolume: input.finalVolume,
        device: device.limits,
        maxSolventPercent: input.maxSolventPercent,
        tolerance: input.tolerance ?? '0.05',
        intermediatePlate: intermediate
          ? {
              wells: intermediate.wells,
              deadVolume: intermediate.dead,
              maxVolume: intermediate.max,
            }
          : {
              wells: 384,
              deadVolume: { value: '0', unit: 'uL' },
              maxVolume: { value: '1', unit: 'uL' },
            },
      }),
    );
    if (optimized.unreachable.length)
      throw new OperationError(
        'invalid_input',
        `No route reaches ${optimized.unreachable
          .map((u) => `${u.compound} ${formatQuantity(u.target)} (${u.problems[0]})`)
          .join(
            '; ',
          )}; try another tolerance, solvent limit or instrument with transfers.optimize_dilution`,
      );
    if (optimized.intermediates.length && !intermediate)
      throw new OperationError(
        'invalid_input',
        `${optimized.intermediates.length} intermediate wells are needed; give the intermediatePlate type`,
      );

    // The plan's plates.
    const pinned = (r: { id: string; version: number }) => ({ id: r.id, version: r.version });
    const planPlates: PlanPlate[] = [
      ...input.sourcePlates.map((p) => ({ ...p, role: 'source' as const })),
      ...plates.map((p) => ({
        id: `map${p.plate}`,
        label: `${map.name} plate ${p.plate}`,
        role: 'destination' as const,
        labwareType: a.labware as { id: string; version: number },
        plateMap: { map: pinned(map), plate: p.plate },
      })),
      ...Array.from({ length: optimized.plates }, (_, i) => ({
        id: `int${i + 1}`,
        label: `Intermediate plate ${i + 1}`,
        role: 'intermediate' as const,
        labwareType: pinned(intermediate?.record as { id: string; version: number }),
      })),
    ];

    // Intermediate wells, drawn from in the optimizer's order until each has given what it planned.
    const left = new Map(optimized.intermediates.map((w) => [w.id, new LabDecimal(w.drawn.value)]));
    const byPoint = new Map(optimized.points.map((p) => [key(p.compound, p.target), p]));
    const dispenses: PlannedTransfer[] = [];
    const solventIn = new Map<string, Quantity>();
    let fromSource = 0;
    let fromIntermediates = 0;
    for (const [subject, c] of compounds) {
      const src = sources.get(subject) as (typeof input.sources)[number];
      for (const target of c.points) {
        const point = byPoint.get(key(subject, target));
        if (!point) continue;
        const volume = point.dispense.volume.achieved;
        const each = new LabDecimal(convert(volume, 'uL').value);
        const into = wells.filter(
          (w) =>
            w.subject === subject &&
            w.concentration &&
            key(subject, w.concentration) === key(subject, target),
        );
        const candidates = (point.intermediate ?? '').split(', ').filter(Boolean);
        for (const w of into) {
          let from = { plate: src.plate, well: src.well };
          if (point.from === 'intermediate') {
            const id =
              candidates.find((i) => (left.get(i) ?? new LabDecimal(0)).gte(each)) ??
              (candidates[candidates.length - 1] as string);
            left.set(id, (left.get(id) ?? new LabDecimal(0)).minus(each));
            const iw = optimized.intermediates.find((x) => x.id === id);
            from = { plate: `int${iw?.plate}`, well: iw?.well as string };
            fromIntermediates += 1;
          } else fromSource += 1;
          const to = { plate: `map${w.plate}`, well: w.well };
          dispenses.push({ from, to, volume: vol(volume) });
          solventIn.set(`${to.plate}|${to.well}`, volume);
        }
      }
    }

    // Solvent to the same volume in every well that isn't empty.
    const all = wells.map((w) => `map${w.plate}|${w.well}`);
    const zero = { value: '0', unit: device.limits.step?.unit ?? 'nL' };
    const fill = await calculating(() =>
      backfill(
        all.map((k) => solventIn.get(k) ?? zero),
        device.limits,
      ),
    );
    const backfills: PlannedTransfer[] = [];
    fill.backfill.forEach((v, i) => {
      if (new LabDecimal(v.value).lte(0)) return;
      const [plate, well] = (all[i] as string).split('|') as [string, string];
      backfills.push({ from: input.solvent, to: { plate, well }, volume: vol(v) });
    });

    const instrument = input.instrument;
    const out = deviceOut(device);
    const code = 'Worked out by transfers.draft_from_plate_map';
    const groups: TransferGroup[] = [];
    if (optimized.intermediates.length) {
      groups.push(
        {
          id: 'intermediate_solvent',
          label: 'Solvent into the intermediate wells',
          method: 'intermediate_prep',
          instrument,
          device: out,
          reason: `${code}: diluent first, then stock. ${input.why}. Check the volumes fit, or set another instrument for this group`,
          transfers: optimized.intermediates.map((w) => ({
            from: input.solvent,
            to: { plate: `int${w.plate}`, well: w.well },
            volume: vol(w.diluent),
          })),
        },
        {
          id: 'intermediate_stock',
          label: 'Stock into the intermediate wells',
          method: 'intermediate_prep',
          instrument,
          device: out,
          reason: `${code}: each intermediate is its stock diluted ${[...new Set(optimized.intermediates.map((w) => `${w.factor}×`))].join(', ')}. ${input.why}`,
          transfers: optimized.intermediates.map((w) => {
            const src = sources.get(w.compound) as (typeof input.sources)[number];
            return {
              from: { plate: src.plate, well: src.well },
              to: { plate: `int${w.plate}`, well: w.well },
              volume: vol(w.stock),
            };
          }),
        },
      );
    }
    groups.push({
      id: 'compounds',
      label: `Compounds into ${plates.length === 1 ? 'the plate' : `${plates.length} plates`}`,
      method: 'direct_dispense',
      instrument,
      device: out,
      reason: `${code}: ${fromSource} wells straight from the source, ${fromIntermediates} from intermediates, each within ±${new LabDecimal(input.tolerance ?? '0.05').times(100).toString()}%. ${input.why}`,
      transfers: dispenses,
    });
    if (backfills.length)
      groups.push({
        id: 'backfill',
        label: 'Solvent to the same volume in every well',
        method: 'backfill',
        instrument,
        device: out,
        reason: `${code}: every well ends with ${formatQuantity(fill.to)} of solvent. ${input.why}`,
        transfers: backfills,
      });

    const attributes: TransferPlanAttributes = {
      ...(input.experiment
        ? { experiment: input.experiment }
        : a.experiment
          ? { experiment: a.experiment }
          : {}),
      purpose: `Makes ${map.name}`,
      plates: planPlates,
      groups,
      ...(notes.length ? { notes: notes.join('\n') } : {}),
    };
    const calculation = await saveCalculation(
      deps.db,
      ctx,
      'transfers.draft_from_plate_map',
      input,
      attributes.groups,
    );
    const plan = await service(deps).create(ctx, {
      kind: 'transfer_plan',
      label: input.label,
      attributes,
      evidence: {
        groups: { source: 'calculated', calculation, note: 'transfers.draft_from_plate_map' },
      },
      reason: input.reason ?? `Drafted from ${map.name}`,
    });
    return {
      plan,
      summary: {
        wells: dispenses.length,
        fromSource,
        fromIntermediates,
        intermediateWells: optimized.intermediates.length,
        backfilled: backfills.length,
        notes,
      },
    };
  },
});

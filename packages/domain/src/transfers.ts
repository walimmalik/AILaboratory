import type { Quantity } from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';
import { allWells, plateFormat } from './platemap.ts';
import { compare, convert, formatQuantity, getUnit } from './units.ts';

/**
 * Transfer math (plan 016, T1 and T2): whether a device can move a volume and how close it gets,
 * how much stock a target concentration takes and how much solvent that puts in the well, when an
 * intermediate dilution is needed, what each source must hold, and how many tips a method uses. Pure
 * and exact; agents call it through the transfer calculators instead of doing the arithmetic.
 */

export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferError';
  }
}

/** What a device can dispense per transfer: range and step (an Echo's 2.5 nL droplet). */
export interface DeviceLimits {
  min?: Quantity | undefined;
  max?: Quantity | undefined;
  step?: Quantity | undefined;
}

export interface VolumeFit {
  requested: Quantity;
  /** What the device actually moves: whole steps, in the requested unit. */
  achieved: Quantity;
  /** Droplets or steps, when the device has a step. */
  steps?: number;
  /** |achieved − requested| / requested, as a decimal fraction ("0.02" is 2%). */
  error: string;
  fits: boolean;
  problem?: string;
}

const dec = (q: Quantity) => new LabDecimal(q.value);
const inUnit = (q: Quantity, unit: string) => new LabDecimal(convert(q, unit).value);
/** Six significant digits, as the lab reads a number. */
const round = (d: LabDecimal) => toDecimalString(d.toSignificantDigits(6));
const fraction = (d: LabDecimal) => toDecimalString(d.toDecimalPlaces(4));
const percent = (d: LabDecimal) => toDecimalString(d.toDecimalPlaces(3));

/** Relative error of an achieved value against a requested one. */
function relativeError(achieved: LabDecimal, requested: LabDecimal): LabDecimal {
  return requested.isZero()
    ? new LabDecimal(0)
    : achieved.minus(requested).abs().dividedBy(requested);
}

/** How a device moves a volume: rounded to whole steps, checked against its range. */
export function fitVolume(volume: Quantity, limits: DeviceLimits): VolumeFit {
  if (dec(volume).lte(0)) throw new TransferError('A volume to move is more than zero');
  let achieved = dec(volume);
  let steps: number | undefined;
  if (limits.step) {
    const step = inUnit(limits.step, volume.unit);
    const n = achieved.dividedBy(step).toDecimalPlaces(0, LabDecimal.ROUND_HALF_EVEN);
    steps = n.toNumber();
    achieved = n.times(step);
  }
  const result: VolumeFit = {
    requested: volume,
    achieved: { value: toDecimalString(achieved), unit: volume.unit },
    ...(steps !== undefined ? { steps } : {}),
    error: fraction(relativeError(achieved, dec(volume))),
    fits: true,
  };
  const problem =
    steps === 0 && limits.step
      ? `${formatQuantity(volume)} is less than one step of ${formatQuantity(limits.step)}`
      : limits.min && compare(result.achieved, limits.min) < 0
        ? `${formatQuantity(volume)} is below the minimum of ${formatQuantity(limits.min)}`
        : limits.max && compare(result.achieved, limits.max) > 0
          ? `${formatQuantity(volume)} is above the maximum of ${formatQuantity(limits.max)}`
          : undefined;
  return problem ? { ...result, fits: false, problem } : result;
}

export interface DispenseInput {
  /** The stock concentration, e.g. 10 mM in DMSO. */
  stock: Quantity;
  /** The concentration wanted in the well. */
  target: Quantity;
  /** The well's final volume after everything is added. */
  finalVolume: Quantity;
  device: DeviceLimits;
  /** The most solvent the well may hold, in percent v/v, e.g. "0.5". The stock is all solvent. */
  maxSolventPercent?: string | undefined;
  /** How far the achieved concentration may be from the target, e.g. "0.05" for ±5%. */
  tolerance?: string | undefined;
  /** The unit volumes are reported in; default the device step's unit, else nL. */
  volumeUnit?: string | undefined;
}

export interface Dispense {
  volume: VolumeFit;
  /** The concentration the well gets, in the target's unit. */
  achieved: Quantity;
  error: string;
  /** Solvent from this stock in the well, in percent v/v. */
  solventPercent: string;
  ok: boolean;
  problems: string[];
}

/**
 * Stock straight into the well: volume = target ÷ stock × final volume, rounded to what the device
 * can move, with the concentration that gives and the solvent it brings.
 */
export function directDispense(input: DispenseInput): Dispense {
  const { stock, target, finalVolume, device } = input;
  if (getUnit(stock.unit).dimension !== getUnit(target.unit).dimension)
    throw new TransferError(
      `The stock (${formatQuantity(stock)}) and the target (${formatQuantity(target)}) are different kinds of concentration`,
    );
  if (dec(stock).lte(0)) throw new TransferError('The stock concentration is more than zero');
  if (dec(target).lte(0)) throw new TransferError('A target concentration is more than zero');
  const unit = input.volumeUnit ?? device.step?.unit ?? 'nL';
  const ratio = inUnit(target, stock.unit).dividedBy(dec(stock));
  const final = inUnit(finalVolume, unit);
  const problems: string[] = [];
  if (ratio.gt(1))
    problems.push(`${formatQuantity(target)} is more than the stock (${formatQuantity(stock)})`);
  const ideal: Quantity = { value: round(final.times(ratio)), unit };
  const volume = fitVolume(ideal, device);
  if (volume.problem) problems.push(volume.problem);
  const moved = dec(volume.achieved);
  const achievedValue = moved.dividedBy(final).times(dec(stock));
  const achieved = convert({ value: round(achievedValue), unit: stock.unit }, target.unit);
  const error = relativeError(inUnit(achieved, stock.unit), inUnit(target, stock.unit));
  const solvent = moved.dividedBy(final).times(100);
  if (input.tolerance && volume.fits && error.gt(input.tolerance))
    problems.push(
      `${formatQuantity(achieved)} is ${percent(error.times(100))}% off ${formatQuantity(target)}, more than ±${percent(new LabDecimal(input.tolerance).times(100))}%`,
    );
  if (input.maxSolventPercent && solvent.gt(input.maxSolventPercent))
    problems.push(
      `It brings ${percent(solvent)}% solvent into the well, more than ${input.maxSolventPercent}%`,
    );
  return {
    volume,
    achieved: { value: round(new LabDecimal(achieved.value)), unit: target.unit },
    error: fraction(error),
    solventPercent: percent(solvent),
    ok: problems.length === 0,
    problems,
  };
}

/**
 * Backfill (plan 016): solvent added to each well so every well ends with the same solvent volume
 * as the fullest one, rounded to the device's step.
 */
export function backfill(
  volumes: readonly Quantity[],
  device: DeviceLimits = {},
): { to: Quantity; backfill: Quantity[] } {
  if (volumes.length === 0) throw new TransferError('Nothing to backfill');
  const unit = device.step?.unit ?? (volumes[0] as Quantity).unit;
  const values = volumes.map((v) => inUnit(v, unit));
  const top = LabDecimal.max(...values);
  const step = device.step ? inUnit(device.step, unit) : undefined;
  return {
    to: { value: toDecimalString(top), unit },
    backfill: values.map((v) => {
      let gap = top.minus(v);
      if (step)
        gap = gap.dividedBy(step).toDecimalPlaces(0, LabDecimal.ROUND_HALF_EVEN).times(step);
      return { value: toDecimalString(gap), unit };
    }),
  };
}

export interface DilutionInput extends Omit<DispenseInput, 'target'> {
  targets: readonly Quantity[];
  /** Fold dilutions to try for an intermediate, smallest first. Default 10, 100, 1000. */
  factors?: readonly string[];
}

export interface DilutionPoint {
  target: Quantity;
  direct: Dispense;
  /** The first intermediate that reaches the target, when straight from stock doesn't. */
  intermediate?: { factor: string; concentration: Quantity; dispense: Dispense };
  reachable: boolean;
}

/**
 * Can each target be reached from the stock (T2 `transfers.dilution_options`): straight from the
 * stock when the device can move the volume within tolerance, else through an intermediate diluted
 * 10, 100 or 1000 fold in the same solvent. The solvent limit holds either way.
 */
export function dilutionOptions(input: DilutionInput): DilutionPoint[] {
  const factors = input.factors ?? ['10', '100', '1000'];
  for (const f of factors)
    if (new LabDecimal(f).lte(1)) throw new TransferError('A dilution factor is more than 1');
  return input.targets.map((target) => {
    const direct = directDispense({ ...input, target });
    if (direct.ok) return { target, direct, reachable: true };
    for (const factor of factors) {
      const concentration: Quantity = {
        value: round(dec(input.stock).dividedBy(factor)),
        unit: input.stock.unit,
      };
      if (compare(concentration, convert(target, concentration.unit)) < 0) break;
      const dispense = directDispense({ ...input, stock: concentration, target });
      if (dispense.ok)
        return {
          target,
          direct,
          intermediate: { factor, concentration, dispense },
          reachable: true,
        };
    }
    return { target, direct, reachable: false };
  });
}

export interface Draw {
  source: string;
  volume: Quantity;
}

export interface SourceNeed {
  source: string;
  /** What the transfers take out. */
  drawn: Quantity;
  /** What must stay behind for the device to reach it. */
  dead: Quantity;
  /** Extra on top, as the plan asks. */
  overage: Quantity;
  needed: Quantity;
  draws: number;
}

/**
 * What each source must hold (T2 `transfers.source_volumes`): the sum drawn, plus the dead volume
 * of its container on this device, plus an overage fraction of what is drawn.
 */
export function sourceVolumes(
  draws: readonly Draw[],
  options: {
    deadVolume?: (source: string) => Quantity | undefined;
    overage?: string;
    unit?: string;
  } = {},
): SourceNeed[] {
  const unit = options.unit ?? 'uL';
  const overage = new LabDecimal(options.overage ?? '0');
  if (overage.lt(0)) throw new TransferError('Overage is zero or more');
  const bySource = new Map<string, { total: LabDecimal; n: number }>();
  for (const d of draws) {
    const entry = bySource.get(d.source) ?? { total: new LabDecimal(0), n: 0 };
    entry.total = entry.total.plus(inUnit(d.volume, unit));
    entry.n += 1;
    bySource.set(d.source, entry);
  }
  return [...bySource].map(([source, { total, n }]) => {
    const deadQ = options.deadVolume?.(source);
    const dead = deadQ ? inUnit(deadQ, unit) : new LabDecimal(0);
    const extra = total.times(overage);
    const q = (d: LabDecimal): Quantity => ({ value: round(d), unit });
    return {
      source,
      drawn: q(total),
      dead: q(dead),
      overage: q(extra),
      needed: q(total.plus(dead).plus(extra)),
      draws: n,
    };
  });
}

/**
 * How a method handles tips (T5). `none`: acoustic or non-contact (Echo, Mantis). `new_each`: a new
 * tip for every transfer. `per_source`: one tip per source, reused. `lab_default`: a new tip for
 * every transfer into a well that already holds liquid, one tip per source otherwise.
 */
export type TipRule = 'none' | 'new_each' | 'per_source' | 'lab_default';

export function countTips(
  transfers: readonly { source: string; intoLiquid?: boolean }[],
  rule: TipRule,
): number {
  switch (rule) {
    case 'none':
      return 0;
    case 'new_each':
      return transfers.length;
    case 'per_source':
      return new Set(transfers.map((t) => t.source)).size;
    case 'lab_default': {
      const dry = new Set(transfers.filter((t) => !t.intoLiquid).map((t) => t.source)).size;
      return dry + transfers.filter((t) => t.intoLiquid).length;
    }
  }
}

export interface DeviceOption {
  id: string;
  label: string;
  limits: DeviceLimits;
  /** Whether a liquid class for this liquid on this device is verified (009). */
  verifiedClass?: boolean;
  tips: TipRule;
}

export interface RankedOption extends DeviceOption {
  fit: VolumeFit;
  rank: number;
}

/**
 * Devices that could move a volume, best first (T2 `transfers.options`): ones that fit before ones
 * that don't, then a verified liquid class, then the smaller error, then no tips.
 */
export function rankDevices(volume: Quantity, devices: readonly DeviceOption[]): RankedOption[] {
  const scored = devices.map((d) => ({ ...d, fit: fitVolume(volume, d.limits) }));
  scored.sort(
    (a, b) =>
      Number(b.fit.fits) - Number(a.fit.fits) ||
      Number(!!b.verifiedClass) - Number(!!a.verifiedClass) ||
      new LabDecimal(a.fit.error).comparedTo(b.fit.error) ||
      Number(a.tips !== 'none') - Number(b.tips !== 'none') ||
      a.label.localeCompare(b.label),
  );
  return scored.map((d, i) => ({ ...d, rank: i + 1 }));
}

export interface OptimizeInput {
  /** Every compound on the destination plates: its stock and its curve points. */
  compounds: readonly {
    id: string;
    stock: Quantity;
    points: readonly Quantity[];
    /** Destination wells per point (replicates × plates); default 1. */
    wellsPerPoint?: number;
  }[];
  finalVolume: Quantity;
  /** The dispensing device (the Echo): range and droplet. */
  device: DeviceLimits;
  maxSolventPercent: string;
  /** e.g. "0.05" for ±5% (016 O2 default). */
  tolerance: string;
  /** The intermediate plate type. */
  intermediatePlate: { wells: number; deadVolume: Quantity; maxVolume: Quantity };
  /** Fold dilutions an intermediate may be; default 10, 100, 1000. */
  factors?: readonly string[];
}

export interface OptimizedPoint {
  compound: string;
  point: number;
  target: Quantity;
  /** Straight from the source plate, or from an intermediate well. */
  from: 'source' | 'intermediate';
  /** The intermediate wells it draws from, e.g. "I1" or "I1, I2" when one well runs out. */
  intermediate?: string;
  dispense: Dispense;
}

export interface IntermediateWell {
  id: string;
  compound: string;
  factor: string;
  concentration: Quantity;
  plate: number;
  well: string;
  /** What the preparation step puts in: stock, then solvent up to the volume. */
  stock: Quantity;
  diluent: Quantity;
  volume: Quantity;
  /** What the dispenses take out of it, and what must stay behind. */
  drawn: Quantity;
  dead: Quantity;
}

export interface OptimizeResult {
  points: OptimizedPoint[];
  intermediates: IntermediateWell[];
  plates: number;
  /** Points no route reaches within the limits, with why. */
  unreachable: { compound: string; point: number; target: Quantity; problems: string[] }[];
}

/**
 * The dilution optimizer (016 O1): for every compound and point, straight from the source plate
 * when that is within the tolerance, else from an intermediate well of the same compound diluted in
 * solvent. The solvent limit and the intermediate plate's dead and maximum volume are hard limits.
 * Within them it keeps every point in tolerance first, then uses the fewest intermediate wells
 * (reusing one dilution for as many points as it can), then the smallest error, and packs the
 * wells onto the fewest plates in row order.
 */
export function optimizeDilution(input: OptimizeInput): OptimizeResult {
  const factors = [...(input.factors ?? ['10', '100', '1000'])];
  for (const f of factors)
    if (new LabDecimal(f).lte(1)) throw new TransferError('A dilution factor is more than 1');
  const plate = input.intermediatePlate;
  const unit = 'uL';
  const points: OptimizedPoint[] = [];
  const unreachable: OptimizeResult['unreachable'] = [];
  const wells: Omit<IntermediateWell, 'id' | 'plate' | 'well'>[] = [];
  const dead = inUnit(plate.deadVolume, unit);
  const max = inUnit(plate.maxVolume, unit);
  const step = input.device.step ? inUnit(input.device.step, unit) : undefined;
  if (dead.gte(max))
    throw new TransferError('The intermediate plate keeps back more than a well holds');

  for (const c of input.compounds) {
    const perPoint = c.wellsPerPoint ?? 1;
    const base = { ...input, stock: c.stock };
    // Each point's routes that work, with the factor they need ('1' is the source itself).
    const routes = c.points.map((target, i) => {
      const direct = directDispense({ ...base, target });
      const options: { factor: string; dispense: Dispense }[] = direct.ok
        ? [{ factor: '1', dispense: direct }]
        : [];
      if (!direct.ok)
        for (const factor of factors) {
          const concentration: Quantity = {
            value: round(dec(c.stock).dividedBy(factor)),
            unit: c.stock.unit,
          };
          if (compare(concentration, convert(target, concentration.unit)) < 0) continue;
          const dispense = directDispense({ ...base, stock: concentration, target });
          if (dispense.ok) options.push({ factor, dispense });
        }
      return { i, target, direct, options };
    });
    for (const r of routes.filter((r) => r.options.length === 0))
      unreachable.push({
        compound: c.id,
        point: r.i + 1,
        target: r.target,
        problems: [
          ...r.direct.problems,
          `No intermediate of ${factors.join(', ')} fold reaches it within the limits`,
        ],
      });
    // The fewest dilutions that cover every reachable point needing one, then the smallest error.
    const needing = routes.filter((r) => r.options.length && r.options[0]?.factor !== '1');
    const covers = subsets(factors).filter((set) =>
      needing.every((r) => r.options.some((o) => set.includes(o.factor))),
    );
    const errorOf = (set: string[]) =>
      needing.reduce((sum, r) => {
        const best = r.options
          .filter((o) => set.includes(o.factor))
          .reduce((a, b) => (new LabDecimal(a.dispense.error).lte(b.dispense.error) ? a : b));
        return sum.plus(best.dispense.error);
      }, new LabDecimal(0));
    const chosen =
      covers.sort((a, b) => a.length - b.length || errorOf(a).comparedTo(errorOf(b)))[0] ?? [];
    // Each point's dispenses, in order, filled into wells of its dilution until a well is full,
    // leaving space to round its stock up to whole steps of the device.
    const roomFor = (factor: string) => max.minus(dead).minus(step ? step.times(factor) : 0);
    const open = new Map<string, number>();
    for (const r of routes) {
      if (!r.options.length) continue;
      const first = r.options[0] as { factor: string; dispense: Dispense };
      if (first.factor === '1') {
        points.push({
          compound: c.id,
          point: r.i + 1,
          target: r.target,
          from: 'source',
          dispense: first.dispense,
        });
        continue;
      }
      const pick = r.options
        .filter((o) => chosen.includes(o.factor))
        .reduce((a, b) => (new LabDecimal(a.dispense.error).lte(b.dispense.error) ? a : b));
      const each = inUnit(pick.dispense.volume.achieved, unit);
      const room = roomFor(pick.factor);
      if (each.gt(room))
        throw new TransferError(
          `One dispense of ${formatQuantity(pick.dispense.volume.achieved)} is more than an intermediate well can give`,
        );
      const used: number[] = [];
      for (let n = 0; n < perPoint; n++) {
        let index = open.get(pick.factor);
        const current = index === undefined ? undefined : wells[index];
        if (current === undefined || new LabDecimal(current.drawn.value).plus(each).gt(room)) {
          const concentration: Quantity = {
            value: round(dec(c.stock).dividedBy(pick.factor)),
            unit: c.stock.unit,
          };
          wells.push({
            compound: c.id,
            factor: pick.factor,
            concentration,
            stock: { value: '0', unit },
            diluent: { value: '0', unit },
            volume: { value: '0', unit },
            drawn: { value: '0', unit },
            dead: { value: round(dead), unit },
          });
          index = wells.length - 1;
          open.set(pick.factor, index);
        }
        const w = wells[index as number] as (typeof wells)[number];
        w.drawn = { value: toDecimalString(new LabDecimal(w.drawn.value).plus(each)), unit };
        if (!used.includes(index as number)) used.push(index as number);
      }
      points.push({
        compound: c.id,
        point: r.i + 1,
        target: r.target,
        from: 'intermediate',
        intermediate: used.map((u) => `#${u}`).join(','),
        dispense: pick.dispense,
      });
    }
  }
  // What each intermediate well is made of: stock, then solvent up to at least what is drawn plus
  // dead. The device moves the stock, so it is whole steps, and the well grows to keep the factor.
  for (const w of wells) {
    let stock = new LabDecimal(w.drawn.value).plus(dead).dividedBy(w.factor);
    if (step) stock = stock.dividedBy(step).toDecimalPlaces(0, LabDecimal.ROUND_CEIL).times(step);
    const volume = stock.times(w.factor);
    w.volume = { value: round(volume), unit };
    w.stock = { value: round(stock), unit };
    w.diluent = { value: round(volume.minus(stock)), unit };
    w.drawn = { value: round(new LabDecimal(w.drawn.value)), unit };
  }

  // Pack onto plates in row order; ids as the lab reads them.
  const names = allWells(plateFormat(plate.wells));
  const intermediates = wells.map((w, i) => ({
    id: `I${i + 1}`,
    plate: Math.floor(i / names.length) + 1,
    well: names[i % names.length] as string,
    ...w,
  }));
  for (const p of points)
    if (p.intermediate)
      p.intermediate = p.intermediate
        .split(',')
        .map((k) => `I${Number(k.slice(1)) + 1}`)
        .join(', ');
  return {
    points,
    intermediates,
    plates: Math.ceil(intermediates.length / names.length),
    unreachable,
  };
}

/** Every subset of a list, smallest first. */
function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[]];
  for (const item of items) for (const s of [...out]) out.push([...s, item]);
  return out.sort((a, b) => a.length - b.length);
}

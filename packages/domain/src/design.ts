import type { DesignKind, Quantity } from '@ailab/schema';
import { seriesConcentrations } from './platemap.ts';
import { formatQuantity } from './units.ts';

/**
 * Experiment design (plan 017, D5, D6): factors with levels combined into conditions (full
 * factorial or one factor at a time), and the totals that follow from replicate and control rules
 * (wells, plates, runs), worked out before anything is confirmed. No I/O.
 */

export class DesignError extends Error {}

/** A level as the designer resolved it: listed, from the subjects named, or a series point. */
export interface Level {
  id: string;
  label: string;
  value?: Quantity | string;
}

export interface ResolvedFactor {
  id: string;
  label: string;
  levels: Level[];
  /** The level kept while others vary (one factor at a time); default the first. */
  baseline?: string;
}

/** One condition: a level of every factor. */
export interface Condition {
  /** The level ids in factor order, joined, e.g. "cpd_1.p3". */
  id: string;
  levels: Record<string, string>;
  /** In lab words, e.g. "Compound: STS · Concentration: 1.11 µM". */
  label: string;
}

/** Above this the design is a screen for a different tool, not a plate experiment. */
export const MAX_CONDITIONS = 20000;

/** A series as levels, top first: p1 = the top concentration. */
export function seriesLevels(series: { top: Quantity; factor: string; points: number }): Level[] {
  return seriesConcentrations(series).map((value, i) => ({
    id: `p${i + 1}`,
    label: formatQuantity(value),
    value,
  }));
}

function condition(factors: readonly ResolvedFactor[], picks: readonly Level[]): Condition {
  return {
    id: picks.map((l) => l.id).join('.'),
    levels: Object.fromEntries(factors.map((f, i) => [f.id, (picks[i] as Level).id])),
    label: factors.map((f, i) => `${f.label}: ${(picks[i] as Level).label}`).join(' · '),
  };
}

function checkFactors(factors: readonly ResolvedFactor[]) {
  const ids = new Set<string>();
  for (const f of factors) {
    if (ids.has(f.id)) throw new DesignError(`Two factors are called ${f.id}`);
    ids.add(f.id);
    if (!f.levels.length) throw new DesignError(`${f.label} has no levels`);
    const levels = new Set(f.levels.map((l) => l.id));
    if (levels.size !== f.levels.length)
      throw new DesignError(`${f.label} has two levels with the same id`);
    if (f.baseline !== undefined && !levels.has(f.baseline))
      throw new DesignError(`${f.label} has no level ${f.baseline} to keep as its baseline`);
  }
}

/**
 * The conditions of a design (D5). Full factorial: every combination of levels, the first factor
 * varying slowest. One factor at a time: every factor at its baseline, then each factor's other
 * levels in turn with the rest at baseline. No factors: one condition.
 */
export function designConditions(
  factors: readonly ResolvedFactor[],
  kind: DesignKind = 'full_factorial',
): Condition[] {
  checkFactors(factors);
  if (!factors.length) return [{ id: 'all', levels: {}, label: 'One condition' }];
  if (kind === 'one_factor_at_a_time') {
    const base = factors.map(
      (f) => f.levels.find((l) => l.id === f.baseline) ?? (f.levels[0] as Level),
    );
    const out = [condition(factors, base)];
    factors.forEach((f, i) => {
      for (const level of f.levels) {
        if (level.id === (base[i] as Level).id) continue;
        const picks = [...base];
        picks[i] = level;
        out.push(condition(factors, picks));
      }
    });
    return out;
  }
  const count = factors.reduce((n, f) => n * f.levels.length, 1);
  if (count > MAX_CONDITIONS)
    throw new DesignError(
      `A full factorial of these factors has ${count} conditions; at most ${MAX_CONDITIONS}. Vary one factor at a time, or fewer levels`,
    );
  let combos: Level[][] = [[]];
  for (const f of factors) combos = combos.flatMap((c) => f.levels.map((l) => [...c, l]));
  return combos.map((picks) => condition(factors, picks));
}

export interface ControlNeed {
  label: string;
  wells: number;
  per: 'plate' | 'run';
}

export interface TotalsRequest {
  conditions: number;
  /** Wells per condition in a run. */
  technical: number;
  /** Runs (biological repeats); default 1. */
  biological?: number;
  controls?: readonly ControlNeed[];
  /** Wells on one plate the design may use (the format less any kept empty). */
  wellsPerPlate: number;
}

export interface DesignTotals {
  conditions: number;
  runs: number;
  /** Per run. */
  subjectWells: number;
  controlWells: number;
  plates: number;
  /** Over every run. */
  totalPlates: number;
  totalWells: number;
  /** Wells left empty on the last plate of a run. */
  spare: number;
  lines: string[];
}

/**
 * Wells, plates and runs (D6): each condition in `technical` wells, controls on every plate or once
 * per run, as few plates as fit, repeated for every biological replicate.
 */
export function designTotals(request: TotalsRequest): DesignTotals {
  const { conditions, technical, wellsPerPlate } = request;
  const runs = request.biological ?? 1;
  for (const [name, n] of [
    ['conditions', conditions],
    ['technical replicates', technical],
    ['runs', runs],
    ['wells per plate', wellsPerPlate],
  ] as const)
    if (!Number.isInteger(n) || n < 1)
      throw new DesignError(`${name} must be a whole number of 1 or more`);
  const controls = request.controls ?? [];
  const perPlate = controls.filter((c) => c.per === 'plate').reduce((n, c) => n + c.wells, 0);
  const perRun = controls.filter((c) => c.per === 'run').reduce((n, c) => n + c.wells, 0);
  const free = wellsPerPlate - perPlate;
  if (free < 1)
    throw new DesignError(
      `The controls on every plate take ${perPlate} wells; a plate has ${wellsPerPlate}`,
    );
  const subjectWells = conditions * technical;
  const plates = Math.max(1, Math.ceil((subjectWells + perRun) / free));
  const controlWells = perPlate * plates + perRun;
  const spare = plates * wellsPerPlate - subjectWells - controlWells;
  const lines = [
    `${conditions} condition${conditions === 1 ? '' : 's'} × ${technical} well${technical === 1 ? '' : 's'} = ${subjectWells} wells`,
    ...controls.map((c) => `${c.label}: ${c.wells} well${c.wells === 1 ? '' : 's'} per ${c.per}`),
    `${plates} plate${plates === 1 ? '' : 's'} of ${wellsPerPlate} wells per run, ${spare} spare`,
    ...(runs > 1 ? [`${runs} runs: ${plates * runs} plates in all`] : []),
  ];
  return {
    conditions,
    runs,
    subjectWells,
    controlWells,
    plates,
    totalPlates: plates * runs,
    totalWells: (subjectWells + controlWells) * runs,
    spare,
    lines,
  };
}

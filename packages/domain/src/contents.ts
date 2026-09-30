import type { Component, Quantity, WellState } from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';
import { add, compare, convert, getUnit, subtract } from './units.ts';

/**
 * Mixing math for well contents (plan 010c, V3). Every concentration per volume mixes linearly:
 * a component's amount is its concentration times the volume, amounts add, and the new
 * concentration is the total amount over the new volume. All exact decimals.
 */

export class ContentsError extends Error {
  constructor(
    readonly code: 'not_enough' | 'no_liquid' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'ContentsError';
  }
}

/** Per concentration dimension: its base unit, the amount it becomes, and base-unit amount per litre. */
const MIXABLE: Record<string, { base: string; amount: string; perLitre: string }> = {
  molar_concentration: { base: 'M', amount: 'mol', perLitre: '1' },
  mass_concentration: { base: 'g/L', amount: 'g', perLitre: '1' },
  activity_concentration: { base: 'U/mL', amount: 'U', perLitre: '1000' },
  cell_density: { base: 'cells/mL', amount: 'cells', perLitre: '1000' },
  colony_density: { base: 'CFU/mL', amount: 'CFU', perLitre: '1000' },
  volume_percent: { base: '%v/v', amount: 'L', perLitre: '0.01' },
  mass_volume_percent: { base: '%w/v', amount: 'g', perLitre: '10' },
};

/** The concentration an amount becomes once liquid is added to a dry well. */
const DISSOLVED: Record<string, string> = {
  amount: 'uM',
  mass: 'ug/mL',
  enzyme_activity: 'U/mL',
  cell_count: 'cells/mL',
  colony_count: 'CFU/mL',
};

const ZERO_VOLUME: Quantity = { value: '0', unit: 'uL' };

/** What an empty well holds. */
export const EMPTY_WELL_STATE: WellState = { volume: { value: '0', unit: 'uL' }, components: [] };

/** A portion of liquid on its way from one well to another: its volume and what it carries. */
export interface Portion {
  volume: Quantity;
  components: Component[];
  assumed?: boolean;
}

function litres(volume: Quantity): LabDecimal {
  return new LabDecimal(convert(volume, 'L').value);
}

function isZero(q: Quantity): boolean {
  return new LabDecimal(q.value).isZero();
}

/** Concentration times volume, e.g. 10 mM × 5 µL = 0.00000005 mol; undefined when it doesn't mix. */
export function amountIn(concentration: Quantity, volume: Quantity): Quantity | undefined {
  const rule = MIXABLE[getUnit(concentration.unit).dimension];
  if (!rule) return undefined;
  const base = new LabDecimal(convert(concentration, rule.base).value);
  const amount = base.times(litres(volume)).times(rule.perLitre);
  return { value: toDecimalString(amount), unit: rule.amount };
}

/** Amount over volume, in the unit asked for (which fixes the concentration dimension). */
export function concentrationOf(amount: Quantity, volume: Quantity, unit: string): Quantity {
  const rule = MIXABLE[getUnit(unit).dimension];
  if (!rule) throw new ContentsError('invalid', `${unit} is not a concentration that mixes`);
  const total = new LabDecimal(convert(amount, rule.amount).value);
  const base = total.dividedBy(litres(volume).times(rule.perLitre));
  return convert({ value: toDecimalString(base), unit: rule.base }, unit);
}

/** Takes a volume out of a well: what is left and the portion taken. */
export function take(well: WellState, volume: Quantity): { left: WellState; portion: Portion } {
  if (new LabDecimal(volume.value).lessThanOrEqualTo(0)) {
    throw new ContentsError('invalid', 'The volume to take must be more than zero');
  }
  const portion: Portion = {
    volume,
    components: well.components.map(({ amount: _amount, ...c }) => c),
    ...(well.assumed ? { assumed: true } : {}),
  };
  if (well.volume === 'unknown') return { left: well, portion };
  if (isZero(well.volume)) {
    throw new ContentsError('no_liquid', 'The well has no liquid to take');
  }
  if (compare(volume, well.volume) > 0) {
    throw new ContentsError(
      'not_enough',
      `Only ${well.volume.value} ${well.volume.unit} is there, not ${volume.value} ${volume.unit}`,
    );
  }
  const rest = subtract(well.volume, volume);
  const left: WellState = isZero(rest)
    ? { volume: rest as WellState['volume'], components: [] }
    : { ...well, volume: rest as WellState['volume'] };
  return { left, portion };
}

interface Tally {
  source: string;
  /** Unit to report the concentration in. */
  unit?: string;
  /** Summed amount; undefined once any part of it is unknown. */
  amount?: Quantity | undefined;
  /** Kept as is: a concentration that doesn't mix, in a well where nothing else was added. */
  kept?: Quantity | undefined;
  unknown: boolean;
}

function keyOf(source: string, unit: string | undefined): string {
  if (!unit) return `${source}|?`;
  const dimension = getUnit(unit).dimension;
  const rule = MIXABLE[dimension];
  return `${source}|${rule ? getUnit(rule.amount).dimension : dimension}`;
}

/** Adds a portion to a well and returns the mixed well. */
export function mix(well: WellState, portion: Portion): WellState {
  const assumed = well.assumed || portion.assumed;
  const known = well.volume !== 'unknown';
  const before = well.volume === 'unknown' ? undefined : well.volume;
  const volume: WellState['volume'] =
    before === undefined
      ? 'unknown'
      : (add(
          isZero(before) ? { ...ZERO_VOLUME, unit: portion.volume.unit } : before,
          portion.volume,
        ) as WellState['volume']);
  const empty = known && before !== undefined && isZero(before) && well.components.length === 0;

  const tallies = new Map<string, Tally>();
  const note = (
    source: string,
    unit: string | undefined,
    amount: Quantity | undefined,
    kept?: Quantity,
  ) => {
    const key = keyOf(source, unit);
    const tally = tallies.get(key);
    if (!tally) {
      tallies.set(key, {
        source,
        ...(unit ? { unit } : {}),
        ...(amount ? { amount } : {}),
        ...(kept ? { kept } : {}),
        unknown: !amount && !kept,
      });
      return;
    }
    tally.kept = undefined;
    if (!amount || !tally.amount) {
      tally.unknown = true;
      tally.amount = undefined;
    } else {
      tally.amount = add(tally.amount, amount);
    }
  };

  for (const c of well.components) {
    if (!known) {
      note(c.source, c.concentration?.unit, undefined);
    } else if (c.amount) {
      const dimension = getUnit(c.amount.unit).dimension;
      note(c.source, c.concentration?.unit ?? DISSOLVED[dimension], c.amount);
    } else if (c.concentration && before) {
      note(c.source, c.concentration.unit, amountIn(c.concentration, before));
    } else {
      note(c.source, c.concentration?.unit, undefined);
    }
  }
  for (const c of portion.components) {
    const amount = c.concentration ? amountIn(c.concentration, portion.volume) : undefined;
    const kept = c.concentration && !amount && empty ? c.concentration : undefined;
    note(c.source, c.concentration?.unit, amount, kept);
  }

  const components: Component[] = [];
  for (const t of tallies.values()) {
    if (t.kept) {
      components.push({ source: t.source as Component['source'], concentration: t.kept });
    } else if (
      t.unknown ||
      !t.amount ||
      volume === 'unknown' ||
      !t.unit ||
      !MIXABLE[getUnit(t.unit).dimension]
    ) {
      components.push({ source: t.source as Component['source'] });
    } else {
      components.push({
        source: t.source as Component['source'],
        concentration: concentrationOf(t.amount, volume, t.unit),
      });
    }
  }
  return { volume, components, ...(assumed ? { assumed: true } : {}) };
}

/** Moves a volume from one well to another; returns both wells after. */
export function transfer(
  source: WellState,
  destination: WellState,
  volume: Quantity,
): { source: WellState; destination: WellState } {
  const { left, portion } = take(source, volume);
  return { source: left, destination: mix(destination, portion) };
}

import type { LotAttributes, LotSummary, Quantity, Recipe, StorageBand } from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';
import { convert, getUnit, multiply, UnitError } from './units.ts';

/** Reagent calculators (plan 009a): recipe scaling and unit checks for lot values. */

/** True when both units measure the same thing (volume, mass concentration…). */
export function sameDimension(a: string, b: string): boolean {
  return getUnit(a).dimension === getUnit(b).dimension;
}

/**
 * The amounts a recipe needs for a target batch: each component times target ÷ yield. The target
 * must measure what the yield does (both volumes, say); amounts keep their own units.
 */
export function scaleRecipe(recipe: Recipe, target: Quantity) {
  if (!sameDimension(target.unit, recipe.yields.unit)) {
    throw new UnitError(
      'incompatible_units',
      `The recipe yields ${getUnit(recipe.yields.unit).dimension.replaceAll('_', ' ')}; give the target in a unit like ${recipe.yields.unit}`,
    );
  }
  const yields = new LabDecimal(recipe.yields.value);
  if (yields.isZero()) throw new UnitError('invalid_value', 'The recipe yields nothing');
  const factor = toDecimalString(
    new LabDecimal(convert(target, recipe.yields.unit).value).dividedBy(yields),
  );
  return {
    factor,
    components: recipe.components.map((c) => ({
      product: c.product,
      amount: multiply(c.amount, factor),
    })),
  };
}

/** Storage temperature in words (plan 009c), from the upper end of the range. */
export function storageBand(range: {
  min?: Quantity | undefined;
  max?: Quantity | undefined;
}): StorageBand {
  const top = range.max ?? range.min;
  if (!top) throw new UnitError('invalid_value', 'The storage range has no temperature');
  const celsius = new LabDecimal(convert(top, 'degC').value);
  if (celsius.lessThanOrEqualTo(-130)) return 'cryo';
  if (celsius.lessThanOrEqualTo(-60)) return 'deep_freezer';
  if (celsius.lessThanOrEqualTo(-10)) return 'freezer';
  if (celsius.lessThanOrEqualTo(10)) return 'fridge';
  return 'room';
}

/** A lot that can be used on `today`: unopened or opened, and not past its expiry. */
export function lotInDate(lot: Pick<LotAttributes, 'status' | 'expiry'>, today: string): boolean {
  return (
    (lot.status === 'unopened' || lot.status === 'opened') &&
    (lot.expiry === undefined || lot.expiry >= today)
  );
}

/** A product's lots at a glance: count, lots in date on `today`, and the soonest expiry among them. */
export function lotSummary(
  lots: Pick<LotAttributes, 'status' | 'expiry'>[],
  today: string,
): LotSummary {
  const inDate = lots.filter((l) => lotInDate(l, today));
  const expiries = inDate.flatMap((l) => (l.expiry ? [l.expiry] : [])).sort();
  return {
    count: lots.length,
    inDate: inDate.length,
    ...(expiries[0] ? { nextExpiry: expiries[0] } : {}),
  };
}

/** The calendar date `days` after `date` (both like 2026-09-30). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

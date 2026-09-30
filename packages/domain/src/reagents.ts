import type { Quantity, Recipe } from '@ailab/schema';
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

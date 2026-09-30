import { compare, formatQuantity, getUnit, isUnit, LabDecimal } from '@ailab/domain';
import type { Quantity, SopAttributes } from '@ailab/schema';

export type InputValue = Quantity | string | (Quantity | string)[];

/** What is wrong with a value given for an SOP input, if anything: a known unit, the same kind of quantity as the SOP declares, within its limits. */
export function inputProblem(
  v: SopAttributes['variables'][number],
  value: InputValue,
): string | undefined {
  const declared = [v.min, v.max, ...(Array.isArray(v.value) ? v.value : v.value ? [v.value] : [])];
  const quantityUnit = declared.find((d): d is Quantity => typeof d === 'object')?.unit;
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === 'object' && !isUnit(item.unit)) {
      return `${v.name}: unknown unit "${item.unit}"`;
    }
    if (quantityUnit && typeof item !== 'object') {
      return `${v.name} needs a unit, like ${getUnit(quantityUnit).symbol}`;
    }
    if (typeof item === 'object' && declared.length > 0 && !quantityUnit) {
      return `${v.name} is a plain number, without a unit`;
    }
    if (
      typeof item === 'object' &&
      quantityUnit &&
      getUnit(item.unit).dimension !== getUnit(quantityUnit).dimension
    ) {
      return `${v.name}: ${formatQuantity(item)} is not the same kind of quantity as ${getUnit(quantityUnit).symbol}`;
    }
    if (v.min !== undefined && order(item, v.min) < 0) {
      return `${v.name}: ${words(item)} is below the least allowed, ${words(v.min)}`;
    }
    if (v.max !== undefined && order(item, v.max) > 0) {
      return `${v.name}: ${words(item)} is above the most allowed, ${words(v.max)}`;
    }
  }
  return undefined;
}

function order(a: Quantity | string, b: Quantity | string): number {
  if (typeof a === 'object' && typeof b === 'object') return compare(a, b);
  return new LabDecimal(typeof a === 'object' ? a.value : a).comparedTo(
    typeof b === 'object' ? b.value : b,
  );
}

function words(value: Quantity | string): string {
  return typeof value === 'object' ? formatQuantity(value) : value;
}

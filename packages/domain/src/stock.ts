import type { Quantity } from '@ailab/schema';
import { add, compare, convert, getUnit, subtract } from './units.ts';

/**
 * Stock on hand for a planned amount (plan 017, D6): what the lab's wells of a material hold, less
 * what confirmed transfer plans have reserved from them, against what an experiment needs. Volumes
 * only; a well registered without a volume makes the answer unknown rather than short.
 */

export interface StockWell {
  volume: Quantity | 'unknown';
  /** What confirmed transfer plans have reserved from this well. */
  reserved?: Quantity | undefined;
}

export interface StockCheck {
  verdict: 'enough' | 'short' | 'unknown';
  holds: Quantity;
  reserved: Quantity;
  available: Quantity;
  /** How much more is needed, when short. */
  short?: Quantity;
  /** Wells registered without a volume. */
  unknownWells: number;
}

export class StockError extends Error {}

export function checkStock(needed: Quantity, wells: readonly StockWell[]): StockCheck {
  if (getUnit(needed.unit).dimension !== 'volume')
    throw new StockError(`Stock is checked for volumes; ${needed.unit} is not a volume`);
  const zero: Quantity = { value: '0', unit: needed.unit };
  let holds = zero;
  let reserved = zero;
  let unknownWells = 0;
  for (const w of wells) {
    if (w.volume === 'unknown') unknownWells += 1;
    else holds = add(holds, convert(w.volume, needed.unit));
    if (w.reserved) reserved = add(reserved, convert(w.reserved, needed.unit));
  }
  const left = subtract(holds, reserved);
  const available = compare(left, zero) < 0 ? zero : left;
  if (compare(available, needed) >= 0)
    return { verdict: 'enough', holds, reserved, available, unknownWells };
  if (unknownWells > 0) return { verdict: 'unknown', holds, reserved, available, unknownWells };
  return {
    verdict: 'short',
    holds,
    reserved,
    available,
    short: subtract(needed, available),
    unknownWells,
  };
}

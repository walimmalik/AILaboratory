import { Decimal } from 'decimal.js';

/** Decimal arithmetic for quantities (ADR 0010). 40 significant digits, banker's rounding. */
export const LabDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type LabDecimal = InstanceType<typeof LabDecimal>;

/** Plain decimal notation with no exponent and no trailing zeros; negative zero becomes "0". */
export function toDecimalString(value: LabDecimal): string {
  if (value.isZero()) return '0';
  return value.toFixed();
}

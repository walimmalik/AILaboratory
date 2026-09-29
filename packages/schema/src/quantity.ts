import { z } from 'zod';

/** An exact decimal written as a string, e.g. "12.5" or "-0.003". No exponents, no bare numbers. */
export const DecimalString = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, 'must be a decimal string like "12.5"');
export type DecimalString = z.infer<typeof DecimalString>;

/** A value with its unit. Units are codes from the unit registry in @ailab/domain (e.g. "uL", "ng/uL", "OD600"). */
export const Quantity = z.object({
  value: DecimalString,
  unit: z.string().min(1),
});
export type Quantity = z.infer<typeof Quantity>;

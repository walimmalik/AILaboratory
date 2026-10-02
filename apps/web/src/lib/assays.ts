import { isUnit } from '@ailab/domain';

/**
 * Reads the answer to a template's variable input as typed: a number with a unit becomes a
 * quantity ("50 uL", "50 µL"), anything else stays as typed ("10" for a 10-fold dilution) and the
 * server checks it against the SOP variable.
 */
export function readAnswer(text: string): string | { value: string; unit: string } {
  const t = text.trim();
  const q = /^(-?\d+(?:\.\d+)?)\s*(\S+)$/.exec(t);
  const unit = q?.[2]?.replace('µ', 'u');
  return q && unit && isUnit(unit) ? { value: q[1] as string, unit } : t;
}

import { isUnit } from '@ailab/domain';
import type { StepParameter } from '@ailab/schema';

/**
 * Small helpers for SOP values in lab words (plan 012): finding the value a mistyped name means,
 * making a technical name from lab words, and reading a step setting. The text box itself reads
 * formulas and step words in `sop-text.ts` (ADR 0046).
 */

export interface NamedValue {
  name: string;
  label: string;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

/** Values whose lab name or name starts with, or has a word starting with, what was typed. */
export function suggest(typed: string, values: readonly NamedValue[]): NamedValue[] {
  const q = squash(typed);
  if (!q) return [...values];
  const score = (v: NamedValue) => {
    const label = squash(v.label);
    const name = squash(v.name);
    if (label.startsWith(q) || name.startsWith(q)) return 0;
    if (` ${label}`.includes(` ${q}`) || ` ${name}`.includes(` ${q}`)) return 1;
    if (label.includes(q) || name.includes(q)) return 2;
    return 3;
  };
  return values
    .map((v) => [v, score(v)] as const)
    .filter(([, s]) => s < 3)
    .sort((a, b) => a[1] - b[1])
    .map(([v]) => v);
}

/** The value a mistyped name most likely means, or undefined when nothing is close. */
export function closest(typed: string, values: readonly NamedValue[]): NamedValue | undefined {
  const [first] = suggest(typed, values);
  if (first) return first;
  const q = squash(typed);
  let best: { v: NamedValue; d: number } | undefined;
  for (const v of values) {
    const d = Math.min(distance(q, squash(v.label)), distance(q, squash(v.name)));
    if (!best || d < best.d) best = { v, d };
  }
  return best && best.d <= Math.max(2, Math.floor(q.length / 3)) ? best.v : undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j] as number;
      row[j] = Math.min(
        here + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = here;
    }
  }
  return row[b.length] as number;
}

/** A lab name as a name the calculator and agents use: "Well volume (µL)" → "well_volume_ul". */
export function nameFor(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .replace(/[µμ]/g, 'u')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'v_$1') || 'value';
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

type Setting = Pick<StepParameter, 'quantity' | 'number' | 'variable' | 'text'>;

/** Reads a setting's text: a value by its lab name, a number, a number with a unit, or words. */
export function readSetting(
  text: string,
  values: readonly NamedValue[],
): { ok: true; value: Setting | undefined } | { ok: false; problem: string } {
  const t = text.trim();
  if (!t) return { ok: true, value: undefined };
  const bracket = /^\[(.*)\]$/.exec(t)?.[1];
  const found = values.find(
    (v) => squash(v.label) === squash(bracket ?? t) || v.name === (bracket ?? t),
  );
  if (found) return { ok: true, value: { variable: found.name } };
  if (bracket !== undefined) return { ok: false, problem: `There is no value "${bracket}"` };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: { number: t } };
  const q = /^(-?\d+(?:\.\d+)?)\s*(\S+)$/.exec(t);
  const unit = q?.[2]?.replace('µ', 'u');
  if (q && unit && isUnit(unit))
    return { ok: true, value: { quantity: { value: q[1] as string, unit } } };
  return { ok: true, value: { text: t } };
}

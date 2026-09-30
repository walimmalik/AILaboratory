import { ExpressionError, isUnit, variablesOf } from '@ailab/domain';
import type { StepParameter } from '@ailab/schema';

/**
 * Formulas as a scientist writes them (plan 012, ADR 0036): values by their lab names in brackets,
 * `[Well volume] × [Number of wells] × 1.1`, stored as the calculator's text,
 * `well_volume * wells * 1.1`. Agents write the stored form; the editor shows the readable one.
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

/** The stored formula in lab words: names become `[Label]`, `*` and `/` become × and ÷. */
export function toReadable(expression: string, values: readonly NamedValue[]): string {
  const byName = new Map(values.map((v) => [v.name, v.label]));
  let out = '';
  // Names are replaced only outside a unit ("0.5 mL"), so a value called "mL" can't eat a unit.
  const pattern =
    /(\d+(?:\.\d+)?\s*[A-Za-zµ°%][A-Za-z0-9µ°/]*)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(\*)|(\/)/g;
  let last = 0;
  for (const m of expression.matchAll(pattern)) {
    out += expression.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    if (m[1]) out += m[1];
    else if (m[2]) {
      const label = m[3] ? undefined : byName.get(m[2]);
      out += label ? `[${label}]` : m[2];
      if (m[3]) out += m[3];
    } else if (m[4]) out += '×';
    else out += '÷';
  }
  return out + expression.slice(last);
}

export type Stored =
  | { ok: true; expression: string }
  | {
      ok: false;
      /** In lab words, e.g. `There is no value "Well vol". Did you mean [Well volume]?` */
      problem: string;
      /** The value it most likely means, to offer as a fix. */
      suggestion?: NamedValue;
      /** The text to replace with the suggestion, e.g. "[Well vol]". */
      wrong?: string;
    };

/** The readable formula as the calculator's text, or what is wrong with it in lab words. */
export function toStored(readable: string, values: readonly NamedValue[]): Stored {
  const byLabel = new Map(values.map((v) => [squash(v.label), v]));
  const byName = new Map(values.map((v) => [v.name, v]));
  let unknown: { text: string; words: string } | undefined;
  const expression = readable
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\[([^\]]*)\]/g, (whole, words: string) => {
      const found = byLabel.get(squash(words)) ?? byName.get(words.trim());
      if (found) return found.name;
      unknown ??= { text: whole, words };
      return whole;
    })
    .trim();
  if (unknown) return notAValue(unknown.text, unknown.words, values);
  if (/[[\]]/.test(expression))
    return { ok: false, problem: 'A bracket is open: close it with ] after the value' };
  let names: string[];
  try {
    names = variablesOf(expression);
  } catch (e) {
    if (!(e instanceof ExpressionError)) throw e;
    return { ok: false, problem: toReadable(e.message, values) };
  }
  const stray = names.find((n) => !byName.has(n));
  if (stray) return notAValue(stray, stray, values);
  return { ok: true, expression };
}

function notAValue(text: string, words: string, values: readonly NamedValue[]): Stored {
  const suggestion = closest(words, values);
  return {
    ok: false,
    problem: `There is no value "${words.trim()}"${suggestion ? `. Did you mean [${suggestion.label}]?` : '. Pick one from the values list'}`,
    ...(suggestion ? { suggestion, wrong: text } : {}),
  };
}

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

/** The value being typed at the caret: inside an open `[`, or a word being written. */
export function typingAt(text: string, caret: number): { from: number; typed: string } | undefined {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('[');
  if (open > before.lastIndexOf(']')) return { from: open, typed: before.slice(open + 1) };
  const word = /[A-Za-z_][A-Za-z0-9_ ]*$/.exec(before);
  if (!word || /\d\s*$/.test(before.slice(0, word.index))) return undefined;
  const typed = word[0].trimStart();
  return typed.length >= 2 ? { from: caret - typed.length, typed } : undefined;
}

/** Common formulas to start from; the blanks in brackets are filled by picking values. */
export const starterFormulas: { title: string; formula: string; about: string }[] = [
  {
    title: 'Total with overage',
    formula: '[number of wells] × [volume per well] × 1.1',
    about: 'What to prepare for all wells, with 10% extra for dead volume',
  },
  {
    title: 'Dilution (C1V1 = C2V2)',
    formula: '[final concentration] × [final volume] ÷ [stock concentration]',
    about: 'How much stock to take for a final concentration and volume',
  },
  {
    title: 'Master mix per reaction',
    formula: '[total mix volume] ÷ [number of reactions]',
    about: 'Each reaction’s share of a master mix',
  },
  {
    title: 'Round up to a tube size',
    formula: 'roundup([total volume], 0.5 mL)',
    about: 'Up to the next 0.5 mL, so there is always enough',
  },
  {
    title: 'Plates needed',
    formula: 'ceil([number of samples] × [replicates] ÷ 96)',
    about: 'Whole plates for all samples and replicates',
  },
];

/** Operators and functions to insert, with what each does in a few words. */
export const formulaParts: { insert: string; words: string; kind: 'operator' | 'function' }[] = [
  { insert: ' + ', words: 'add', kind: 'operator' },
  { insert: ' − ', words: 'subtract', kind: 'operator' },
  { insert: ' × ', words: 'multiply', kind: 'operator' },
  { insert: ' ÷ ', words: 'divide', kind: 'operator' },
  { insert: '(', words: 'open bracket', kind: 'operator' },
  { insert: ')', words: 'close bracket', kind: 'operator' },
  { insert: 'roundup(, 0.5 mL)', words: 'round up to a step, e.g. 0.5 mL', kind: 'function' },
  { insert: 'rounddown(, 1 uL)', words: 'round down to a step', kind: 'function' },
  { insert: 'ceil()', words: 'round a plain number up to a whole one', kind: 'function' },
  { insert: 'max(, )', words: 'the larger of', kind: 'function' },
  { insert: 'min(, )', words: 'the smaller of', kind: 'function' },
  { insert: 'sum()', words: 'add up a list', kind: 'function' },
  { insert: 'count()', words: 'how many in a list', kind: 'function' },
];

/**
 * A step's words name values and materials as `name`, which the SOP page shows as the value itself;
 * the editor shows them as [Label] and stores them back. Other brackets stay as written.
 */
export function wordsToReadable(text: string, values: readonly NamedValue[]): string {
  const byName = new Map(values.map((v) => [v.name, v.label]));
  return text.replace(/`([A-Za-z_][A-Za-z0-9_]*)`/g, (whole, name: string) => {
    const label = byName.get(name);
    return label ? `[${label}]` : whole;
  });
}

export function wordsToStored(text: string, values: readonly NamedValue[]): string {
  const byLabel = new Map(values.map((v) => [squash(v.label), v.name]));
  return text.replace(/\[([^\]]*)\]/g, (whole, words: string) => {
    const name = byLabel.get(squash(words));
    return name ? `\`${name}\`` : whole;
  });
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

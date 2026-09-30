import type { Quantity } from '@ailab/schema';
import { compare, getUnit, isUnit } from './units.ts';

/**
 * Scoring a digitized SOP against a hand-checked expectation (plan 012 G11). Deterministic, so a
 * score compares models (and drafts before and after review) rather than judging by eye.
 */

export interface ExpectedStep {
  /** The step's action, or any of several (e.g. add or transfer). */
  action: string | string[];
  /** Values the step must state, in its parameters or its words. */
  quantities?: Quantity[] | undefined;
  /** Words the step must contain (any one of them), case-insensitive. */
  words?: string[] | undefined;
}

export interface SopExpectation {
  materials?: { label: string; aliases?: string[] | undefined }[] | undefined;
  steps?: ExpectedStep[] | undefined;
  /** Values that must appear somewhere: a variable, a step parameter or a solution. */
  values?: { quantity: Quantity; about?: string | undefined }[] | undefined;
  /** Spots the source leaves unclear, which must become open questions. */
  questions?: { about: string; words: string[] }[] | undefined;
}

/** The parts of a draft SOP the benchmark reads. */
export interface ScoredDraft {
  materials: { label: string; requirements?: string | undefined }[];
  solutions?: { label: string; text: string }[] | undefined;
  variables: { name: string; value?: unknown }[];
  steps: {
    action: string;
    title?: string | undefined;
    text: string;
    parameters?:
      | {
          quantity?: Quantity | undefined;
          variable?: string | undefined;
          text?: string | undefined;
        }[]
      | undefined;
  }[];
  questions?: { question: string; suggestion?: string | undefined }[] | undefined;
}

export interface SectionScore {
  expected: number;
  /** Expected items the draft has. */
  found: number;
  /** found / expected, 0 to 1. */
  recall: number;
  /** For materials and steps: the share of the draft's items that match one expected. */
  precision?: number | undefined;
  /** For steps: the share of found steps in the expected order. */
  order?: number | undefined;
  missing: string[];
}

export interface SopScore {
  materials?: SectionScore | undefined;
  steps?: SectionScore | undefined;
  values?: SectionScore | undefined;
  questions?: SectionScore | undefined;
  /** The mean recall of the sections expected, 0 to 1. */
  overall: number;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9µ]+/g, ' ')
    .trim();

/** Every word of `needle` appears in `hay`, in any order. */
function covers(hay: string, needle: string): boolean {
  const have = new Set(words(hay).split(' '));
  return words(needle)
    .split(' ')
    .filter(Boolean)
    .every((w) => have.has(w));
}

const isQuantity = (v: unknown): v is Quantity =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Quantity).value === 'string' &&
  typeof (v as Quantity).unit === 'string';

function sameQuantity(a: Quantity, b: Quantity): boolean {
  if (!isUnit(a.unit) || !isUnit(b.unit)) return false;
  if (getUnit(a.unit).dimension !== getUnit(b.unit).dimension) return false;
  return compare(a, b) === 0;
}

/** Quantities a step states: in its parameters (variables resolved to their values) and its words. */
function stepQuantities(
  step: ScoredDraft['steps'][number],
  values: Map<string, unknown>,
): Quantity[] {
  const out: Quantity[] = [];
  for (const p of step.parameters ?? []) {
    if (p.quantity) out.push(p.quantity);
    const v = p.variable ? values.get(p.variable) : undefined;
    if (isQuantity(v)) out.push(v);
  }
  return [...out, ...quantitiesIn(`${step.title ?? ''} ${step.text}`)];
}

const UNIT_WORDS: Record<string, string> = {
  ul: 'uL',
  µl: 'uL',
  μl: 'uL',
  ml: 'mL',
  l: 'L',
  nl: 'nL',
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
  min: 'min',
  mins: 'min',
  minute: 'min',
  minutes: 'min',
  s: 's',
  sec: 's',
  seconds: 's',
  '°c': 'degC',
  c: 'degC',
  rpm: 'rpm',
  nm: 'nm',
  'ug/ml': 'ug/mL',
  'µg/ml': 'ug/mL',
  'mg/ml': 'mg/mL',
  'ng/ml': 'ng/mL',
  g: 'g',
};

/** Numbers with a unit in running text: "200 uL", "37.0°C", "5 min", "34 ug/mL". */
export function quantitiesIn(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(°\s*C|[a-zA-Zµμ]+(?:\/[a-zA-Z]+)?)/g)) {
    const raw = (m[2] as string).replace(/\s+/g, '').toLowerCase();
    const unit = UNIT_WORDS[raw];
    if (unit && isUnit(unit)) out.push({ value: m[1] as string, unit });
  }
  return out;
}

const section = (expected: number, found: number, missing: string[]): SectionScore => ({
  expected,
  found,
  recall: expected === 0 ? 1 : found / expected,
  missing,
});

const describe = (s: ExpectedStep) =>
  [
    [s.action].flat().join('/'),
    ...(s.quantities ?? []).map((q) => `${q.value} ${q.unit}`),
    ...(s.words ?? []).slice(0, 1),
  ].join(' ');

/** Length of the longest increasing run of indices, for how much of the order is kept. */
function longestIncreasing(xs: number[]): number {
  const tails: number[] = [];
  for (const x of xs) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

export function scoreSop(draft: ScoredDraft, expected: SopExpectation): SopScore {
  const out: SopScore = { overall: 0 };
  const values = new Map(draft.variables.map((v) => [v.name, v.value]));

  if (expected.materials) {
    const labels = [
      ...draft.materials.map((m) => `${m.label} ${m.requirements ?? ''}`),
      ...(draft.solutions ?? []).map((s) => `${s.label} ${s.text}`),
    ];
    const used = new Set<number>();
    const missing: string[] = [];
    for (const m of expected.materials) {
      const i = labels.findIndex(
        (l, j) => !used.has(j) && [m.label, ...(m.aliases ?? [])].some((n) => covers(l, n)),
      );
      if (i < 0) missing.push(m.label);
      else used.add(i);
    }
    out.materials = {
      ...section(expected.materials.length, expected.materials.length - missing.length, missing),
      precision: labels.length === 0 ? 0 : used.size / labels.length,
    };
  }

  if (expected.steps) {
    const matched: number[] = [];
    const used = new Set<number>();
    const missing: string[] = [];
    for (const e of expected.steps) {
      const actions = [e.action].flat();
      const i = draft.steps.findIndex((s, j) => {
        if (used.has(j) || !actions.includes(s.action)) return false;
        const stated = stepQuantities(s, values);
        const text = `${s.title ?? ''} ${s.text}`;
        return (
          (e.quantities ?? []).every((q) => stated.some((x) => sameQuantity(x, q))) &&
          (!e.words?.length || e.words.some((w) => covers(text, w)))
        );
      });
      if (i < 0) missing.push(describe(e));
      else {
        used.add(i);
        matched.push(i);
      }
    }
    out.steps = {
      ...section(expected.steps.length, matched.length, missing),
      precision: draft.steps.length === 0 ? 0 : used.size / draft.steps.length,
      order: matched.length === 0 ? 0 : longestIncreasing(matched) / matched.length,
    };
  }

  if (expected.values) {
    const stated: Quantity[] = [
      ...draft.variables.flatMap((v) => [v.value].flat().filter(isQuantity)),
      ...draft.steps.flatMap((s) => stepQuantities(s, values)),
      ...(draft.solutions ?? []).flatMap((s) => quantitiesIn(s.text)),
    ];
    const missing = expected.values
      .filter((e) => !stated.some((q) => sameQuantity(q, e.quantity)))
      .map((e) => `${e.quantity.value} ${e.quantity.unit}${e.about ? ` (${e.about})` : ''}`);
    out.values = section(expected.values.length, expected.values.length - missing.length, missing);
  }

  if (expected.questions) {
    const asked = (draft.questions ?? []).map((q) => `${q.question} ${q.suggestion ?? ''}`);
    const missing = expected.questions
      .filter((e) => !asked.some((a) => e.words.some((w) => covers(a, w))))
      .map((e) => e.about);
    out.questions = section(
      expected.questions.length,
      expected.questions.length - missing.length,
      missing,
    );
  }

  const recalls = [out.materials, out.steps, out.values, out.questions].flatMap((s) =>
    s ? [s.recall] : [],
  );
  out.overall = recalls.length === 0 ? 0 : recalls.reduce((a, b) => a + b, 0) / recalls.length;
  return out;
}

import type {
  EffectiveRule,
  EffectiveStorage,
  HandlingRule,
  Quantity,
  RuleContribution,
  RuleOrigin,
  StorageRange,
} from '@ailab/schema';
import { parseWellName, wellName } from './labware.ts';
import { compare, formatQuantity } from './units.ts';

/**
 * Strictest-rule merging (plan 010d): a container inherits the handling rules of everything in its
 * wells. Rules of one type merge into the strictest (the shortest time, the fewest freeze-thaws,
 * the narrowest temperature range, the longest rest), enforced when any source enforces it, and
 * every source stays listed.
 */

/** Rules whose time is a limit: the shortest wins. */
const SHORTEST = new Set<HandlingRule['rule']>([
  'stable_after_opening',
  'stable_after_preparation',
  'use_within',
  'max_time_out_of_storage',
]);
/** Rules whose time is a rest to wait out: the longest wins. */
const LONGEST = new Set<HandlingRule['rule']>(['equilibrate', 'reconstitute']);

const ORDER: HandlingRule['rule'][] = [
  'max_time_out_of_storage',
  'keep_cold',
  'protect_from_light',
  'freeze_thaw_limit',
  'use_within',
  'stable_after_opening',
  'stable_after_preparation',
  'read_within',
  'thaw',
  'equilibrate',
  'reconstitute',
  'mix_before_use',
  'hygroscopic',
  'advice',
];

/** One rule on one record, reached through some lots or samples in some wells. */
export interface SourcedRule {
  rule: HandlingRule;
  origin: RuleOrigin;
  via: string;
  wells: readonly string[];
}

export interface SourcedStorage {
  range: StorageRange;
  origin: RuleOrigin;
  via: string;
  wells: readonly string[];
}

/**
 * Wells as the fewest blocks a person reads easily: runs along each row, and rows with the same
 * run stacked into one block ("A3:P22"). Blocks come in row order.
 */
export function compactWells(wells: readonly string[]): string[] {
  const rows = new Map<number, number[]>();
  for (const name of new Set(wells)) {
    const { row, column } = parseWellName(name);
    rows.set(row, [...(rows.get(row) ?? []), column]);
  }
  const runs: { row: number; from: number; to: number }[] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const columns = (rows.get(row) as number[]).sort((a, b) => a - b);
    let from = columns[0] as number;
    let to = from;
    for (const column of columns.slice(1)) {
      if (column === to + 1) {
        to = column;
        continue;
      }
      runs.push({ row, from, to });
      from = column;
      to = column;
    }
    runs.push({ row, from, to });
  }
  const blocks: { top: number; bottom: number; from: number; to: number }[] = [];
  for (const run of runs) {
    const above = blocks.find(
      (b) => b.bottom === run.row - 1 && b.from === run.from && b.to === run.to,
    );
    if (above) above.bottom = run.row;
    else blocks.push({ top: run.row, bottom: run.row, from: run.from, to: run.to });
  }
  return blocks.map((b) => {
    const first = wellName(b.top, b.from);
    const last = wellName(b.bottom, b.to);
    return first === last ? first : `${first}:${last}`;
  });
}

/** Folds the same rule on the same record, reached through several lots or samples, into one. */
function contributions(rules: readonly SourcedRule[]): RuleContribution[] {
  const byKey = new Map<string, { c: RuleContribution; via: Set<string>; wells: Set<string> }>();
  for (const r of rules) {
    const key = `${r.origin.id}\u0000${JSON.stringify(r.rule)}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        c: { origin: r.origin, rule: r.rule, via: [], wells: [] },
        via: new Set(),
        wells: new Set(),
      };
      byKey.set(key, entry);
    }
    entry.via.add(r.via);
    for (const w of r.wells) entry.wells.add(w);
  }
  return [...byKey.values()].map(({ c, via, wells }) => ({
    ...c,
    via: [...via].sort(),
    wells: compactWells([...wells]),
  })) as RuleContribution[];
}

function groupKey(rule: HandlingRule): string {
  if (rule.rule === 'advice') return `advice\u0000${rule.text.trim()}`;
  if (rule.rule === 'read_within') return `read_within\u0000${rule.after.trim().toLowerCase()}`;
  return rule.rule;
}

type ReadWindow = Extract<HandlingRule, { rule: 'read_within' }>;

const tighter = <Q extends Quantity>(a: Q | undefined, b: Q | undefined, pick: 'low' | 'high') => {
  if (!a) return b;
  if (!b) return a;
  const c = compare(a, b);
  return (pick === 'low' ? c <= 0 : c >= 0) ? a : b;
};

const sameQuantity = (a: Quantity | undefined, b: Quantity | undefined) =>
  a === undefined ? b === undefined : b !== undefined && compare(a, b) === 0;

/** The narrowest range: the highest minimum and the lowest maximum. */
function narrowest(ranges: readonly StorageRange[]): { range: StorageRange; conflict?: string } {
  let min: StorageRange['min'];
  let max: StorageRange['max'];
  for (const r of ranges) {
    min = tighter(min, r.min, 'high');
    max = tighter(max, r.max, 'low');
  }
  const range: StorageRange = { ...(min ? { min } : {}), ...(max ? { max } : {}) };
  return min && max && compare(min, max) > 0
    ? {
        range,
        conflict: `One source needs at least ${formatQuantity(min)} and another at most ${formatQuantity(max)}; the ranges don't overlap`,
      }
    : { range };
}

const rangeWords = (r: StorageRange) =>
  r.min && r.max
    ? `${formatQuantity(r.min)} to ${formatQuantity(r.max)}`
    : r.min
      ? `at least ${formatQuantity(r.min)}`
      : `at most ${formatQuantity(r.max as Quantity)}`;

function merge(group: RuleContribution[]): EffectiveRule {
  const enforced = group.some((c) => c.rule.enforced);
  const rules = group.map((c) => c.rule);
  const first = rules.find((r) => r.enforced) ?? (rules[0] as HandlingRule);
  const result = (rule: HandlingRule, conflict?: string): EffectiveRule => ({
    rule: { ...rule, enforced },
    from: group,
    ...(conflict ? { conflict } : {}),
  });
  if (group.length === 1) return result(first);

  if (SHORTEST.has(first.rule) || LONGEST.has(first.rule)) {
    const timed = rules.filter((r) => 'period' in r && r.period) as (HandlingRule & {
      period: Quantity;
    })[];
    if (timed.length === 0) return result(first);
    const pick = SHORTEST.has(first.rule) ? 'low' : 'high';
    const winner = timed.reduce((a, b) => (tighter(a.period, b.period, pick) === a.period ? a : b));
    return result(winner);
  }
  if (first.rule === 'freeze_thaw_limit') {
    const limits = rules as Extract<HandlingRule, { rule: 'freeze_thaw_limit' }>[];
    return result(limits.reduce((a, b) => (b.cycles < a.cycles ? b : a)));
  }
  if (first.rule === 'keep_cold' || first.rule === 'thaw') {
    const ranged = (rules as Extract<HandlingRule, { rule: 'keep_cold' | 'thaw' }>[]).filter(
      (r) => r.at,
    );
    if (ranged.length === 0) return result(first);
    const { range, conflict } = narrowest(ranged.map((r) => r.at as StorageRange));
    const exact = ranged.find(
      (r) => sameQuantity(r.at?.min, range.min) && sameQuantity(r.at?.max, range.max),
    );
    const words = first.rule === 'keep_cold' ? 'Keep cold' : 'Thaw';
    return result(
      exact ?? {
        ...first,
        at: range,
        text: `${words} at ${rangeWords(range)} (the narrowest range of its sources)`,
      },
      conflict,
    );
  }
  if (first.rule === 'read_within') {
    const reads = rules as Extract<HandlingRule, { rule: 'read_within' }>[];
    let min: ReadWindow['min'];
    let max: ReadWindow['max'];
    for (const r of reads) {
      min = tighter(min, r.min, 'high');
      max = tighter(max, r.max, 'low');
    }
    const exact = reads.find((r) => sameQuantity(r.min, min) && sameQuantity(r.max, max));
    const conflict =
      min && max && compare(min, max) > 0
        ? `One source says read no sooner than ${formatQuantity(min)} and another no later than ${formatQuantity(max)} after ${first.after}`
        : undefined;
    const text = `Read ${min ? `from ${formatQuantity(min)}` : ''}${min && max ? ' ' : ''}${max ? `within ${formatQuantity(max)}` : ''} after ${first.after} (the narrowest window of its sources)`;
    return result(
      exact ?? { ...first, ...(min ? { min } : {}), ...(max ? { max } : {}), text },
      conflict,
    );
  }
  // Present or not: protect from light, mix before use, hygroscopic, and identical advice.
  return result(first);
}

/** The rules a container keeps: one per rule type (advice per text, read windows per step). */
export function mergeHandlingRules(rules: readonly SourcedRule[]): EffectiveRule[] {
  const groups = new Map<string, RuleContribution[]>();
  for (const c of contributions(rules)) {
    const key = groupKey(c.rule);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .map(merge)
    .sort(
      (a, b) =>
        Number(b.rule.enforced) - Number(a.rule.enforced) ||
        ORDER.indexOf(a.rule.rule) - ORDER.indexOf(b.rule.rule),
    );
}

/** The narrowest storage temperature of everything in a container, or undefined when none is known. */
export function mergeStorage(items: readonly SourcedStorage[]): EffectiveStorage | undefined {
  const byOrigin = new Map<
    string,
    { item: SourcedStorage; via: Set<string>; wells: Set<string> }
  >();
  for (const item of items) {
    if (!item.range.min && !item.range.max) continue;
    let entry = byOrigin.get(item.origin.id);
    if (!entry) {
      entry = { item, via: new Set(), wells: new Set() };
      byOrigin.set(item.origin.id, entry);
    }
    entry.via.add(item.via);
    for (const w of item.wells) entry.wells.add(w);
  }
  if (byOrigin.size === 0) return undefined;
  const from = [...byOrigin.values()].map(({ item, via, wells }) => ({
    origin: item.origin,
    range: item.range,
    via: [...via].sort(),
    wells: compactWells([...wells]),
  }));
  const { range, conflict } = narrowest(from.map((f) => f.range));
  return { range, from, ...(conflict ? { conflict } : {}) } as EffectiveStorage;
}

import type {
  MemoryAttributes,
  MemoryConditions,
  MemoryEffect,
  MemoryFacts,
  Quantity,
} from '@ailab/schema';
import { compare } from './units.ts';

/**
 * Lab memory (plan 005a): the dates and groupings code works out for memories, without I/O.
 */

export type MemoryKind = 'convention' | 'preference' | 'quirk' | 'lesson' | 'fact';

/** Months until a person should check a memory of this kind again (M6); preferences never. */
export const CHECK_AGAIN_MONTHS: Record<MemoryKind, number | undefined> = {
  quirk: 6,
  lesson: 6,
  convention: 12,
  fact: 12,
  preference: undefined,
};

/** The calendar date `months` after `date` (both like 2026-09-30), on the month's last day if shorter. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** When a memory of this kind made today is next due for a check, or undefined for never. */
export function checkAgainFor(kind: MemoryKind, today: string): string | undefined {
  const months = CHECK_AGAIN_MONTHS[kind];
  return months === undefined ? undefined : addMonths(today, months);
}

/** Whether a memory is past its check-again date: still used, shown as due for a check. */
export const isDue = (checkAgain: string | undefined, today: string) =>
  checkAgain !== undefined && checkAgain <= today;

// ---------------------------------------------------------------------------------------------
// Which memories apply to a piece of work (plan 005b, M2, M7, M8, change 2 and 4).

/** An active memory as matching reads it. */
export interface MemoryCandidate {
  id: string;
  name: string;
  attributes: MemoryAttributes;
  /** When it last changed (ISO), for the last tie-break: newer first. */
  updatedAt: string;
}

export interface MemoryRequest {
  /** The records the work is about or uses; a memory about one of them is relevant. */
  records: readonly string[];
  /** What the consumer knows about the work. */
  facts: MemoryFacts;
  /** The person the work is for; their personal memories apply, nobody else's. */
  person?: string | undefined;
}

export interface MemoryMatch {
  memory: MemoryCandidate;
  /** Every condition was evaluated and holds, so code may apply its effect. */
  applies: boolean;
  /** Conditions the request couldn't evaluate (its facts leave the key out). */
  unknown: (keyof MemoryConditions)[];
  /** How many conditions held, and how many of the request's records it is about. */
  conditions: number;
  links: number;
  personal: boolean;
}

const STRENGTH_ORDER: Record<MemoryAttributes['strength'], number> = {
  rule: 0,
  default: 1,
  note: 2,
};

function inRange(
  value: Quantity,
  range: { min?: Quantity | undefined; max?: Quantity | undefined },
): boolean {
  if (range.min && compare(value, range.min) < 0) return false;
  if (range.max && compare(value, range.max) > 0) return false;
  return true;
}

/** Whether one condition holds for the facts, or undefined when the facts can't say. */
function holds(
  key: keyof MemoryConditions,
  c: MemoryConditions,
  f: MemoryFacts,
): boolean | undefined {
  switch (key) {
    case 'labware':
      return f.labware ? f.labware.includes(c.labware as string) : undefined;
    case 'volume':
      return f.volume && c.volume ? inRange(f.volume, c.volume) : undefined;
    case 'temperature':
      return f.temperature && c.temperature ? inRange(f.temperature, c.temperature) : undefined;
    case 'samples': {
      if (f.samples === undefined || !c.samples) return undefined;
      const { min, max } = c.samples;
      return (min === undefined || f.samples >= min) && (max === undefined || f.samples <= max);
    }
    case 'roles':
      return f.roles ? (c.roles ?? []).some((r) => f.roles?.includes(r)) : undefined;
    case 'weekdays':
      return f.weekday ? (c.weekdays ?? []).includes(f.weekday) : undefined;
    default: {
      const want = c[key];
      const have = f[key as keyof MemoryFacts];
      return have === undefined ? undefined : have === want;
    }
  }
}

/**
 * How one memory relates to the work, or undefined when it doesn't: a personal memory of someone
 * else, a condition the facts contradict, or a memory neither about the records, nor lab-wide with
 * a condition that held, nor a lab-wide rule.
 */
export function matchMemory(
  memory: MemoryCandidate,
  request: MemoryRequest,
): MemoryMatch | undefined {
  const a = memory.attributes;
  const personal = a.appliesTo.to === 'person';
  if (a.appliesTo.to === 'person' && a.appliesTo.user !== request.person) return undefined;
  const c = a.conditions ?? {};
  const unknown: (keyof MemoryConditions)[] = [];
  let conditions = 0;
  for (const key of Object.keys(c) as (keyof MemoryConditions)[]) {
    const result = holds(key, c, request.facts);
    if (result === false) return undefined;
    if (result === undefined) unknown.push(key);
    else conditions++;
  }
  const about = a.about ?? [];
  const links = about.filter((id) => request.records.includes(id)).length;
  const relevant = links > 0 || (about.length === 0 && (conditions > 0 || a.strength === 'rule'));
  if (!relevant) return undefined;
  return { memory, applies: unknown.length === 0, unknown, conditions, links, personal };
}

/**
 * The total specificity order (change 2): strength (rule, default, note), then a personal memory
 * of the person, then more conditions that held, then more matching links, then newer.
 */
export function compareMatches(a: MemoryMatch, b: MemoryMatch): number {
  return (
    STRENGTH_ORDER[a.memory.attributes.strength] - STRENGTH_ORDER[b.memory.attributes.strength] ||
    Number(b.personal) - Number(a.personal) ||
    b.conditions - a.conditions ||
    b.links - a.links ||
    b.memory.updatedAt.localeCompare(a.memory.updatedAt) ||
    a.memory.name.localeCompare(b.memory.name)
  );
}

/** Every relevant memory for the work, most specific first. */
export function memoriesFor(
  memories: readonly MemoryCandidate[],
  request: MemoryRequest,
): MemoryMatch[] {
  return memories
    .flatMap((m) => {
      const match = matchMemory(m, request);
      return match ? [match] : [];
    })
    .sort(compareMatches);
}

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q)))
      : x,
  );

const prefixOf = (id: string) => id.slice(0, id.indexOf('_'));

/** Why two effects can't both apply, or undefined when they can (change 2). */
export function effectClash(a: MemoryEffect, b: MemoryEffect): string | undefined {
  if (a.effect === 'set' && b.effect === 'set')
    return a.slot === b.slot && stableJson(a.value) !== stableJson(b.value)
      ? `they set ${a.slot.replaceAll('_', ' ')} to different values`
      : undefined;
  if (a.effect === 'set' || b.effect === 'set') return undefined;
  if (a.record === b.record)
    return a.effect !== b.effect ? 'one prefers and the other avoids the same record' : undefined;
  if (a.effect === 'prefer' && b.effect === 'prefer' && prefixOf(a.record) === prefixOf(b.record))
    return 'they prefer different records for the same choice';
  return undefined;
}

const specificity = (m: MemoryMatch) =>
  [m.memory.attributes.strength, m.personal, m.conditions, m.links].join('|');

/** Pairs of applying memories of equal specificity whose effects clash; code applies neither's lead. */
export function matchConflicts(
  matches: readonly MemoryMatch[],
): { memories: [MemoryCandidate, MemoryCandidate]; why: string }[] {
  const applying = matches.filter((m) => m.applies && m.memory.attributes.effect);
  const out: { memories: [MemoryCandidate, MemoryCandidate]; why: string }[] = [];
  for (const [i, x] of applying.entries())
    for (const y of applying.slice(i + 1)) {
      if (specificity(x) !== specificity(y)) continue;
      const why = effectClash(
        x.memory.attributes.effect as MemoryEffect,
        y.memory.attributes.effect as MemoryEffect,
      );
      if (why) out.push({ memories: [x.memory, y.memory], why });
    }
  return out;
}

const rangesOverlap = <T>(
  a: { min?: T | undefined; max?: T | undefined },
  b: { min?: T | undefined; max?: T | undefined },
  cmp: (x: T, y: T) => number,
) =>
  !(a.min !== undefined && b.max !== undefined && cmp(a.min, b.max) > 0) &&
  !(b.min !== undefined && a.max !== undefined && cmp(b.min, a.max) > 0);

/** Whether some work could meet both sets of conditions: every key both name can agree. */
export function conditionsOverlap(a: MemoryConditions = {}, b: MemoryConditions = {}): boolean {
  for (const key of Object.keys(a) as (keyof MemoryConditions)[]) {
    const x = a[key];
    const y = b[key];
    if (x === undefined || y === undefined) continue;
    if (key === 'volume' || key === 'temperature') {
      if (!rangesOverlap(x as QuantityRange, y as QuantityRange, compare)) return false;
    } else if (key === 'samples') {
      if (!rangesOverlap(x as NumberRange, y as NumberRange, (p, q) => p - q)) return false;
    } else if (key === 'roles' || key === 'weekdays') {
      if (!(x as string[]).some((v) => (y as string[]).includes(v))) return false;
    } else if (x !== y) return false;
  }
  return true;
}

type QuantityRange = { min?: Quantity | undefined; max?: Quantity | undefined };
type NumberRange = { min?: number | undefined; max?: number | undefined };

/**
 * The active memories a memory can't be confirmed beside (change 2): effects that clash, for the
 * same people, about the same records (or both lab-wide), under conditions that overlap, at equal
 * specificity (strength and the number of conditions and links).
 */
export function memoryConflicts(
  memory: MemoryAttributes,
  others: readonly MemoryCandidate[],
): { memory: MemoryCandidate; why: string }[] {
  if (!memory.effect) return [];
  const who = (a: MemoryAttributes) => (a.appliesTo.to === 'lab' ? 'lab' : a.appliesTo.user);
  const count = (a: MemoryAttributes) => Object.keys(a.conditions ?? {}).length;
  const about = memory.about ?? [];
  return others.flatMap((other) => {
    const o = other.attributes;
    if (!o.effect || o.retired) return [];
    if (who(o) !== who(memory) || o.strength !== memory.strength) return [];
    if (count(o) !== count(memory) || (o.about ?? []).length !== about.length) return [];
    const sameAbout = about.length === 0 ? true : about.some((id) => (o.about ?? []).includes(id));
    if (!sameAbout || !conditionsOverlap(memory.conditions, o.conditions)) return [];
    const why = effectClash(memory.effect as MemoryEffect, o.effect);
    return why ? [{ memory: other, why }] : [];
  });
}

/** One line for an agent's prompt: name, strength and statement. */
export const memoryLine = (m: Pick<MemoryCandidate, 'name' | 'attributes'>) =>
  `${m.name} (${m.attributes.strength}) ${m.attributes.statement}`;

export interface AppliedEffects {
  /** Records to rank first, with the memory that says so. */
  prefer: Map<string, MemoryCandidate>;
  /** Records to rank last (a default) or refuse (a rule). */
  avoid: Map<string, MemoryCandidate>;
  /** Slot values to fill. */
  set: Map<string, { value: unknown; memory: MemoryCandidate }>;
}

/**
 * The effects code applies (change 1): from memories that apply, most specific first per record
 * or slot. Memories whose effects clash at equal specificity apply neither; the agent sees both.
 */
export function appliedEffects(matches: readonly MemoryMatch[]): AppliedEffects {
  const clashing = new Set(matchConflicts(matches).flatMap((c) => c.memories.map((m) => m.id)));
  const out: AppliedEffects = { prefer: new Map(), avoid: new Map(), set: new Map() };
  for (const m of matches) {
    const effect = m.memory.attributes.effect;
    if (!m.applies || !effect || clashing.has(m.memory.id)) continue;
    if (effect.effect === 'set') {
      if (!out.set.has(effect.slot))
        out.set.set(effect.slot, { value: effect.value, memory: m.memory });
    } else if (!out.prefer.has(effect.record) && !out.avoid.has(effect.record)) {
      out[effect.effect].set(effect.record, m.memory);
    }
  }
  return out;
}

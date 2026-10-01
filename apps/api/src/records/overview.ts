import { formatQuantity, isUnit } from '@ailab/domain';
import type {
  OperationContract,
  OverviewFact,
  OverviewPart,
  Quantity,
  RecordEnvelope,
  RecordOverview,
} from '@ailab/schema';
import type { z } from 'zod';
import type { OperationDeps } from '../operations/registry.ts';
import { RecordError } from './errors.ts';
import { type RecordContext, RecordService } from './service.ts';

/**
 * A record as a person reads it first (plan 004f N4, ADR 0063): an identity line and a few facts,
 * chosen per kind by the module that owns the kind. Worked out on read; nothing is stored.
 */
export type OverviewBuilder = (
  record: RecordEnvelope,
  read: OverviewReader,
) => Promise<RecordOverview>;

/** What a builder can read: records in the lab, the links to a record, and other modules' read operations. */
export class OverviewReader {
  readonly #service: RecordService;
  constructor(
    readonly ctx: RecordContext,
    readonly deps: OperationDeps,
  ) {
    this.#service = new RecordService(deps.db, deps.kinds);
  }

  /** A record in this lab, or undefined when it doesn't exist (a dangling reference shows as missing). */
  async get(id: string | undefined): Promise<RecordEnvelope | undefined> {
    if (!id) return undefined;
    try {
      return await this.#service.get(this.ctx, id);
    } catch (error) {
      if (error instanceof RecordError && error.code === 'not_found') return undefined;
      throw error;
    }
  }

  /** The records linking to this one with a relation (a product's lots), drafts and active ones. */
  async linking(id: string, relation: string): Promise<RecordEnvelope[]> {
    const links = (await this.#service.linksTo(this.ctx, id)).filter(
      (l) => l.relation === relation,
    );
    if (links.length === 0) return [];
    const found = await this.#service.list(this.ctx, { ids: links.map((l) => l.fromId) });
    return found.filter((r) => r.status !== 'archived');
  }

  /** Another module's read operation, run as the caller. */
  async run<C extends OperationContract>(
    contract: C,
    input: z.input<C['input']>,
  ): Promise<z.infer<C['output']>> {
    const result = await this.deps.registry.execute(this.ctx, contract.id, input);
    if (!('output' in result)) throw new Error(`${contract.id} did not return a result`);
    return result.output as z.infer<C['output']>;
  }
}

// ---------------------------------------------------------------------------------------------
// Words shared by the builders, so every kind says dates, amounts and choices the same way.

/** "in_use" → "in use". */
export const words = (value: string): string => value.replaceAll('_', ' ');

/** A capital first letter, for an identity part that starts the line. */
export const capital = (text: string): string =>
  text ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-03-31" → "31 Mar 2027". */
export function day(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A quantity with its unit's symbol ("50 µL"); a unit the app doesn't know is written as given. */
export function amount(q: Quantity): string {
  return isUnit(q.unit) ? formatQuantity(q) : `${q.value} ${q.unit}`;
}

/** Whole days from today (UTC) to a calendar date; negative when it has passed. */
export function daysUntil(date: string, today = new Date()): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}

/** An expiry as a fact: crit once passed, warn within 30 days. */
export function expiryFact(expiry: string, field = 'expiry', today = new Date()): OverviewFact {
  const left = daysUntil(expiry, today);
  return {
    label: 'expires',
    value: day(expiry),
    field,
    ...(left < 0
      ? { detail: 'expired', tone: 'crit' as const }
      : left <= 30
        ? { detail: left === 0 ? 'today' : `in ${left} days`, tone: 'warn' as const }
        : {}),
  };
}

/** An identity part or fact value naming a record by its label, linked. */
export const named = (
  record: RecordEnvelope | undefined,
  fallback = 'missing record',
): OverviewPart =>
  record ? { text: record.label || record.name, record: record.id } : { text: fallback };

/** "1 lot", "3 lots". */
export const count = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** Leaves out parts with no text, so a builder can list optional ones inline. */
export const parts = (...list: (OverviewPart | string | false | 0 | undefined)[]): OverviewPart[] =>
  list.flatMap((p) => (!p ? [] : typeof p === 'string' ? [{ text: p }] : p.text ? [p] : []));

/** Leaves out facts that aren't there. */
export const facts = (...list: (OverviewFact | false | 0 | '' | undefined)[]): OverviewFact[] =>
  list.filter((f): f is OverviewFact => !!f);

// ---------------------------------------------------------------------------------------------

/**
 * For kinds without a builder yet: the kind and its one-line summary, then the record's simple
 * top-level values in the order the record holds them.
 */
export function fallbackOverview(record: RecordEnvelope, noun: string): RecordOverview {
  const simple: OverviewFact[] = [];
  for (const [key, value] of Object.entries(record.attributes)) {
    if (simple.length >= 6) break;
    const text = simpleValue(value);
    if (text === undefined || key === 'notes' || key === 'description') continue;
    simple.push({
      label: words(key.replace(/([a-z])([A-Z])/g, '$1 $2')).toLowerCase(),
      value: text,
      field: key,
    });
  }
  return { identity: parts(capital(noun), record.summary), facts: simple };
}

function simpleValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    // IDs of other records and long text are left to the full record.
    if (/^[a-z]{2,4}_[0-9A-Z]{26}$/.test(value) || value.length > 120) return undefined;
    return /^[a-z]+(_[a-z]+)+$/.test(value) ? words(value) : value;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'unit' in value &&
    Object.keys(value).length === 2
  ) {
    return amount(value as Quantity);
  }
  return undefined;
}

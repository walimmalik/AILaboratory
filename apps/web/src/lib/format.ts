import { formatQuantity, isUnit } from '@ailab/domain';
import {
  type ActivityEntry,
  type Actor,
  type Me,
  operationContracts,
  type Proposal,
  type Quantity,
} from '@ailab/schema';

/** Reads, which the assistant's steps show in muted ink. */
const isRead = (operationId: string) => operationContracts.get(operationId)?.effect === 'read';

/** "edited" (what happened). */
export function operationVerb(operationId: string): string {
  return operationContracts.get(operationId)?.verbs.done ?? 'did something';
}

/** "edit" (what someone wants to do). */
export function operationIntent(operationId: string): string {
  return operationContracts.get(operationId)?.verbs.intent ?? 'do something';
}

/** "you", "Claude for you", "DeepSeek for Wali"… */
export function actorLabel(actor: Actor, me: Me | undefined): string {
  const person = (userId: string) => (me && userId === me.user.id ? 'you' : 'a lab member');
  return actor.type === 'user'
    ? person(actor.userId)
    : `${actor.agentName} for ${person(actor.onBehalfOf)}`;
}

export function isAgent(actor: Actor): boolean {
  return actor.type === 'agent';
}

/** A ledger entry as one sentence fragment: what happened to which records. */
export function describeEntry(entry: ActivityEntry): string {
  const names = entry.recordIds.map((id) => entry.recordNames[id] ?? 'a record');
  const label = (entry.input as { label?: unknown } | undefined)?.label;
  if (names.length === 0 && typeof label === 'string' && label) names.push(`“${label}”`);
  const what = operationVerb(entry.operationId);
  if (entry.operationId.startsWith('proposals.'))
    return names.length ? `${what} to ${names.join(', ')}` : what;
  return names.length ? `${what} ${names.join(', ')}` : what;
}

const outcomeWords: Record<ActivityEntry['outcome'], string> = {
  succeeded: 'done',
  failed: 'failed',
  proposed: 'waiting for you',
  approved: 'confirmed',
  rejected: 'rejected',
};

export function outcomeLabel(outcome: ActivityEntry['outcome']): string {
  return outcomeWords[outcome];
}

export function outcomeTone(outcome: ActivityEntry['outcome']): string {
  return outcome === 'failed'
    ? 'crit-ink'
    : outcome === 'proposed'
      ? 'agent-ink'
      : outcome === 'rejected'
        ? 'muted'
        : 'ok-ink';
}

export function isQuantity(value: unknown): value is Quantity {
  if (!value || typeof value !== 'object') return false;
  const { value: v, unit } = value as Record<string, unknown>;
  return typeof v === 'string' && typeof unit === 'string' && Object.keys(value).length === 2;
}

/** A field value for people: quantities with their unit symbol, lists joined, objects as compact JSON. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (isQuantity(value))
    return isUnit(value.unit) ? formatQuantity(value) : `${value.value} ${value.unit}`;
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') {
    // Nested attributes (a footprint, a well layout) read as "name value · name value".
    return Object.entries(value)
      .map(([key, inner]) => {
        const text = formatValue(inner);
        return typeof inner === 'object' &&
          inner !== null &&
          !isQuantity(inner) &&
          !Array.isArray(inner)
          ? `${fieldWords(key)} (${text})`
          : `${fieldWords(key)} ${text}`;
      })
      .join(' · ');
  }
  return String(value);
}

/** An attribute name in words: "maxVolume" → "max volume", "a1" stays "a1". */
function fieldWords(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** "18:42:07" today, "Sep 28 18:42" otherwise, in the reader's time zone. */
export function formatWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? at.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : at.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

export interface FieldChange {
  /** Unique within one diff: a record's own status and an attribute named status both show. */
  key: string;
  field: string;
  before: unknown;
  after: unknown;
}

interface RecordLike {
  label?: unknown;
  status?: unknown;
  attributes?: Record<string, unknown>;
}

/** The fields that differ between two versions of a record (label, status and each attribute). */
export function diffRecords(
  before: RecordLike | undefined,
  after: RecordLike | undefined,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const field of ['label', 'status'] as const) {
    if (!same(before?.[field], after?.[field]))
      changes.push({ key: field, field, before: before?.[field], after: after?.[field] });
  }
  const keys = new Set([
    ...Object.keys(before?.attributes ?? {}),
    ...Object.keys(after?.attributes ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const a = before?.attributes?.[key];
    const b = after?.attributes?.[key];
    if (!same(a, b)) changes.push({ key: `attributes.${key}`, field: key, before: a, after: b });
  }
  return changes;
}

export interface ToolLine {
  text: string;
  tone: 'ok-ink' | 'agent-ink' | 'crit-ink' | 'muted';
  /** The record the step produced or read, when there is one. */
  record?: { id: string; name: string };
  /** True when the step waits for a person on the Review page. */
  proposed?: boolean;
}

/** A record envelope's id and name, if `value` is one. */
function recordOf(value: unknown): { id: string; name: string } | undefined {
  const { id, name } = (value ?? {}) as { id?: unknown; name?: unknown };
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : undefined;
}

/**
 * The records an output holds, main one first: the output itself, or records one level in, as
 * `{product, drafted: [...]}` or `{containers: [...]}` return them.
 */
function recordsIn(value: unknown): { record: { id: string; name: string }; envelope: unknown }[] {
  const own = recordOf(value);
  if (own) return [{ record: own, envelope: value }];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap((v) =>
    (Array.isArray(v) ? v : [v]).flatMap((e) => {
      const record = recordOf(e);
      return record ? [{ record, envelope: e }] : [];
    }),
  );
}

/** One step the assistant took (an operation it ran), as a line for people. */
export function describeToolStep(step: {
  operationId: string;
  outcome: 'done' | 'preview' | 'proposed' | 'failed';
  result: unknown;
  error?: { message: string } | undefined;
}): ToolLine {
  const result = (step.result ?? {}) as { output?: unknown; proposal?: { preview?: unknown } };
  if (step.outcome === 'failed') {
    return {
      text: `could not ${operationIntent(step.operationId)}: ${step.error?.message ?? 'refused'}`,
      tone: 'crit-ink',
    };
  }
  if (step.outcome === 'proposed') {
    const record = recordsIn(result.proposal?.preview)[0]?.record;
    return {
      text: `proposed to ${operationIntent(step.operationId)}${record ? ` ${record.name}` : ''}; waits for your review`,
      tone: 'agent-ink',
      proposed: true,
      ...(record ? { record } : {}),
    };
  }
  const record = recordsIn(result.output)[0]?.record;
  const verb = operationVerb(step.operationId);
  return {
    text: step.outcome === 'preview' ? `previewed: ${verb}` : verb,
    tone: record && !isRead(step.operationId) ? 'ok-ink' : 'muted',
    ...(record ? { record } : {}),
  };
}

/** What a turn of the assistant's work leaves for the person: drafts to confirm, changes proposed. */
export interface WaitingForYou {
  drafts: { id: string; name: string }[];
  /** Ids of the proposals the turn made. */
  changes: string[];
}

/**
 * Reads a turn's steps (in order) for what now waits on the person (plan 004d, R4): records whose
 * latest state the turn saw is a draft it wrote, and changes it proposed.
 */
export function waitingForYou(
  steps: {
    operationId: string;
    outcome: 'done' | 'preview' | 'proposed' | 'failed';
    result: unknown;
  }[],
): WaitingForYou {
  const drafts = new Map<string, { id: string; name: string } | undefined>();
  const changes: string[] = [];
  for (const step of steps) {
    const proposal = (step.result as { proposal?: { id?: unknown } } | undefined)?.proposal;
    if (step.outcome === 'proposed' && typeof proposal?.id === 'string') changes.push(proposal.id);
    if (step.outcome !== 'done' || isRead(step.operationId)) continue;
    const output = (step.result as { output?: unknown } | undefined)?.output;
    for (const { record, envelope } of recordsIn(output)) {
      const { status } = envelope as { status?: unknown };
      drafts.delete(record.id);
      drafts.set(record.id, status === 'draft' ? record : undefined);
    }
  }
  return { drafts: [...drafts.values()].filter((d) => d !== undefined), changes };
}

/**
 * Folds runs of the same failure (the same operation failing for the same reason, one after the
 * other) into their newest line with the others counted, so 18 documents that can't be read yet
 * are one line, not 18 red ones.
 */
export function foldRepeats(entries: readonly ActivityEntry[]) {
  const lines: { entry: ActivityEntry; more: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const last = lines.at(-1);
    if (
      last &&
      entry.outcome === 'failed' &&
      last.entry.outcome === 'failed' &&
      last.entry.operationId === entry.operationId &&
      last.entry.error?.message === entry.error?.message
    ) {
      last.more.push(entry);
    } else {
      lines.push({ entry, more: [] });
    }
  }
  return lines;
}

/** "partOf" → "part of", "dead_volume" → "dead volume". */
export function fieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

/** A readiness path in words: "volume" → "volume", "/steps/wash" → "step wash" (ADR 0049). */
export function pathLabel(path: string): string {
  if (!path.startsWith('/')) return fieldLabel(path);
  const [list = '', ...rest] = path
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (rest.length === 0) return fieldLabel(list);
  const one = list.endsWith('ies') ? `${list.slice(0, -3)}y` : list.replace(/s$/, '');
  const [key, ...inside] = rest;
  return [fieldLabel(one), key, ...inside.map(fieldLabel)].join(' ');
}

/** The item of a keyed list with this key, and where it sits (ADR 0049). */
function findItem(
  list: unknown,
  key: string,
  keyField: string | undefined,
): { item: Record<string, unknown>; position: number } | undefined {
  if (!Array.isArray(list)) return undefined;
  const fields = keyField ? [keyField] : ['id', 'name', 'role', 'key'];
  const position = list.findIndex(
    (i) =>
      i && typeof i === 'object' && fields.some((f) => (i as Record<string, unknown>)[f] === key),
  );
  return position < 0 ? undefined : { item: list[position], position };
}

/** What an item is called in the lab: its label, title or name, before its technical key. */
export function itemName(item: Record<string, unknown>): string | undefined {
  for (const field of ['label', 'title', 'name', 'role', 'id']) {
    const v = item[field];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/**
 * A readiness or diff path named the way the record names it (UI rule 9): "/steps/s2" → "step 2
 * Wash", "/variables/wash_volume" → "Wash volume", "/steps/s2/text" → "step 2 Wash · text". Without
 * the item in hand it falls back to the technical key.
 */
export function partLabel(
  path: string,
  attributes: Record<string, unknown> | undefined,
  items: Readonly<Record<string, string>> = {},
  fallback?: Record<string, unknown>,
): string {
  if (!path.startsWith('/')) return fieldLabel(path);
  const [list = '', key, ...inside] = path
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (key === undefined) return fieldLabel(list);
  const found =
    findItem(attributes?.[list], key, items[list]) ?? findItem(fallback?.[list], key, items[list]);
  if (!found) return pathLabel(path);
  const name = itemName(found.item) ?? key;
  const head = list === 'steps' ? `step ${found.position + 1} ${name}` : name;
  return [head, ...inside.map(fieldLabel)].join(' · ');
}

/** Whether a proposed change would change this record, alone or as a step of a change set (ADR 0051). */
export function proposalTouches(proposal: Pick<Proposal, 'operationId' | 'input'>, id: string) {
  const idOf = (input: unknown) => (input as { id?: unknown } | undefined)?.id;
  if (proposal.operationId !== 'changes.apply') return idOf(proposal.input) === id;
  const steps = (proposal.input as { steps?: { input?: unknown }[] } | undefined)?.steps ?? [];
  return steps.some((step) => idOf(step.input) === id);
}

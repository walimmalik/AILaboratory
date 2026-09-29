import { formatQuantity, isUnit } from '@ailab/domain';
import type { ActivityEntry, Actor, Me, Quantity } from '@ailab/schema';

/** What an operation does, in plain words (product rule 9): [past tense, base form]. */
const verbs: Record<string, [string, string]> = {
  'records.create': ['created', 'create'],
  'records.update': ['edited', 'edit'],
  'records.activate': ['activated', 'activate'],
  'records.archive': ['archived', 'archive'],
  'records.unarchive': ['unarchived', 'unarchive'],
  'records.restore': ['restored an earlier version of', 'restore an earlier version of'],
  'records.delete_draft': ['deleted the draft', 'delete the draft'],
  'proposals.approve': ['approved a proposed change', 'approve a proposed change'],
  'proposals.reject': ['rejected a proposed change', 'reject a proposed change'],
};

/** "edited" (what happened). */
export function operationVerb(operationId: string): string {
  return verbs[operationId]?.[0] ?? operationId;
}

/** "edit" (what someone wants to do). */
export function operationIntent(operationId: string): string {
  return verbs[operationId]?.[1] ?? operationId;
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
  proposed: 'waiting for review',
  approved: 'approved',
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
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
      changes.push({ field, before: before?.[field], after: after?.[field] });
  }
  const keys = new Set([
    ...Object.keys(before?.attributes ?? {}),
    ...Object.keys(after?.attributes ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const a = before?.attributes?.[key];
    const b = after?.attributes?.[key];
    if (!same(a, b)) changes.push({ field: key, before: a, after: b });
  }
  return changes;
}

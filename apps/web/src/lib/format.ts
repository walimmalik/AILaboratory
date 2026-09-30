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
  'records.confirm_section': ['confirmed a section of', 'confirm a section of'],
  'proposals.approve': ['confirmed a proposed change', 'confirm a proposed change'],
  'proposals.reject': ['rejected a proposed change', 'reject a proposed change'],
  'assistant.ask': ['asked the assistant', 'ask the assistant'],
  // Reads, as the assistant's steps show them.
  'records.get': ['looked at', 'look at'],
  'records.list': ['looked up records', 'look up records'],
  'records.kinds': ['checked which record kinds exist', 'check which record kinds exist'],
  'records.history': ['read the history of', 'read the history of'],
  'records.links': ['looked at the links of', 'look at the links of'],
  'records.readiness': ['checked what still needs review on', 'check what still needs review on'],
  'proposals.list': ['looked at the proposals', 'look at the proposals'],
  'review.list': ['looked at what is waiting for you', 'look at what is waiting for you'],
  'activity.list': ['read the activity ledger', 'read the activity ledger'],
};

const reads = new Set([
  'records.get',
  'records.list',
  'records.kinds',
  'records.history',
  'records.links',
  'records.readiness',
  'proposals.list',
  'review.list',
  'activity.list',
]);

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
    const record = recordOf(result.proposal?.preview);
    return {
      text: `proposed to ${operationIntent(step.operationId)}${record ? ` ${record.name}` : ''}; waits for your review`,
      tone: 'agent-ink',
      proposed: true,
      ...(record ? { record } : {}),
    };
  }
  const record = recordOf(result.output);
  const verb = operationVerb(step.operationId);
  return {
    text: step.outcome === 'preview' ? `previewed: ${verb}` : verb,
    tone: record && !reads.has(step.operationId) ? 'ok-ink' : 'muted',
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
    if (step.outcome !== 'done' || reads.has(step.operationId)) continue;
    const output = (step.result as { output?: unknown } | undefined)?.output;
    const record = recordOf(output);
    if (!record) continue;
    const { status } = output as { status?: unknown };
    drafts.delete(record.id);
    drafts.set(record.id, status === 'draft' ? record : undefined);
  }
  return { drafts: [...drafts.values()].filter((d) => d !== undefined), changes };
}

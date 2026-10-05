import type { ValueChange } from '@ailab/domain';
import {
  type InventoryEvent,
  type RecordEnvelope,
  type RecordVersion,
  ScientificQuestion,
} from '@ailab/schema';
import {
  fieldLabel,
  formatValue,
  isQuantity,
  operationVerb,
  partLabel,
  verbAlone,
} from './format.ts';

export type HistoryEntry =
  | { key: string; at: string; type: 'version'; version: RecordVersion }
  | { key: string; at: string; type: 'inventory'; event: InventoryEvent };

/** Persisted events only, oldest first. Equal timestamps have a stable, version-aware order. */
export function historyEntries(
  versions: RecordVersion[],
  ledger: InventoryEvent[],
): HistoryEntry[] {
  return [
    ...versions.map(
      (version): HistoryEntry => ({
        key: `v${version.version}`,
        at: version.at,
        type: 'version',
        version,
      }),
    ),
    ...ledger.map(
      (event): HistoryEntry => ({
        key: event.id,
        at: event.at,
        type: 'inventory',
        event,
      }),
    ),
  ].sort((a, b) => {
    const time = Date.parse(a.at) - Date.parse(b.at);
    if (time) return time;
    if (a.type === 'version' && b.type === 'version') return a.version.version - b.version.version;
    if (a.type !== b.type) return a.type === 'version' ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

/** A recent window in chronological order; an exact linked entry is always included. */
export function historyWindow(entries: HistoryEntry[], count: number, selected?: string) {
  const index = selected ? entries.findIndex((e) => e.key === selected) : -1;
  const start = Math.min(Math.max(0, entries.length - count), index < 0 ? entries.length : index);
  return { shown: entries.slice(start), earlier: start };
}

export const historyEntrySearch = (entry: string) => ({ tab: 'history', entry });

export const historyExcerpt = (text: string, limit = 160) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

/** Familiar labware terms; other labels keep the shared keyed-item vocabulary. */
export function historyChangeLabel(
  path: string,
  current: RecordEnvelope,
  items: Readonly<Record<string, string>>,
  previous?: RecordEnvelope,
) {
  if (current.kind === 'sop' && (path === '/questions' || path.startsWith('/questions/')))
    return 'Scientific questions';
  const known: Record<string, string> = {
    '/workingVolume/max': 'Maximum working volume',
    '/workingVolume/min': 'Minimum working volume',
    '/maxVolume': 'Maximum volume',
  };
  return known[path] ?? partLabel(path, current.attributes, items, previous?.attributes);
}

/** A small exact scalar/quantity comparison, never a summary invented from structured payloads. */
export function historyChangePreview(
  changes: ValueChange[],
  labels: Record<string, string>,
): string {
  const scalar = (value: unknown) =>
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && !/\b[a-z]{2,5}_[0-9A-HJKMNP-TV-Z]{26}\b/.test(value)) ||
    isQuantity(value);
  const values = changes.filter(
    (change) =>
      scalar(change.before) && scalar(change.after) && !change.path.startsWith('/questions'),
  );
  return values
    .slice(0, 2)
    .map((change) => {
      const label = labels[change.path] ?? 'Value';
      const was = historyExcerpt(formatValue(change.before), 70);
      const now = historyExcerpt(formatValue(change.after), 70);
      return change.change === 'added'
        ? `${label}: added ${now}`
        : change.change === 'removed'
          ? `${label}: removed ${was}`
          : `${label}: ${was} → ${now}`;
    })
    .join(' · ');
}

/** Semantic comparison requires the current question contract; stored snapshots remain untouched. */
export function compareHistoryQuestions(
  previous: RecordEnvelope | undefined,
  current: RecordEnvelope,
) {
  const beforeResult = ScientificQuestion.array().safeParse(
    previous?.attributes.questions === undefined ? [] : previous.attributes.questions,
  );
  const afterResult = ScientificQuestion.array().safeParse(
    current.attributes.questions === undefined ? [] : current.attributes.questions,
  );
  if (!beforeResult.success || !afterResult.success) return { available: false, changes: [] };
  const before = beforeResult.data;
  const after = afterResult.data;
  const ids = new Set([...before, ...after].map((question) => question.id));
  const changes = [...ids].flatMap((id) => {
    const was = before.find((question) => question.id === id);
    const now = after.find((question) => question.id === id);
    return JSON.stringify(was) === JSON.stringify(now) ? [] : [{ id, before: was, after: now }];
  });
  return { available: true, changes };
}

/** Reviews actually added or refreshed in this snapshot, without implying proposal approval. */
export function versionReviews(previous: RecordEnvelope | undefined, current: RecordEnvelope) {
  return Object.entries(current.reviews).filter(
    ([id, review]) => JSON.stringify(previous?.reviews[id]) !== JSON.stringify(review),
  );
}

const shortList = (names: string[]) => {
  const unique = [...new Set(names)];
  return `${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ` and ${unique.length - 3} more` : ''}`;
};

/** Short factual labels; rationale and full changes belong in the expanded entry. */
export function versionSummary(
  version: RecordVersion,
  previous: RecordEnvelope | undefined,
  changed: string[],
): string {
  if (version.operation === 'create')
    return version.snapshot.status === 'draft' ? 'created a draft' : 'created the record';
  if (version.operation === 'confirm_section') {
    const parts = versionReviews(previous, version.snapshot).map(([id]) => fieldLabel(id));
    if (version.snapshot.status === 'draft')
      return `reviewed ${parts.length} ${parts.length === 1 ? 'section' : 'sections'} · draft remains`;
    return `confirmed${parts.length ? ` ${shortList(parts)}` : ''}${
      previous?.status === 'draft' && version.snapshot.status === 'active' ? ' and activated' : ''
    }`;
  }
  const words = {
    update: 'edited',
    activate: 'confirmed and activated',
    archive: 'archived',
    unarchive: 'unarchived',
    restore: 'restored an earlier version',
  };
  const verb =
    version.via && !version.via.startsWith('records.')
      ? verbAlone(operationVerb(version.via))
      : words[version.operation];
  if (version.via === 'sops.answer_question') return verb;
  return `${verb}${changed.length ? ` · ${shortList(changed)}` : ''}`;
}

const eventWords: Record<InventoryEvent['type'], string> = {
  fill: 'filled',
  transfer: 'transferred',
  stamp: 'stamped',
  consume: 'used',
  correct: 'corrected',
  discard: 'discarded',
};

export function inventorySummary(event: InventoryEvent, container: string): string {
  const wells = new Set(
    event.lines.filter((line) => line.container === container).map((l) => l.well),
  );
  return `${eventWords[event.type]} ${wells.size} ${wells.size === 1 ? 'well' : 'wells'}`;
}

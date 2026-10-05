import type { InventoryEvent, RecordEnvelope, RecordVersion } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { itemChanges } from '../pages/ItemDiff.tsx';
import { partLabel } from './format.ts';
import {
  changedQuestions,
  historyChangeLabel,
  historyChangePreview,
  historyEntries,
  historyEntrySearch,
  historyWindow,
  inventorySummary,
  versionReviews,
  versionSummary,
} from './history.ts';

const person = { type: 'user', userId: 'usr_01J00000000000000000000000' } as const;
const agent = { type: 'agent', agentName: 'Assistant', onBehalfOf: person.userId } as const;
const at = '2026-10-05T09:00:00Z';
const record: RecordEnvelope = {
  id: 'sop_01J00000000000000000000000',
  kind: 'sop',
  name: 'SOP-0001',
  label: 'Wash',
  orgId: 'org_01J00000000000000000000000',
  labId: 'lab_01J00000000000000000000000',
  status: 'draft',
  version: 1,
  attributes: {},
  evidence: {},
  reviews: {},
  createdAt: at,
  updatedAt: at,
  createdBy: agent,
  updatedBy: agent,
};
const version = (n: number, attributes = {}): RecordVersion => ({
  recordId: record.id,
  version: n,
  operation: n === 1 ? 'create' : 'update',
  actor: agent,
  at,
  snapshot: { ...record, version: n, attributes },
});
const container = 'lw_01J00000000000000000000000';
const event: InventoryEvent = {
  id: 'iev_01J00000000000000000000000',
  type: 'transfer',
  at,
  actor: person,
  operationId: 'inventory.transfer',
  lines: [
    {
      container,
      well: 'A1',
      change: 'in',
      volume: { value: '50', unit: 'uL' },
      after: {
        components: [],
        volume: { value: '50', unit: 'uL' },
        assumed: false,
      },
    },
  ],
};

describe('record History timeline', () => {
  it('previews exact quantities and short note excerpts, keeping structured technical payloads out', () => {
    const path = '/workingVolume/max';
    const label = historyChangeLabel(path, { ...record, kind: 'labware_type' }, {});
    expect(label).toBe('Maximum working volume');
    expect(
      historyChangePreview(
        [
          {
            path,
            change: 'changed',
            before: { value: '300', unit: 'uL' },
            after: { value: '320', unit: 'uL' },
          },
        ],
        { [path]: label },
      ),
    ).toBe('Maximum working volume: 300 µL → 320 µL');
    expect(
      historyChangePreview(
        [
          {
            path: '/notes',
            change: 'changed',
            before: 'Old\nnotes',
            after: 'Use the new wash protocol',
          },
        ],
        { '/notes': 'Notes' },
      ),
    ).toBe('Notes: Old notes → Use the new wash protocol');
    expect(
      historyChangePreview(
        [{ path: '/owner', change: 'changed', before: person.userId, after: person.userId }],
        {},
      ),
    ).toBe('');
  });
  it('orders persisted versions and inventory events chronologically, with stable timestamp ties', () => {
    const earlier = { ...version(1), at: '2026-10-04T09:00:00Z' };
    const entries = historyEntries([version(10), earlier, version(2)], [event]);
    expect(entries.map((e) => e.key)).toEqual(['v1', 'v2', 'v10', event.id]);
    expect(historyEntries([version(2), earlier, version(10)], [event])).toEqual(entries);
    // Same actor or timestamp does not imply one request or permit event grouping.
    expect(entries).toHaveLength(4);
  });

  it('shows a recent window, expands to an older exact entry, and handles empty/unknown links', () => {
    const entries = historyEntries(
      Array.from({ length: 70 }, (_, i) => version(i + 1)),
      [],
    );
    expect(historyWindow(entries, 30).shown[0]?.key).toBe('v41');
    expect(historyWindow(entries, 60).shown[0]?.key).toBe('v11');
    expect(historyWindow(entries, 30, 'v5').shown[0]?.key).toBe('v5');
    expect(historyWindow(entries, 30, 'v999').earlier).toBe(40);
    expect(historyWindow([], 30)).toEqual({ shown: [], earlier: 0 });
    expect(historyEntrySearch('v5')).toEqual({ tab: 'history', entry: 'v5' });
    expect(historyEntrySearch(event.id)).toEqual({ tab: 'history', entry: event.id });
  });

  it('summarizes an exact keyed-item edit and keeps large edits concise', () => {
    const before = version(1, {
      variables: [{ id: 'wash', label: 'Wash volume', value: { value: '50', unit: 'uL' } }],
    });
    const after = version(2, {
      variables: [{ id: 'wash', label: 'Wash volume', value: { value: '75', unit: 'uL' } }],
    });
    const changes = itemChanges(before.snapshot, after.snapshot, { variables: 'id' });
    expect(changes).toEqual([
      {
        path: '/variables/wash/value',
        change: 'changed',
        before: { value: '50', unit: 'uL' },
        after: { value: '75', unit: 'uL' },
      },
    ]);
    const labels = changes.map((c) =>
      partLabel(c.path, after.snapshot.attributes, { variables: 'id' }, before.snapshot.attributes),
    );
    expect(versionSummary(after, before.snapshot, labels)).toContain('Wash volume');
    expect(versionSummary(after, before.snapshot, ['one', 'two', 'three', 'four', 'five'])).toBe(
      'edited · one, two, three and 2 more',
    );
    expect(versionSummary(before, undefined, labels)).toBe('created a draft');
  });

  it('attributes actual confirmations separately from the agent who wrote the version', () => {
    const before = version(2);
    const review = { confirmedBy: person, confirmedAt: at, version: 3, values: {} };
    const after = {
      ...version(3),
      operation: 'confirm_section',
      snapshot: { ...record, version: 3, status: 'active', reviews: { method: review } },
    } as RecordVersion;
    expect(versionSummary(after, before.snapshot, [])).toBe('confirmed method and activated');
    expect(versionReviews(before.snapshot, after.snapshot)).toEqual([['method', review]]);
    expect(versionReviews(after.snapshot, after.snapshot)).toEqual([]);
    expect(
      versionSummary(
        { ...after, snapshot: { ...after.snapshot, status: 'draft' } },
        before.snapshot,
        [],
      ),
    ).toBe('reviewed 1 section · draft remains');
    expect(after.actor).toEqual(agent);
    expect(
      versionSummary(
        { ...after, operation: 'restore', via: 'records.restore' },
        before.snapshot,
        [],
      ),
    ).toBe('restored an earlier version');
  });

  it('uses scientific wording and real responses without technical question IDs in the summary', () => {
    const question = {
      id: 'wash_volume_conflict',
      question: 'Which wash volume should we use?',
      stage: { stage: 'method', reason: 'Conflicting sources' },
      disposition: { status: 'open' },
      responses: [],
    };
    const before = version(1, { questions: [question] });
    const response = { text: 'I do not know yet', by: person, at, version: 2 };
    const after = {
      ...version(2, { questions: [{ ...question, responses: [response] }] }),
      via: 'sops.answer_question',
      actor: person,
    };
    expect(versionSummary(after, before.snapshot, ['wash_volume_conflict · responses'])).toBe(
      'answered a question',
    );
    expect(changedQuestions(before.snapshot, after.snapshot)).toMatchObject([
      {
        id: question.id,
        before: { question: question.question, responses: [] },
        after: { question: question.question, responses: [response] },
      },
    ]);
    expect(changedQuestions(after.snapshot, after.snapshot)).toEqual([]);
  });

  it('counts only unique wells in this container and preserves actual inventory facts', () => {
    const other = { ...event.lines[0], container: 'lw_01J00000000000000000000001', well: 'B1' };
    const transfer = { ...event, lines: [...event.lines, ...event.lines, other] } as InventoryEvent;
    expect(inventorySummary(transfer, container)).toBe('transferred 1 well');
    expect(historyEntries([], [transfer])[0]).toMatchObject({ type: 'inventory', event: transfer });
  });
});

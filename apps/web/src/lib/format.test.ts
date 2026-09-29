import type { ActivityEntry, Me } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  describeEntry,
  describeToolStep,
  diffRecords,
  formatValue,
  waitingForYou,
} from './format.ts';

const me = { user: { id: 'usr_A' } } as unknown as Me;

describe('plain language', () => {
  it('names people and agents from the reader’s point of view', () => {
    expect(actorLabel({ type: 'user', userId: 'usr_A' }, me)).toBe('you');
    expect(actorLabel({ type: 'agent', agentName: 'Claude', onBehalfOf: 'usr_A' }, me)).toBe(
      'Claude for you',
    );
    expect(actorLabel({ type: 'user', userId: 'usr_B' }, me)).toBe('a lab member');
  });

  it('describes ledger entries with record names', () => {
    const entry = {
      operationId: 'records.archive',
      recordIds: ['wdg_1'],
      recordNames: { wdg_1: 'WDG-0001' },
    } as unknown as ActivityEntry;
    expect(describeEntry(entry)).toBe('archived WDG-0001');
    expect(describeEntry({ ...entry, operationId: 'records.frobnicate' })).toBe(
      'records.frobnicate WDG-0001',
    );
  });

  it('formats quantities with unit symbols', () => {
    expect(formatValue({ value: '50', unit: 'uL' })).toBe('50 µL');
    expect(formatValue({ value: '3', unit: 'furlongs' })).toBe('3 furlongs');
    expect(formatValue(undefined)).toBe('—');
  });
});

describe('diffRecords', () => {
  it('lists only what changed, attributes included', () => {
    const before = {
      label: 'Tip box',
      status: 'active',
      attributes: { color: 'teal', volume: { value: '50', unit: 'uL' } },
    };
    const after = {
      label: 'Tip box',
      status: 'archived',
      attributes: { color: 'red', volume: { value: '50', unit: 'uL' } },
    };
    expect(diffRecords(before, after)).toEqual([
      { field: 'status', before: 'active', after: 'archived' },
      { field: 'color', before: 'teal', after: 'red' },
    ]);
  });

  it('treats a new record as all new fields', () => {
    expect(
      diffRecords(undefined, { label: 'X', status: 'draft', attributes: { a: 1 } }).map(
        (c) => c.field,
      ),
    ).toEqual(['label', 'status', 'a']);
  });
});

describe('describeToolStep', () => {
  it('names the record a step made, and marks proposals and failures', () => {
    expect(
      describeToolStep({
        operationId: 'records.create',
        outcome: 'done',
        result: { status: 'done', output: { id: 'wdg_1', name: 'WDG-0001' } },
      }),
    ).toEqual({ text: 'created', tone: 'ok-ink', record: { id: 'wdg_1', name: 'WDG-0001' } });
    expect(
      describeToolStep({
        operationId: 'records.update',
        outcome: 'proposed',
        result: { status: 'proposed', proposal: { preview: { id: 'wdg_1', name: 'WDG-0001' } } },
      }),
    ).toMatchObject({
      text: 'proposed to edit WDG-0001; waits for your review',
      tone: 'agent-ink',
      proposed: true,
    });
    expect(
      describeToolStep({
        operationId: 'records.create',
        outcome: 'failed',
        result: {},
        error: { message: 'color is required' },
      }),
    ).toEqual({ text: 'could not create: color is required', tone: 'crit-ink' });
    expect(
      describeToolStep({
        operationId: 'records.list',
        outcome: 'done',
        result: { output: { records: [] } },
      }),
    ).toEqual({ text: 'looked up records', tone: 'muted' });
  });
});

describe('waitingForYou', () => {
  const done = (operationId: string, output: unknown) =>
    ({ operationId, outcome: 'done', result: { status: 'done', output } }) as const;

  it('lists drafts the turn wrote and counts changes it proposed', () => {
    expect(
      waitingForYou([
        done('records.create', { id: 'wdg_1', name: 'WDG-0001', status: 'draft' }),
        done('records.create', { id: 'wdg_2', name: 'WDG-0002', status: 'draft' }),
        done('records.update', { id: 'wdg_1', name: 'WDG-0001', status: 'draft' }),
        {
          operationId: 'records.update',
          outcome: 'proposed',
          result: { status: 'proposed', proposal: { id: 'prp_1' } },
        },
        done('records.get', { id: 'wdg_9', name: 'WDG-0009', status: 'draft' }),
      ]),
    ).toEqual({
      drafts: [
        { id: 'wdg_2', name: 'WDG-0002' },
        { id: 'wdg_1', name: 'WDG-0001' },
      ],
      changes: ['prp_1'],
    });
  });

  it('leaves nothing when the turn only read or failed', () => {
    expect(
      waitingForYou([
        done('records.list', { items: [] }),
        { operationId: 'records.update', outcome: 'failed', result: undefined },
      ]),
    ).toEqual({ drafts: [], changes: [] });
  });
});

import type { ActivityEntry, Me } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { actorLabel, describeEntry, describeToolStep, diffRecords, formatValue } from './format.ts';

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

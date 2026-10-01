import type { ActivityEntry, Me } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  describeEntry,
  describeToolStep,
  diffRecords,
  foldRepeats,
  formatDay,
  formatValue,
  partLabel,
  plainError,
  problemWords,
  waitingForYou,
} from './format.ts';

const me = { user: { id: 'usr_A' } } as unknown as Me;

describe('plain language', () => {
  it('says a day without the year in the current year', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(formatDay('2026-10-01T09:00:00Z', now)).toBe('1 Oct');
    expect(formatDay('2025-03-31T09:00:00Z', now)).toBe('31 Mar 2025');
  });

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
    expect(describeEntry({ ...entry, operationId: 'transfers.draft_from_plate_map' })).toBe(
      'drafted a transfer plan from WDG-0001',
    );
    // An ID no contract has never reaches the screen.
    expect(describeEntry({ ...entry, operationId: 'records.frobnicate' })).toBe(
      'did something WDG-0001',
    );
  });

  it('formats quantities with unit symbols', () => {
    expect(formatValue({ value: '50', unit: 'uL' })).toBe('50 µL');
    expect(formatValue({ value: '3', unit: 'furlongs' })).toBe('3 furlongs');
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue(true)).toBe('yes');
    expect(
      formatValue({
        sbs: true,
        length: { value: '127.8', unit: 'mm' },
        topHeight: { value: '9', unit: 'mm' },
      }),
    ).toBe('sbs yes · length 127.8 mm · top height 9 mm');
    expect(formatValue({ layout: 'grid', well: { depth: { value: '5', unit: 'mm' } } })).toBe(
      'layout grid · well (depth 5 mm)',
    );
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
      { key: 'status', field: 'status', before: 'active', after: 'archived' },
      { key: 'attributes.color', field: 'color', before: 'teal', after: 'red' },
    ]);
  });

  it('keys a record status and an attribute named status apart', () => {
    const keys = diffRecords(undefined, {
      label: 'Lot',
      status: 'active',
      attributes: { status: 'unopened' },
    }).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
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

  it('finds drafts an operation returns inside its output', () => {
    expect(
      waitingForYou([
        done('reagents.draft_product', {
          product: { id: 'prd_1', name: 'PRD-0001', status: 'draft' },
          drafted: [{ id: 'prd_2', name: 'PRD-0002', status: 'draft' }],
        }),
      ]),
    ).toEqual({
      drafts: [
        { id: 'prd_1', name: 'PRD-0001' },
        { id: 'prd_2', name: 'PRD-0002' },
      ],
      changes: [],
    });
    expect(
      describeToolStep({
        operationId: 'inventory.register_containers',
        outcome: 'done',
        result: { output: { containers: [{ id: 'con_1', name: 'CON-0001' }] } },
      }).record,
    ).toEqual({ id: 'con_1', name: 'CON-0001' });
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

describe('foldRepeats', () => {
  const entry = (id: string, outcome: ActivityEntry['outcome'], message?: string) =>
    ({
      id,
      at: '2026-09-30T00:00:00.000Z',
      actor: { type: 'user', userId: 'usr_1' },
      operationId: 'library.parse',
      outcome,
      recordIds: [],
      recordNames: {},
      input: {},
      durationMs: 1,
      ...(message ? { error: { code: 'invalid_state', message } } : {}),
    }) as ActivityEntry;

  it('folds a run of the same failure and keeps everything else apart', () => {
    const lines = foldRepeats([
      entry('a', 'failed', 'needs Docling'),
      entry('b', 'failed', 'needs Docling'),
      entry('c', 'failed', 'needs Docling'),
      entry('d', 'failed', 'file is empty'),
      entry('e', 'succeeded'),
      entry('f', 'succeeded'),
    ]);
    expect(lines.map((l) => [l.entry.id, l.more.length])).toEqual([
      ['a', 2],
      ['d', 0],
      ['e', 0],
      ['f', 0],
    ]);
  });
});

describe('partLabel', () => {
  const attributes = {
    steps: [
      { id: 's1', title: 'Coat' },
      { id: 's2', title: 'Wash' },
    ],
    variables: [{ name: 'wash_volume', label: 'Wash volume' }],
  };
  const items = { steps: 'id', variables: 'name' };
  it('names parts the way the record names them', () => {
    expect(partLabel('/steps/s2', attributes, items)).toBe('step 2 Wash');
    expect(partLabel('/steps/s2/text', attributes, items)).toBe('step 2 Wash · text');
    expect(partLabel('/variables/wash_volume', attributes, items)).toBe('Wash volume');
    expect(partLabel('deadVolume', attributes, items)).toBe('dead volume');
  });
  it('finds a removed item on the other side, and falls back to the key', () => {
    expect(
      partLabel('/steps/s3', attributes, items, { steps: [{ id: 's3', title: 'Block' }] }),
    ).toBe('step 1 Block');
    expect(partLabel('/steps/s9', attributes, items)).toBe('step s9');
  });
});

describe('problemWords', () => {
  it('names what is wrong without restating the passing condition', () => {
    expect(
      problemWords({ label: 'Outer size is known', message: 'Length, width or height is missing' }),
    ).toBe('Outer size: length, width or height is missing');
    expect(problemWords({ label: 'Tip length is known', message: 'Not given' })).toBe(
      'Tip length: not given',
    );
    expect(problemWords({ label: 'Every volume fits its instrument', message: 'Too much' })).toBe(
      'Too much',
    );
  });
});

describe('plainError', () => {
  it('names the fields of input an operation does not take, without glyphs or the ID', () => {
    expect(plainError('Invalid input for inventory.where_is:\n✖ Invalid input\n  → at of')).toBe(
      'the request did not fit what it takes (of)',
    );
    expect(
      plainError('Invalid widget attributes:\n✖ Expected string, received number\n  → at color'),
    ).toBe('Invalid widget attributes: color: expected string, received number');
    expect(plainError('PLT-0001 is archived')).toBe('PLT-0001 is archived');
  });
});

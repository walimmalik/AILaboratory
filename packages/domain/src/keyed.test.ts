import type { Actor, RecordEnvelope } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { diffValues } from './diff.ts';
import { entriesByPath, evidenceKeyOf, keyedEntries, keyedItems, keyOf } from './keyed.ts';
import { readiness } from './readiness.ts';

const items = { steps: 'id', 'steps/parameters': 'name', overrides: 'plate+well' };
const steps = [
  {
    id: 'coat',
    text: 'Coat the plate',
    parameters: [
      { name: 'volume', value: '100 uL' },
      { name: 'time', value: '1 h' },
    ],
  },
  { id: 'wash', text: 'Wash', parameters: [] },
];

describe('keyed lists (ADR 0065)', () => {
  it('keys an item by one field or by several joined with +', () => {
    expect(keyOf({ id: 'coat' }, 'id')).toBe('coat');
    expect(keyOf({ plate: 'pm_1', well: 'A1' }, 'plate+well')).toBe('pm_1+A1');
    expect(keyOf({ plate: 'pm_1' }, 'plate+well')).toBeUndefined();
    expect([...keyedItems([{ id: 'a' }, { id: 'a', x: 1 }, {}], 'id').keys()]).toEqual(['a']);
  });

  it('lists nested items with their own paths, each compared without its keyed lists', () => {
    const entries = keyedEntries(steps, 'steps', items);
    expect(entries.map((e) => [e.path, e.key])).toEqual([
      ['/steps/coat', 'coat'],
      ['/steps/coat/parameters/volume', 'coat · volume'],
      ['/steps/coat/parameters/time', 'coat · time'],
      ['/steps/wash', 'wash'],
    ]);
    expect(entries[0]?.own).toEqual({ id: 'coat', text: 'Coat the plate' });
    expect([
      ...entriesByPath({ steps, overrides: [{ plate: 'p', well: 'B2' }] }, items).keys(),
    ]).toContain('/overrides/p+B2');
  });

  it('finds the evidence key of a value at any depth', () => {
    expect(evidenceKeyOf('/steps/coat/parameters/volume/value', items)).toBe(
      '/steps/coat/parameters/volume',
    );
    expect(evidenceKeyOf('/steps/coat/text', items)).toBe('/steps/coat');
    expect(evidenceKeyOf('/color', items)).toBe('color');
  });

  it('diffs nested keyed lists by key', () => {
    const after = structuredClone(steps);
    after[0]?.parameters.reverse();
    (after[0]?.parameters[0] as { value: string }).value = '2 h';
    expect(diffValues({ steps }, { steps: after }, items)).toEqual([
      { path: '/steps/coat/parameters/time/value', change: 'changed', before: '1 h', after: '2 h' },
    ]);
  });

  it('changing one parameter leaves its step and the other parameters confirmed', () => {
    const person = { type: 'user', userId: 'usr_01J9ZS4K8D6W3M5T7V9X1Y2Z3A' } as Actor;
    const at = '2026-10-01T12:00:00.000Z';
    const edited = structuredClone(steps);
    (edited[0]?.parameters[1] as { value: string }).value = '2 h';
    const record = {
      id: 'prt_01J9ZS4K8D6W3M5T7V9X1Y2Z3A',
      kind: 'protocol',
      name: 'PRT-0001',
      label: 'ELISA',
      status: 'draft',
      version: 2,
      attributes: { steps: edited },
      evidence: {},
      reviews: {
        steps: { confirmedBy: person, confirmedAt: at, version: 1, values: { steps } },
      },
    } as unknown as RecordEnvelope;
    const state = readiness(record, {
      sections: [{ id: 'steps', title: 'Steps', fields: ['steps'] }],
      items,
    });
    const field = state.sections[0]?.fields[0];
    expect(field?.items?.map((i) => [i.key, i.state])).toEqual([
      ['coat', 'confirmed'],
      ['coat · volume', 'confirmed'],
      ['coat · time', 'changed'],
      ['wash', 'confirmed'],
    ]);
    expect(field?.reordered).toBeUndefined();
  });
});

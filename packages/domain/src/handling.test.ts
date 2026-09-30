import type { HandlingRule, RuleOrigin } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { compactWells, mergeHandlingRules, mergeStorage, type SourcedRule } from './handling.ts';

const CELLS = 'smp_01M3QZX866A5SB53SPYV40HA9K';
const MEDIUM = 'lot_01M3QZX866A5SB53SPYV40HA9J';
const GLO = 'lot_01M3QZX866A5SB53SPYV40HA9H';

const kind: RuleOrigin = { id: 'enk_1', kind: 'entity_kind', name: 'ENK-0009', label: 'Cell line' };
const hek: RuleOrigin = { id: 'ent_1', kind: 'entity', name: 'CEL-0001', label: 'HEK293' };
const medium: RuleOrigin = { id: 'prd_1', kind: 'product', name: 'PRD-0001', label: 'DMEM' };
const glo: RuleOrigin = { id: 'prd_2', kind: 'product', name: 'PRD-0002', label: 'CellTiter-Glo' };

const minutes = (value: string) => ({ value, unit: 'min' as const });
const outOfIncubator = (value: string, from: 'lab_convention' | 'vendor' = 'lab_convention') =>
  ({
    rule: 'max_time_out_of_storage',
    text: `At most ${value} min out`,
    source: { from },
    enforced: true,
    period: minutes(value),
  }) as HandlingRule;
const light = (enforced: boolean): HandlingRule => ({
  rule: 'protect_from_light',
  text: 'Protect from light',
  source: { from: 'vendor' },
  enforced,
});
const sourced = (
  rule: HandlingRule,
  origin: RuleOrigin,
  via: string,
  wells: string[],
): SourcedRule => ({
  rule,
  origin,
  via,
  wells,
});

describe('compactWells', () => {
  it('stacks runs into blocks', () => {
    const wells: string[] = [];
    for (const r of 'ABCD') for (let c = 3; c <= 22; c++) wells.push(`${r}${c}`);
    expect(compactWells([...wells, 'A1', 'B1', 'C1'])).toEqual(['A1:C1', 'A3:D22']);
  });

  it('keeps a lone well as itself and folds repeats', () => {
    expect(compactWells(['A1', 'A1'])).toEqual(['A1']);
    expect(compactWells(['B2', 'B3', 'C2'])).toEqual(['B2:B3', 'C2']);
  });
});

describe('mergeHandlingRules', () => {
  it('keeps the shortest time limit and lists every source', () => {
    const [rule, ...rest] = mergeHandlingRules([
      sourced(outOfIncubator('30'), kind, CELLS, ['A1', 'A2']),
      sourced(outOfIncubator('15', 'vendor'), hek, CELLS, ['A1', 'A2']),
      sourced(outOfIncubator('60', 'vendor'), medium, MEDIUM, ['A1', 'A2', 'A3']),
    ]);
    expect(rest).toEqual([]);
    expect(rule?.rule).toMatchObject({ rule: 'max_time_out_of_storage', period: minutes('15') });
    expect(rule?.from.map((f) => [f.origin.label, f.wells])).toEqual([
      ['Cell line', ['A1:A2']],
      ['HEK293', ['A1:A2']],
      ['DMEM', ['A1:A3']],
    ]);
  });

  it('folds one rule reached through several lots and enforces it when any source does', () => {
    const [rule] = mergeHandlingRules([
      sourced(light(false), glo, GLO, ['A1']),
      sourced(light(false), glo, MEDIUM, ['B1']),
      sourced(light(true), medium, MEDIUM, ['B1']),
    ]);
    expect(rule?.rule.enforced).toBe(true);
    expect(rule?.from).toHaveLength(2);
    expect(rule?.from[0]).toMatchObject({ via: [GLO, MEDIUM], wells: ['A1:B1'] });
  });

  it('keeps the fewest freeze-thaws and the longest rest', () => {
    const rules = mergeHandlingRules([
      sourced(
        {
          rule: 'freeze_thaw_limit',
          text: '5',
          source: { from: 'vendor' },
          enforced: true,
          cycles: 5,
        },
        glo,
        GLO,
        ['A1'],
      ),
      sourced(
        {
          rule: 'freeze_thaw_limit',
          text: '1',
          source: { from: 'vendor' },
          enforced: true,
          cycles: 1,
        },
        medium,
        MEDIUM,
        ['A1'],
      ),
      sourced(
        {
          rule: 'equilibrate',
          text: '30 min',
          source: { from: 'vendor' },
          enforced: true,
          period: minutes('30'),
        },
        glo,
        GLO,
        ['A1'],
      ),
      sourced(
        { rule: 'equilibrate', text: 'warm up', source: { from: 'vendor' }, enforced: false },
        medium,
        MEDIUM,
        ['A1'],
      ),
    ]);
    expect(rules.map((r) => r.rule)).toMatchObject([
      { rule: 'freeze_thaw_limit', cycles: 1 },
      { rule: 'equilibrate', period: minutes('30') },
    ]);
  });

  it('narrows temperature ranges and says when they cannot all be kept', () => {
    const cold = (min: string, max: string, origin: RuleOrigin) =>
      sourced(
        {
          rule: 'keep_cold',
          text: `${min} to ${max}`,
          source: { from: 'vendor' },
          enforced: true,
          at: { min: { value: min, unit: 'degC' }, max: { value: max, unit: 'degC' } },
        },
        origin,
        GLO,
        ['A1'],
      );
    const [narrow] = mergeHandlingRules([cold('0', '8', glo), cold('2', '10', medium)]);
    expect(narrow?.rule).toMatchObject({
      at: { min: { value: '2' }, max: { value: '8' } },
      text: 'Keep cold at 2 °C to 8 °C (the narrowest range of its sources)',
    });
    expect(narrow?.conflict).toBeUndefined();
    const [clash] = mergeHandlingRules([cold('0', '4', glo), cold('6', '10', medium)]);
    expect(clash?.conflict).toMatch(/don't overlap/);
  });

  it('merges read windows per step and keeps different advice apart', () => {
    const read = (min: string | undefined, max: string, origin: RuleOrigin) =>
      sourced(
        {
          rule: 'read_within',
          text: 'read',
          source: { from: 'vendor' },
          enforced: true,
          after: 'adding reagent',
          ...(min ? { min: minutes(min) } : {}),
          max: minutes(max),
        },
        origin,
        GLO,
        ['A1'],
      );
    const advice = (text: string) =>
      sourced(
        { rule: 'advice', text, source: { from: 'lab_convention' }, enforced: false },
        hek,
        CELLS,
        ['A1'],
      );
    const rules = mergeHandlingRules([
      read('10', '60', glo),
      read(undefined, '30', medium),
      advice('Dispense gently'),
      advice('Dispense gently'),
      advice('Check confluence'),
    ]);
    expect(rules.map((r) => r.rule.rule)).toEqual(['read_within', 'advice', 'advice']);
    expect(rules[0]?.rule).toMatchObject({ min: minutes('10'), max: minutes('30') });
    expect(rules[0]?.rule.text).toBe(
      'Read from 10 min within 30 min after adding reagent (the narrowest window of its sources)',
    );
  });

  it('puts enforced rules first', () => {
    const rules = mergeHandlingRules([
      sourced(light(false), glo, GLO, ['A1']),
      sourced(outOfIncubator('30'), kind, CELLS, ['A1']),
    ]);
    expect(rules.map((r) => r.rule.rule)).toEqual([
      'max_time_out_of_storage',
      'protect_from_light',
    ]);
  });
});

describe('mergeStorage', () => {
  const c = (value: string) => ({ value, unit: 'degC' as const });
  it('takes the narrowest range', () => {
    expect(
      mergeStorage([
        { range: { min: c('2'), max: c('8') }, origin: medium, via: MEDIUM, wells: ['A1'] },
        { range: { max: c('-10') }, origin: glo, via: GLO, wells: ['A2'] },
        { range: {}, origin: hek, via: CELLS, wells: ['A3'] },
      ]),
    ).toMatchObject({
      range: { min: c('2'), max: c('-10') },
      conflict: expect.stringMatching(/2 °C/),
    });
    expect(
      mergeStorage([
        { range: { min: c('-30'), max: c('-10') }, origin: glo, via: GLO, wells: ['A1', 'A2'] },
      ]),
    ).toEqual({
      range: { min: c('-30'), max: c('-10') },
      from: [
        { origin: glo, range: { min: c('-30'), max: c('-10') }, via: [GLO], wells: ['A1:A2'] },
      ],
    });
  });

  it('is undefined when nothing names a temperature', () => {
    expect(mergeStorage([])).toBeUndefined();
  });
});

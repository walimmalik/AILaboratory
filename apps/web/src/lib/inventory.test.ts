import type { EffectiveRule, WellState } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  contentGroups,
  fullestWell,
  gridOf,
  heatLevel,
  pathWords,
  placeWords,
  ruleLimit,
  ruleSources,
  ruleWells,
  storageRangeWords,
  wellRanges,
} from './inventory.ts';

const uL = (value: string) => ({ value, unit: 'uL' as const });
const well = (volume: WellState['volume']): WellState => ({ volume, components: [] });

describe('plate grids and the heat map', () => {
  it('reads the grid from the positions', () => {
    expect(gridOf(['A1'])).toBeUndefined();
    const grid = gridOf(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(grid).toEqual({ rows: 3, columns: 2, rowLabels: ['A', 'B', 'C'] });
  });

  it('scales volumes against the fullest well', () => {
    const fullest = fullestWell([
      well(uL('10')),
      well({ value: '0.04', unit: 'mL' as const }),
      well('unknown'),
    ]);
    expect(fullest).toEqual({ value: '0.04', unit: 'mL' });
    expect(heatLevel(well(uL('40')), fullest)).toBe(4);
    expect(heatLevel(well(uL('10')), fullest)).toBe(1);
    expect(heatLevel(well(uL('0')), fullest)).toBe(0);
    expect(heatLevel(well('unknown'), fullest)).toBe('unknown');
    expect(heatLevel(undefined, fullest)).toBe(0);
  });
});

describe('places', () => {
  it('reads a path and a place', () => {
    expect(
      pathWords([
        { id: 'loc_1', name: 'LOC-0001', label: 'Cold room' },
        { id: 'lw_1', name: 'BOX-000003', label: 'Minipreps', position: 'B3' },
      ]),
    ).toBe('Cold room › BOX-000003 B3');
    const labels = new Map([['loc_01M3QZX866A5SB53SPYV40HA9G', 'Freezer −20']]);
    expect(placeWords({ location: 'loc_01M3QZX866A5SB53SPYV40HA9G' }, labels)).toBe('Freezer −20');
    expect(placeWords(undefined, labels)).toBe('Not known');
  });
});

describe('rules in words', () => {
  const rule: EffectiveRule = {
    rule: {
      rule: 'max_time_out_of_storage',
      text: '20 min',
      source: { from: 'lab_convention' },
      enforced: true,
      period: { value: '20', unit: 'min' },
    },
    from: [
      {
        origin: { id: 'enk_1', kind: 'entity_kind', name: 'ENK-0009', label: 'Cell line' },
        rule: {
          rule: 'max_time_out_of_storage',
          text: '30 min',
          source: { from: 'lab_convention' },
          enforced: true,
          period: { value: '30', unit: 'min' },
        },
        via: ['smp_01M3QZX866A5SB53SPYV40HA9K'],
        wells: ['A1:B2'],
      },
      {
        origin: { id: 'ent_1', kind: 'entity', name: 'CEL-0001', label: 'HEK293' },
        rule: {
          rule: 'max_time_out_of_storage',
          text: '20 min',
          source: { from: 'vendor' },
          enforced: true,
          period: { value: '20', unit: 'min' },
        },
        via: ['smp_01M3QZX866A5SB53SPYV40HA9K'],
        wells: ['A1:B2'],
      },
    ],
  };

  it('gives the limit, sources and wells', () => {
    expect(ruleLimit(rule.rule)).toBe('20 min');
    expect(
      ruleLimit({
        rule: 'freeze_thaw_limit',
        text: 'x',
        source: { from: 'vendor' },
        enforced: true,
        cycles: 0,
      }),
    ).toBe('do not refreeze');
    expect(ruleSources(rule)).toBe('Cell line kind (lab convention), HEK293 (vendor)');
    expect(ruleWells(rule, 4)).toBeUndefined();
    expect(ruleWells(rule, 5)).toBe('A1:B2');
    expect(
      storageRangeWords({ min: { value: '2', unit: 'degC' }, max: { value: '8', unit: 'degC' } }),
    ).toBe('2 °C to 8 °C');
  });
});

describe('plate contents', () => {
  const block = (rows: string, from: number, to: number) =>
    [...rows].flatMap((r) => Array.from({ length: to - from + 1 }, (_, i) => `${r}${from + i}`));

  it('writes wells as blocks corner to corner', () => {
    expect(wellRanges(block('ABCDEFGHIJKLMNOP', 3, 22))).toBe('A3:P22');
    expect(wellRanges([...block('AB', 1, 2), ...block('AB', 23, 24)])).toBe('A1:B2, A23:B24');
    expect(wellRanges(['C1', 'A1', 'A2'])).toBe('A1:A2, C1');
    expect(wellRanges(['B7'])).toBe('B7');
  });

  it('groups wells that hold the same things, largest group first', () => {
    const dmso = { source: 'lot_dmso', concentration: { value: '100', unit: '%v/v' } };
    const drug = { source: 'lot_drug', concentration: { value: '10', unit: 'mM' } };
    const groups = contentGroups([
      { well: 'A1', state: { volume: uL('40'), components: [dmso] } },
      { well: 'A2', state: { volume: uL('40'), components: [drug, dmso] } },
      { well: 'A3', state: { volume: uL('20'), components: [dmso, drug] } },
    ]);
    expect(groups.map((g) => g.wells)).toEqual([['A2', 'A3'], ['A1']]);
  });
});

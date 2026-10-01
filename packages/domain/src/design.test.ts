import { describe, expect, it } from 'vitest';
import {
  DesignError,
  designConditions,
  designTotals,
  type ResolvedFactor,
  seriesLevels,
} from './design.ts';

const compound: ResolvedFactor = {
  id: 'compound',
  label: 'Compound',
  levels: [
    { id: 'sts', label: 'Staurosporine' },
    { id: 'jq1', label: 'JQ1' },
  ],
};
const dose: ResolvedFactor = {
  id: 'dose',
  label: 'Concentration',
  levels: seriesLevels({ top: { value: '10', unit: 'uM' }, factor: '3', points: 3 }),
};
const time: ResolvedFactor = {
  id: 'time',
  label: 'Time',
  levels: [
    { id: 'h24', label: '24 h' },
    { id: 'h48', label: '48 h' },
  ],
  baseline: 'h24',
};

describe('design conditions', () => {
  it('makes a series into levels, top first', () => {
    expect(dose.levels.map((l) => [l.id, l.label])).toEqual([
      ['p1', '10 µM'],
      ['p2', '3.33333 µM'],
      ['p3', '1.11111 µM'],
    ]);
  });

  it('combines every level in a full factorial, the first factor varying slowest', () => {
    const conditions = designConditions([compound, dose]);
    expect(conditions).toHaveLength(6);
    expect(conditions.map((c) => c.id)).toEqual([
      'sts.p1',
      'sts.p2',
      'sts.p3',
      'jq1.p1',
      'jq1.p2',
      'jq1.p3',
    ]);
    expect(conditions[0]).toEqual({
      id: 'sts.p1',
      levels: { compound: 'sts', dose: 'p1' },
      label: 'Compound: Staurosporine · Concentration: 10 µM',
    });
  });

  it('varies one factor at a time from the baselines', () => {
    const conditions = designConditions([compound, dose, time], 'one_factor_at_a_time');
    expect(conditions.map((c) => c.id)).toEqual([
      'sts.p1.h24',
      'jq1.p1.h24',
      'sts.p2.h24',
      'sts.p3.h24',
      'sts.p1.h48',
    ]);
  });

  it('has one condition without factors, and refuses factors that do not add up', () => {
    expect(designConditions([])).toEqual([{ id: 'all', levels: {}, label: 'One condition' }]);
    expect(() => designConditions([compound, compound])).toThrow('Two factors are called compound');
    expect(() => designConditions([{ ...time, baseline: 'h72' }])).toThrow(DesignError);
    expect(() => designConditions([{ ...time, levels: [] }])).toThrow('Time has no levels');
    const many = (id: string): ResolvedFactor => ({
      id,
      label: id,
      levels: Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, label: `${i}` })),
    });
    expect(() => designConditions([many('a'), many('b'), many('c')])).toThrow('27000 conditions');
  });
});

describe('design totals', () => {
  it('fits 40 samples in duplicate with a standard curve and blanks on one 96-well plate', () => {
    const totals = designTotals({
      conditions: 40,
      technical: 2,
      controls: [
        { label: 'Standards', wells: 14, per: 'plate' },
        { label: 'Blanks', wells: 2, per: 'plate' },
      ],
      wellsPerPlate: 96,
    });
    expect(totals).toMatchObject({
      subjectWells: 80,
      controlWells: 16,
      plates: 1,
      spare: 0,
      totalPlates: 1,
    });
    expect(totals.lines).toEqual([
      '40 conditions × 2 wells = 80 wells',
      'Standards: 14 wells per plate',
      'Blanks: 2 wells per plate',
      '1 plate of 96 wells per run, 0 spare',
    ]);
  });

  it('adds plates when controls repeat on every plate, and repeats them for each run', () => {
    const totals = designTotals({
      conditions: 41,
      technical: 2,
      biological: 3,
      controls: [{ label: 'Standards', wells: 16, per: 'plate' }],
      wellsPerPlate: 96,
    });
    expect(totals).toMatchObject({
      plates: 2,
      controlWells: 32,
      spare: 78,
      runs: 3,
      totalPlates: 6,
      totalWells: 342,
    });
    expect(totals.lines.at(-1)).toBe('3 runs: 6 plates in all');
  });

  it('refuses controls that fill the plate and counts that are not whole', () => {
    expect(() =>
      designTotals({
        conditions: 1,
        technical: 1,
        wellsPerPlate: 96,
        controls: [{ label: 'x', wells: 96, per: 'plate' }],
      }),
    ).toThrow('take 96 wells');
    expect(() => designTotals({ conditions: 0, technical: 1, wellsPerPlate: 96 })).toThrow(
      'conditions',
    );
  });
});

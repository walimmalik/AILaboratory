import type { WellState } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  amountIn,
  ContentsError,
  componentProblems,
  concentrationOf,
  mapPlates,
  mix,
  take,
  transfer,
} from './contents.ts';

const STAURO = 'lot_01M3QZX866A5SB53SPYV40HA9G';
const DMSO = 'lot_01M3QZX866A5SB53SPYV40HA9H';
const MEDIUM = 'lot_01M3QZX866A5SB53SPYV40HA9J';
const CELLS = 'smp_01M3QZX866A5SB53SPYV40HA9K';

const stock: WellState = {
  volume: { value: '200', unit: 'uL' },
  components: [
    { source: STAURO, concentration: { value: '1', unit: 'mM' } },
    { source: DMSO, concentration: { value: '100', unit: '%v/v' } },
  ],
};
const empty: WellState = { volume: { value: '0', unit: 'uL' }, components: [] };

describe('amounts and concentrations', () => {
  it('turns a concentration and a volume into an amount and back', () => {
    expect(amountIn({ value: '10', unit: 'mM' }, { value: '5', unit: 'uL' })).toEqual({
      value: '0.00000005',
      unit: 'mol',
    });
    expect(amountIn({ value: '2', unit: 'U/uL' }, { value: '10', unit: 'uL' })).toEqual({
      value: '20',
      unit: 'U',
    });
    expect(amountIn({ value: '1', unit: '%w/w' }, { value: '1', unit: 'mL' })).toBeUndefined();
    expect(
      concentrationOf({ value: '0.00000005', unit: 'mol' }, { value: '50', unit: 'uL' }, 'uM'),
    ).toEqual({ value: '1000', unit: 'uM' });
  });
});

describe('take', () => {
  it('leaves the rest, refuses more than is there, and empties to nothing', () => {
    const { left, portion } = take(stock, { value: '50', unit: 'uL' });
    expect(left.volume).toEqual({ value: '150', unit: 'uL' });
    expect(portion.components).toEqual(stock.components);
    expect(() => take(stock, { value: '0.3', unit: 'mL' })).toThrow(
      'Only 200 uL is there, not 0.3 mL',
    );
    expect(take(stock, { value: '0.2', unit: 'mL' }).left).toEqual({
      volume: { value: '0', unit: 'uL' },
      components: [],
    });
    expect(() => take(empty, { value: '1', unit: 'uL' })).toThrow(ContentsError);
    const unknown: WellState = { ...stock, volume: 'unknown' };
    expect(take(unknown, { value: '5', unit: 'uL' }).left).toBe(unknown);
  });
});

describe('mix', () => {
  it('keeps concentrations going into an empty well', () => {
    const { destination } = transfer(stock, empty, { value: '40', unit: 'uL' });
    expect(destination).toEqual({
      volume: { value: '40', unit: 'uL' },
      components: stock.components,
    });
  });

  it('dilutes an Echo transfer of 25 nL into 25 µL of medium', () => {
    const well: WellState = {
      volume: { value: '25', unit: 'uL' },
      components: [{ source: MEDIUM, concentration: { value: '100', unit: '%v/v' } }],
    };
    const { destination } = transfer(stock, well, { value: '25', unit: 'nL' });
    expect(destination.volume).toEqual({ value: '25.025', unit: 'uL' });
    const byName = Object.fromEntries(
      destination.components.map((c) => [c.source, c.concentration]),
    );
    // 1 mM × 25 nL / 25.025 µL
    expect(Number(byName[STAURO]?.value)).toBeCloseTo(0.000999000999, 10);
    expect(byName[STAURO]?.unit).toBe('mM');
    expect(Number(byName[DMSO]?.value)).toBeCloseTo(0.0999000999, 8);
    expect(Number(byName[MEDIUM]?.value)).toBeCloseTo(99.9000999, 6);
  });

  it('adds the same component from both sides', () => {
    const half: WellState = {
      volume: { value: '10', unit: 'uL' },
      components: [{ source: STAURO, concentration: { value: '2', unit: 'mM' } }],
    };
    const result = mix(half, {
      volume: { value: '10', unit: 'uL' },
      components: [{ source: STAURO, concentration: { value: '1000', unit: 'uM' } }],
    });
    expect(result.components).toEqual([
      { source: STAURO, concentration: { value: '1.5', unit: 'mM' } },
    ]);
  });

  it('dissolves a dried amount and seeds cells', () => {
    const dried: WellState = {
      volume: { value: '0', unit: 'uL' },
      components: [{ source: STAURO, amount: { value: '0.00000001', unit: 'mol' } }],
    };
    const result = mix(dried, {
      volume: { value: '100', unit: 'uL' },
      components: [{ source: CELLS, concentration: { value: '100000', unit: 'cells/mL' } }],
    });
    expect(result).toEqual({
      volume: { value: '100', unit: 'uL' },
      components: [
        { source: STAURO, concentration: { value: '100', unit: 'uM' } },
        { source: CELLS, concentration: { value: '100000', unit: 'cells/mL' } },
      ],
    });
  });

  it('keeps what is unknown unknown, and carries assumed', () => {
    const unknownVolume: WellState = { ...stock, volume: 'unknown' };
    const result = mix(unknownVolume, {
      volume: { value: '10', unit: 'uL' },
      components: [{ source: MEDIUM, concentration: { value: '100', unit: '%v/v' } }],
      assumed: true,
    });
    expect(result).toEqual({
      volume: 'unknown',
      components: [{ source: STAURO }, { source: DMSO }, { source: MEDIUM }],
      assumed: true,
    });
    const noConcentration = mix(
      { volume: { value: '10', unit: 'uL' }, components: [{ source: CELLS }] },
      { volume: { value: '10', unit: 'uL' }, components: stock.components },
    );
    expect(noConcentration.components[0]).toEqual({ source: CELLS });
    expect(noConcentration.components[1]).toEqual({
      source: STAURO,
      concentration: { value: '0.5', unit: 'mM' },
    });
    const wOverW = mix(
      { volume: { value: '10', unit: 'uL' }, components: [] },
      {
        volume: { value: '10', unit: 'uL' },
        components: [{ source: DMSO, concentration: { value: '5', unit: '%w/w' } }],
      },
    );
    expect(wOverW.components).toEqual([{ source: DMSO }]);
    const intoEmpty = mix(empty, {
      volume: { value: '10', unit: 'uL' },
      components: [{ source: DMSO, concentration: { value: '5', unit: '%w/w' } }],
    });
    expect(intoEmpty.components).toEqual([
      { source: DMSO, concentration: { value: '5', unit: '%w/w' } },
    ]);
  });
});

describe('dry amounts', () => {
  it('adds a dried spot to an empty well and keeps it as an amount', () => {
    const spotted = mix(empty, {
      volume: { value: '0', unit: 'uL' },
      components: [{ source: STAURO, amount: { value: '10', unit: 'nmol' } }],
    });
    expect(spotted).toEqual({
      volume: { value: '0', unit: 'uL' },
      components: [{ source: STAURO, amount: { value: '10', unit: 'nmol' } }],
    });
    const twice = mix(spotted, {
      volume: { value: '0', unit: 'uL' },
      components: [{ source: STAURO, amount: { value: '0.00000001', unit: 'mol' } }],
    });
    expect(twice.components).toEqual([{ source: STAURO, amount: { value: '20', unit: 'nmol' } }]);
  });
});

describe('mapPlates', () => {
  const p96 = { rows: 8, columns: 12 };
  const p384 = { rows: 16, columns: 24 };
  it('maps one to one, by quadrant and by offset', () => {
    expect(mapPlates(p96, p96, { type: 'one_to_one' }, ['A1', 'H12'])).toEqual([
      { from: 'A1', to: 'A1' },
      { from: 'H12', to: 'H12' },
    ]);
    expect(mapPlates(p96, p384, { type: 'quadrant', quadrant: 1 })).toHaveLength(96);
    expect(mapPlates(p96, p384, { type: 'quadrant', quadrant: 4 }, ['A1', 'H12'])).toEqual([
      { from: 'A1', to: 'B2' },
      { from: 'H12', to: 'P24' },
    ]);
    expect(mapPlates(p96, p384, { type: 'quadrant', quadrant: 2 }, ['B3'])).toEqual([
      { from: 'B3', to: 'C6' },
    ]);
    expect(mapPlates(p96, p96, { type: 'offset', rows: 0, columns: 2 }, ['A1'])).toEqual([
      { from: 'A1', to: 'A3' },
    ]);
  });
  it('refuses grids that do not fit and wells that land off the plate', () => {
    expect(() => mapPlates(p96, p384, { type: 'one_to_one' })).toThrow('same grid');
    expect(() => mapPlates(p384, p96, { type: 'quadrant', quadrant: 1 })).toThrow('twice the rows');
    expect(() => mapPlates(p96, p96, { type: 'offset', rows: 0, columns: 2 }, ['A11'])).toThrow(
      'A11 would land off the destination plate',
    );
  });
});

describe('componentProblems', () => {
  const lot = 'lot_01J0000000000000000000000A' as const;
  it('accepts concentrations per volume and amounts', () => {
    expect(
      componentProblems([
        { source: lot, concentration: { value: '10', unit: 'mM' } },
        { source: lot, amount: { value: '5', unit: 'ug' } },
        { source: lot },
      ]),
    ).toEqual([]);
  });
  it('names a wrong dimension, an unknown unit and a negative value', () => {
    expect(
      componentProblems([
        { source: lot, concentration: { value: '10', unit: 'uL' } },
        { source: lot, amount: { value: '-1', unit: 'mol' } },
        { source: lot, concentration: { value: '1', unit: 'furlong' } },
      ]),
    ).toEqual([
      `${lot}: µL is not a concentration (give it per volume, or as a percent)`,
      `${lot}: an amount can't be negative`,
      `${lot}: unknown unit "furlong"`,
    ]);
  });
});

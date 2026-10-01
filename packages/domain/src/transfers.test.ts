import { describe, expect, it } from 'vitest';
import {
  backfill,
  countTips,
  dilutionOptions,
  directDispense,
  fitVolume,
  optimizeDilution,
  rankDevices,
  sourceVolumes,
  TransferError,
} from './transfers.ts';

const q = (value: string, unit: string) => ({ value, unit });
const echo = { min: q('2.5', 'nL'), max: q('500', 'nL'), step: q('2.5', 'nL') };
const screen = {
  stock: q('10', 'mM'),
  finalVolume: q('25', 'uL'),
  device: echo,
  maxSolventPercent: '0.5',
  tolerance: '0.05',
};

describe('fitting a volume to a device', () => {
  it('rounds to whole droplets and says how far off that is', () => {
    expect(fitVolume(q('25', 'nL'), echo)).toMatchObject({
      achieved: q('25', 'nL'),
      steps: 10,
      error: '0',
      fits: true,
    });
    expect(fitVolume(q('3.75', 'nL'), echo)).toMatchObject({
      achieved: q('5', 'nL'),
      steps: 2,
      error: '0.3333',
    });
  });

  it('says why a volume does not fit', () => {
    expect(fitVolume(q('1', 'nL'), echo)).toMatchObject({
      fits: false,
      problem: '1 nL is less than one step of 2.5 nL',
    });
    expect(fitVolume(q('1', 'uL'), echo).problem).toBe('1 µL is above the maximum of 500 nL');
    expect(fitVolume(q('0.2', 'uL'), { min: q('0.5', 'uL') }).problem).toBe(
      '0.2 µL is below the minimum of 0.5 µL',
    );
    expect(() => fitVolume(q('0', 'nL'), echo)).toThrow(TransferError);
  });
});

describe('dispensing from a stock', () => {
  it('works out the volume, the concentration it gives and the solvent it brings', () => {
    expect(directDispense({ ...screen, target: q('10', 'uM') })).toMatchObject({
      volume: { achieved: q('25', 'nL'), steps: 10 },
      achieved: q('10', 'uM'),
      error: '0',
      solventPercent: '0.1',
      ok: true,
    });
  });

  it('reports what goes wrong: droplets, tolerance, solvent, a target above the stock', () => {
    const coarse = directDispense({ ...screen, target: q('1.5', 'uM') });
    expect(coarse.achieved).toEqual(q('2', 'uM'));
    expect(coarse.problems).toEqual(['2 µM is 33.333% off 1.5 µM, more than ±5%']);
    expect(directDispense({ ...screen, target: q('100', 'uM') }).problems).toEqual([
      'It brings 1% solvent into the well, more than 0.5%',
    ]);
    expect(directDispense({ ...screen, target: q('3', 'nM') }).problems[0]).toContain(
      'less than one step',
    );
    expect(directDispense({ ...screen, target: q('20', 'mM') }).problems[0]).toBe(
      '20 mM is more than the stock (10 mM)',
    );
    expect(() => directDispense({ ...screen, target: q('1', 'mg/mL') })).toThrow(
      'different kinds of concentration',
    );
  });

  it('backfills every well to the fullest one, in whole droplets', () => {
    expect(backfill([q('25', 'nL'), q('7.5', 'nL'), q('0.0025', 'uL')], echo)).toEqual({
      to: q('25', 'nL'),
      backfill: [q('0', 'nL'), q('17.5', 'nL'), q('22.5', 'nL')],
    });
  });
});

describe('dilution options', () => {
  it('goes through an intermediate only for points the stock cannot reach', () => {
    const points = dilutionOptions({
      ...screen,
      targets: [q('10', 'uM'), q('3', 'nM'), q('0.1', 'nM')],
    });
    expect(points[0]).toMatchObject({ reachable: true });
    expect(points[0]).not.toHaveProperty('intermediate');
    expect(points[1]).toMatchObject({
      reachable: true,
      intermediate: {
        factor: '1000',
        concentration: q('0.01', 'mM'),
        dispense: { volume: { achieved: q('7.5', 'nL') }, achieved: q('3', 'nM') },
      },
    });
    expect(points[2]?.reachable).toBe(false);
  });

  it('gives the same answer whatever order the factors come in', () => {
    const input = {
      stock: q('10', 'mM'),
      finalVolume: q('10', 'uL'),
      device: { min: q('2', 'uL'), max: q('100', 'uL'), step: q('0.1', 'uL') },
      maxSolventPercent: '100',
      tolerance: '0.05',
      targets: [q('1', 'mM')],
    };
    const sorted = dilutionOptions({ ...input, factors: ['10', '1000'] });
    const unsorted = dilutionOptions({ ...input, factors: ['1000', '10'] });
    expect(sorted[0]).toMatchObject({ reachable: true, intermediate: { factor: '10' } });
    expect(unsorted).toEqual(sorted);
  });
});

describe('source volumes', () => {
  it('adds dead volume and overage to what is drawn', () => {
    const needs = sourceVolumes(
      [
        { source: 'lot_a', volume: q('100', 'uL') },
        { source: 'lot_a', volume: q('50', 'uL') },
        { source: 'plate_b', volume: q('25', 'nL') },
      ],
      { deadVolume: (s) => (s === 'lot_a' ? q('15', 'uL') : undefined), overage: '0.1' },
    );
    expect(needs).toEqual([
      {
        source: 'lot_a',
        drawn: q('150', 'uL'),
        dead: q('15', 'uL'),
        overage: q('15', 'uL'),
        needed: q('180', 'uL'),
        draws: 2,
      },
      {
        source: 'plate_b',
        drawn: q('0.025', 'uL'),
        dead: q('0', 'uL'),
        overage: q('0.0025', 'uL'),
        needed: q('0.0275', 'uL'),
        draws: 1,
      },
    ]);
  });
});

describe('tips and devices', () => {
  const moves = [
    { source: 'buffer' },
    { source: 'buffer' },
    { source: 'buffer', intoLiquid: true },
    { source: 'cmp', intoLiquid: true },
  ];

  it('counts tips the way the method uses them', () => {
    expect(countTips(moves, 'none')).toBe(0);
    expect(countTips(moves, 'new_each')).toBe(4);
    expect(countTips(moves, 'per_source')).toBe(2);
    expect(countTips(moves, 'lab_default')).toBe(3);
  });

  it('ranks devices: what fits, a verified class, less error, no tips', () => {
    const ranked = rankDevices(q('25', 'nL'), [
      {
        id: 'star',
        label: 'STAR 1 mL channels',
        limits: { min: q('0.5', 'uL') },
        tips: 'new_each',
      },
      {
        id: 'mantis',
        label: 'Mantis LV chip',
        limits: { min: q('100', 'nL'), step: q('100', 'nL') },
        tips: 'none',
      },
      { id: 'echo', label: 'Echo 650', limits: echo, verifiedClass: true, tips: 'none' },
    ]);
    expect(ranked.map((r) => [r.id, r.rank, r.fit.fits])).toEqual([
      ['echo', 1, true],
      ['star', 2, false],
      ['mantis', 3, false],
    ]);
  });
});

describe('the dilution optimizer', () => {
  // A 10-point 3-fold curve from 10 µM, as the lab's dose-response layout has it.
  const curve = Array.from({ length: 10 }, (_, i) =>
    q(String(Number((10 / 3 ** i).toPrecision(6))), 'uM'),
  );
  const input = {
    ...screen,
    compounds: [
      { id: 'cmp1', stock: q('10', 'mM'), points: curve.slice(0, 7), wellsPerPoint: 2 },
      { id: 'cmp2', stock: q('1', 'mM'), points: curve.slice(1), wellsPerPoint: 2 },
    ],
    intermediatePlate: { wells: 384, deadVolume: q('15', 'uL'), maxVolume: q('65', 'uL') },
  };

  it('takes each point from the source when it can, else the fewest intermediate wells', () => {
    const result = optimizeDilution(input);
    expect(result.unreachable).toEqual([]);
    for (const p of result.points) {
      expect(Number(p.dispense.error)).toBeLessThanOrEqual(0.05);
      expect(Number(p.dispense.solventPercent)).toBeLessThanOrEqual(0.5);
    }
    const cmp1 = result.points.filter((p) => p.compound === 'cmp1');
    expect(cmp1[0]).toMatchObject({ from: 'source', dispense: { volume: { steps: 10 } } });
    expect(cmp1[1]).toMatchObject({
      from: 'intermediate',
      intermediate: 'I1',
      dispense: { volume: { achieved: q('82.5', 'nL') }, achieved: q('3.3', 'uM'), error: '0.01' },
    });
    // Three dilutions per compound at most, each shared by the points it reaches.
    expect(result.intermediates.map((w) => [w.id, w.compound, w.factor, w.well])).toEqual([
      ['I1', 'cmp1', '10', 'A1'],
      ['I2', 'cmp1', '100', 'A2'],
      ['I3', 'cmp1', '1000', 'A3'],
      ['I4', 'cmp2', '10', 'A4'],
      ['I5', 'cmp2', '100', 'A5'],
      ['I6', 'cmp2', '1000', 'A6'],
    ]);
    expect(result.plates).toBe(1);
  });

  it('makes each intermediate well with what is drawn plus the dead volume', () => {
    const [first] = optimizeDilution(input).intermediates;
    // Points 2 and 3 of cmp1, twice each: 2 × 82.5 nL + 2 × 27.5 nL = 0.22 µL, plus 15 µL dead.
    expect(first).toMatchObject({
      concentration: q('1', 'mM'),
      drawn: q('0.22', 'uL'),
      dead: q('15', 'uL'),
      volume: q('15.22', 'uL'),
      stock: q('1.522', 'uL'),
      diluent: q('13.698', 'uL'),
    });
  });

  it('opens another well when one runs dry, and says what no route reaches', () => {
    const many = optimizeDilution({
      ...input,
      compounds: [
        { id: 'cmp1', stock: q('10', 'mM'), points: [curve[1] as never], wellsPerPoint: 700 },
      ],
    });
    // 700 × 82.5 nL = 57.75 µL; a well gives 50 µL above its 15 µL dead volume.
    expect(many.intermediates.map((w) => w.drawn)).toEqual([q('49.995', 'uL'), q('7.755', 'uL')]);
    expect(many.points[0]?.intermediate).toBe('I1, I2');

    const deep = optimizeDilution({
      ...input,
      compounds: [{ id: 'cmp1', stock: q('10', 'mM'), points: [q('0.1', 'nM'), q('100', 'uM')] }],
    });
    expect(deep.unreachable.map((u) => u.problems.at(-1))).toEqual([
      'No intermediate of 10, 100, 1000 fold reaches it within the limits',
      'No intermediate of 10, 100, 1000 fold reaches it within the limits',
    ]);
  });
});

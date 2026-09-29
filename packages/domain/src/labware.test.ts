import type { WellGeometry, WellLayout } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import {
  computeWells,
  gridFitProblem,
  heightForVolume,
  parseWellName,
  sbsFootprintProblem,
  sbsPitch,
  sbsPositions,
  volumeAtHeight,
  wellCapacity,
  wellName,
} from './labware.ts';

const mm = (value: string) => ({ value, unit: 'mm' as const });

describe('well names', () => {
  it('writes canonical names up to AF48', () => {
    expect(wellName(0, 0)).toBe('A1');
    expect(wellName(15, 23)).toBe('P24');
    expect(wellName(26, 0)).toBe('AA1');
    expect(wellName(31, 47)).toBe('AF48');
    expect(() => wellName(32, 0)).toThrow('outside A to AF');
    expect(() => wellName(0, 48)).toThrow('outside 1 to 48');
  });

  it('reads common spellings and refuses the rest', () => {
    expect(parseWellName('A1')).toEqual({ row: 0, column: 0 });
    expect(parseWellName('a01')).toEqual({ row: 0, column: 0 });
    expect(parseWellName('P24')).toEqual({ row: 15, column: 23 });
    expect(parseWellName('AF48')).toEqual({ row: 31, column: 47 });
    expect(() => parseWellName('AG1')).toThrow('outside A1 to AF48');
    expect(() => parseWellName('A49')).toThrow('outside A1 to AF48');
    expect(() => parseWellName('1A')).toThrow('not a well name');
  });
});

const plate96: WellLayout = {
  layout: 'grid',
  rows: 8,
  columns: 12,
  pitch: mm('9'),
  a1: { x: mm('14.38'), y: mm('11.24') },
  well: { top: { shape: 'circular', diameter: mm('6.86') }, depth: mm('10.67'), bottom: 'flat' },
};

describe('computed wells', () => {
  it('lays out a grid column by column, with positions', () => {
    const wells = computeWells(plate96);
    expect(wells).toHaveLength(96);
    expect(wells.slice(0, 2).map((w) => w.name)).toEqual(['A1', 'B1']);
    expect(wells[95]).toMatchObject({ name: 'H12', x: mm('113.38'), y: mm('74.24') });
    expect(computeWells(plate96, 'row')[1]?.name).toBe('A2');
  });

  it('leaves positions out when the grid is not placed yet', () => {
    const wells = computeWells({ layout: 'grid', rows: 2, columns: 3 });
    expect(wells.map((w) => w.name)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(wells[0]?.x).toBeUndefined();
  });

  it('normalizes explicit well names', () => {
    const wells = computeWells({
      layout: 'explicit',
      wells: [{ name: 'A1', x: mm('63.88'), y: mm('42.74'), well: {} }],
    });
    expect(wells).toEqual([
      { name: 'A1', row: 0, column: 0, x: mm('63.88'), y: mm('42.74'), well: {} },
    ]);
  });
});

describe('SBS rules', () => {
  it('accepts footprints within 0.25 mm and names the ones outside', () => {
    expect(
      sbsFootprintProblem({ sbs: true, length: mm('127.8'), width: mm('85.5') }),
    ).toBeUndefined();
    expect(sbsFootprintProblem({ sbs: true, length: mm('127.75'), width: mm('85.75') })).toContain(
      '127.75 × 85.75 mm',
    );
    expect(sbsFootprintProblem({ sbs: false, length: mm('17'), width: mm('17') })).toBeUndefined();
  });

  it('knows the standard well spacing', () => {
    expect(sbsPitch(8, 12)).toBe(9);
    expect(sbsPitch(16, 24)).toBe(4.5);
    expect(sbsPitch(32, 48)).toBe(2.25);
    expect(sbsPitch(2, 3)).toBeUndefined();
  });

  it('places A1 on standard SBS grids and leaves other grids alone', () => {
    expect(sbsPositions(8, 12)).toEqual({ pitch: 9, a1: { x: 14.38, y: 11.24 } });
    expect(sbsPositions(16, 24)).toEqual({ pitch: 4.5, a1: { x: 12.13, y: 8.99 } });
    expect(sbsPositions(32, 48)).toEqual({ pitch: 2.25, a1: { x: 11.005, y: 7.865 } });
    expect(sbsPositions(1, 12)).toEqual({ pitch: 9, a1: { x: 14.38, y: 42.74 } });
    expect(sbsPositions(4, 6)).toBeUndefined();
    // The last well of a 96-well plate sits as far from the right and front edges as A1 from the left and back.
    const { pitch, a1 } = sbsPositions(8, 12) as NonNullable<ReturnType<typeof sbsPositions>>;
    expect(127.76 - (a1.x + 11 * pitch)).toBeCloseTo(a1.x, 1);
    expect(85.48 - (a1.y + 7 * pitch)).toBeCloseTo(a1.y, 1);
  });

  it('finds wells that fall off the footprint', () => {
    const footprint = { sbs: true, length: mm('127.76'), width: mm('85.48') };
    expect(gridFitProblem(plate96, footprint)).toBeUndefined();
    expect(gridFitProblem({ ...plate96, pitch: mm('10') }, footprint)).toContain('Well');
  });
});

describe('liquid height', () => {
  const cylinder: WellGeometry = {
    top: { shape: 'circular', diameter: mm('10') },
    depth: mm('10'),
    bottom: 'flat',
  };

  it('computes a cylinder exactly', () => {
    expect(wellCapacity(cylinder)).toBeCloseTo(Math.PI * 25 * 10, 9);
    expect(heightForVolume(cylinder, Math.PI * 25 * 4)).toBeCloseTo(4, 6);
  });

  it('computes tapered wells as frustums', () => {
    const tapered: WellGeometry = {
      top: { shape: 'circular', diameter: mm('6.86') },
      base: { shape: 'circular', diameter: mm('6.35') },
      depth: mm('10.67'),
      bottom: 'flat',
    };
    const [r1, r2, h] = [3.43, 3.175, 10.67];
    expect(wellCapacity(tapered)).toBeCloseTo((Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3, 6);
    const square: WellGeometry = {
      top: { shape: 'rectangular', xSize: mm('3.63'), ySize: mm('3.63') },
      base: { shape: 'rectangular', xSize: mm('2.67'), ySize: mm('2.67') },
      depth: mm('11.43'),
      bottom: 'flat',
    };
    const capacity = wellCapacity(square);
    expect(capacity).toBeCloseTo((11.43 / 3) * (3.63 ** 2 + 3.63 * 2.67 + 2.67 ** 2), 6);
    expect(volumeAtHeight(square, heightForVolume(square, 50))).toBeCloseTo(50, 6);
  });

  it('refuses what it does not model', () => {
    expect(() => wellCapacity({ ...cylinder, bottom: 'v' })).toThrow('flat-bottomed');
    expect(() => wellCapacity({ top: cylinder.top, bottom: 'flat' })).toThrow('top size and depth');
    expect(() => heightForVolume(cylinder, 10_000)).toThrow('does not fit');
  });
});

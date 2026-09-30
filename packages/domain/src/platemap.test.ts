import { describe, expect, it } from 'vitest';
import {
  allWells,
  generatePlateMap,
  type LayoutSpec,
  parseRegion,
  plateFormat,
  replicateCells,
  seededRandom,
  seriesConcentrations,
} from './platemap.ts';

const p96 = plateFormat(96);
const p384 = plateFormat(384);
const compounds = (n: number) => Array.from({ length: n }, (_, i) => ({ subject: `cmp_${i + 1}` }));
const wellsOf = (plate: { wells: { well: string; role: string }[] }, role: string) =>
  plate.wells.filter((w) => w.role === role).map((w) => w.well);

describe('regions', () => {
  it('reads wells, blocks, columns, rows, edges and all', () => {
    expect(parseRegion('A1:B2', p96)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(parseRegion('columns 1-2', p96)).toHaveLength(16);
    expect(parseRegion('columns 1, 12', p96)).toContain('H12');
    expect(parseRegion('row H', p96)).toEqual(allWells(p96).filter((w) => w.startsWith('H')));
    expect(parseRegion('rows A-B', p384)).toHaveLength(48);
    expect(parseRegion('edge', p96)).toHaveLength(36);
    expect(parseRegion('all', p384)).toHaveLength(384);
  });

  it('refuses wells the format does not have', () => {
    expect(() => parseRegion('column 13', p96)).toThrow('A 96-well plate has no column 13');
    expect(() => parseRegion('row I', p96)).toThrow('has no row I');
    expect(() => parseRegion('A1:P24', p96)).toThrow('There is no well');
    expect(() => plateFormat(100)).toThrow('100 wells is not a standard plate');
  });
});

describe('series', () => {
  it('divides from the top by the factor, to 6 significant digits', () => {
    expect(
      seriesConcentrations({ top: { value: '10', unit: 'uM' }, factor: '3', points: 4 }),
    ).toEqual([
      { value: '10', unit: 'uM' },
      { value: '3.33333', unit: 'uM' },
      { value: '1.11111', unit: 'uM' },
      { value: '0.37037', unit: 'uM' },
    ]);
    expect(
      seriesConcentrations({
        top: { value: '1000', unit: 'pg/mL' },
        factor: '2',
        points: 3,
        direction: 'up',
      }).map((q) => q.value),
    ).toEqual(['250', '500', '1000']);
    expect(() =>
      seriesConcentrations({ top: { value: '1', unit: 'uM' }, factor: '1', points: 2 }),
    ).toThrow('factor is above 1');
  });
});

describe('replicate cells', () => {
  it('pairs wells side by side or down a column and leaves odd ones over', () => {
    const wells = parseRegion('A1:B3', p96);
    expect(replicateCells(wells, 2, 'side_by_side', 'row')).toEqual({
      cells: [
        ['A1', 'A2'],
        ['B1', 'B2'],
      ],
      leftover: ['A3', 'B3'],
    });
    expect(replicateCells(wells, 2, 'down_column', 'row').cells).toEqual([
      ['A1', 'B1'],
      ['A2', 'B2'],
      ['A3', 'B3'],
    ]);
  });
});

describe('plate maps', () => {
  // 384 compound screen: DMSO columns 1-2, staurosporine 23-24, compounds 3-22 (320 wells).
  const screen: LayoutSpec = {
    format: p384,
    subjectRole: 'compound',
    subjectRegion: ['columns 3-22'],
    fixed: [
      { role: 'neutral_control', label: 'DMSO', region: ['columns 1-2'] },
      {
        role: 'positive_control',
        label: 'Staurosporine',
        region: ['columns 23-24'],
        subject: { subject: 'ent_stauro', concentration: { value: '1', unit: 'uM' } },
      },
    ],
    fillOrder: 'column',
  };

  it('pages 400 compounds over two plates with controls on each, and fills the rest', () => {
    const { plates } = generatePlateMap(screen, compounds(400));
    expect(plates).toHaveLength(2);
    for (const plate of plates) {
      expect(wellsOf(plate, 'neutral_control')).toHaveLength(32);
      expect(wellsOf(plate, 'positive_control')).toHaveLength(32);
      expect(plate.wells.find((w) => w.well === 'A23')).toMatchObject({
        subject: 'ent_stauro',
        concentration: { value: '1', unit: 'uM' },
      });
    }
    expect(wellsOf(plates[0] as never, 'compound')).toHaveLength(320);
    expect(wellsOf(plates[1] as never, 'compound')).toHaveLength(80);
    expect(wellsOf(plates[1] as never, 'empty')).toHaveLength(240);
    // Column fill: the first compound in A3, the second in B3.
    expect(plates[0]?.wells.find((w) => w.well === 'B3')?.subject).toBe('cmp_2');
  });

  it('lays out an ELISA: a standard curve in duplicate, blanks, samples in duplicate', () => {
    const elisa: LayoutSpec = {
      format: p96,
      subjectRole: 'sample',
      fixed: [
        {
          role: 'standard',
          region: ['A1:G2'],
          replicates: 2,
          subject: {
            subject: 'std',
            label: 'IL-6 standard',
            series: { top: { value: '600', unit: 'pg/mL' }, factor: '2', points: 7 },
          },
        },
        { role: 'blank', region: ['H1:H2'] },
      ],
      replicates: 2,
      arrangement: 'side_by_side',
      leftover: 'empty',
    };
    const { plates } = generatePlateMap(
      elisa,
      Array.from({ length: 40 }, (_, i) => ({ subject: `smp_${i + 1}` })),
    );
    expect(plates).toHaveLength(1);
    const plate = plates[0] as (typeof plates)[number];
    expect(plate.wells.find((w) => w.well === 'A1')).toMatchObject({
      role: 'standard',
      point: 1,
      replicate: 1,
      concentration: { value: '600', unit: 'pg/mL' },
    });
    expect(plate.wells.find((w) => w.well === 'A2')).toMatchObject({ point: 1, replicate: 2 });
    expect(plate.wells.find((w) => w.well === 'G1')).toMatchObject({
      point: 7,
      concentration: { value: '9.375', unit: 'pg/mL' },
    });
    expect(wellsOf(plate, 'blank')).toEqual(['H1', 'H2']);
    expect(plate.wells.find((w) => w.well === 'A3')).toMatchObject({
      subject: 'smp_1',
      replicate: 1,
    });
    expect(plate.wells.find((w) => w.well === 'A4')).toMatchObject({
      subject: 'smp_1',
      replicate: 2,
    });
    expect(wellsOf(plate, 'sample')).toHaveLength(80);
  });

  it('randomizes within each plate reproducibly from the seed, keeping each plate its subjects', () => {
    const layout: LayoutSpec = { ...screen, strategy: 'randomized_within_plate' };
    expect(() => generatePlateMap(layout, compounds(10))).toThrow('needs a seed');
    const a = generatePlateMap(layout, compounds(400), { seed: 42 });
    const b = generatePlateMap(layout, compounds(400), { seed: 42 });
    const c = generatePlateMap(layout, compounds(400), { seed: 7 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const inOrder = generatePlateMap(screen, compounds(400));
    const subjectsOn = (m: typeof a, i: number) =>
      new Set(m.plates[i]?.wells.flatMap((w) => (w.role === 'compound' ? [w.subject] : [])));
    expect(subjectsOn(a, 1)).toEqual(subjectsOn(inOrder, 1));
    expect(a.plates[0]?.wells.find((w) => w.well === 'A3')?.subject).not.toBe('cmp_1');
  });

  it('balances subjects across plates, and puts replicates on another plate', () => {
    const balanced = generatePlateMap(
      { ...screen, strategy: 'balanced_across_plates' },
      compounds(400),
      { seed: 1 },
    );
    expect(wellsOf(balanced.plates[0] as never, 'compound')).toHaveLength(200);
    expect(wellsOf(balanced.plates[1] as never, 'compound')).toHaveLength(200);

    const twice = generatePlateMap(
      { ...screen, replicates: 2, arrangement: 'another_plate' },
      compounds(10),
    );
    expect(twice.plates).toHaveLength(2);
    expect(twice.plates[1]?.wells.find((w) => w.well === 'A3')).toMatchObject({
      subject: 'cmp_1',
      replicate: 2,
    });
  });

  it('leaves edges out, and keeps hand overrides through regeneration', () => {
    const layout: LayoutSpec = {
      format: p96,
      subjectRole: 'sample',
      edge: 'buffer',
    };
    const first = generatePlateMap(layout, compounds(60), {
      overrides: [
        { plate: 1, well: 'B7', role: 'empty', label: 'cracked well' },
        { plate: 3, well: 'A1', role: 'blank' },
      ],
    });
    const plate = first.plates[0] as (typeof first.plates)[number];
    expect(wellsOf(plate, 'buffer')).toHaveLength(36);
    expect(plate.wells.find((w) => w.well === 'B2')?.subject).toBe('cmp_1');
    expect(plate.wells.find((w) => w.well === 'B7')).toMatchObject({
      role: 'empty',
      label: 'cracked well',
      override: true,
    });
    expect(first.staleOverrides).toEqual([{ plate: 3, well: 'A1', role: 'blank' }]);
  });

  it('refuses overlapping regions and replicates that do not fit', () => {
    expect(() =>
      generatePlateMap(
        {
          format: p96,
          subjectRole: 'sample',
          fixed: [
            { role: 'blank', region: ['column 1'] },
            { role: 'standard', region: ['A1:A2'] },
          ],
        },
        compounds(1),
      ),
    ).toThrow('A1 is in both blank and standard');
    expect(() =>
      generatePlateMap(
        { format: p96, subjectRole: 'sample', subjectRegion: ['column 1'], replicates: 2 },
        compounds(1),
      ),
    ).toThrow('No room for sample wells');
  });

  it('keeps each series on one plate: 16 compounds of 10 points in duplicate per 384 plate', () => {
    const doseResponse: LayoutSpec = { ...screen, fillOrder: 'row', replicates: 2 };
    const series = { top: { value: '10', unit: 'uM' }, factor: '3', points: 10 };
    const map = generatePlateMap(
      doseResponse,
      compounds(20).map((c) => ({ ...c, series })),
    );
    expect(map.perPlate).toBe(16);
    expect(map.plates).toHaveLength(2);
    const row = map.plates[0]?.wells.filter((w) => w.well.match(/^A\d/) && w.role === 'compound');
    expect(new Set(row?.map((w) => w.subject))).toEqual(new Set(['cmp_1']));
    expect(row?.find((w) => w.well === 'A22')).toMatchObject({ point: 10, replicate: 2 });
    expect(() =>
      generatePlateMap({ format: p96, subjectRole: 'compound', subjectRegion: ['column 1'] }, [
        { subject: 'x', series: { ...series, points: 12 } },
      ]),
    ).toThrow("A series of 12 points doesn't fit");
  });

  it('draws the same numbers from the same seed', () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

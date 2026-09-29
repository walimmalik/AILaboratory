import type { LabwareTypeAttributes } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { topView, wellSection } from './labware-drawing.ts';

const mm = (value: string) => ({ value, unit: 'mm' as const });

const plate: LabwareTypeAttributes = {
  family: 'plate',
  footprint: { sbs: true, length: mm('127.76'), width: mm('85.48') },
  wells: {
    layout: 'grid',
    rows: 8,
    columns: 12,
    pitch: mm('9'),
    a1: { x: mm('14.38'), y: mm('11.24') },
    well: { top: { shape: 'circular', diameter: mm('6.86') }, depth: mm('10.67'), bottom: 'flat' },
  },
  maxVolume: { value: '360', unit: 'uL' },
};

describe('top view', () => {
  it('draws what the record gives, with nothing filled in', () => {
    const view = topView(plate);
    if ('missing' in view) throw new Error(view.missing);
    expect(view).toMatchObject({ sizeDrawn: false, positionsDrawn: false, wellSizeDrawn: false });
    expect(view.wells).toHaveLength(96);
    expect(view.wells.at(-1)).toMatchObject({ name: 'H12', x: 113.38, y: 74.24, xSize: 6.86 });
    expect(view.notes).toEqual([]);
  });

  it('fills in an SBS size and spacing on a draft, and says so', () => {
    const view = topView({
      family: 'tip_rack',
      footprint: { sbs: true },
      wells: { layout: 'grid', rows: 16, columns: 24 },
    });
    if ('missing' in view) throw new Error(view.missing);
    expect(view).toMatchObject({
      length: 127.76,
      sizeDrawn: true,
      positionsDrawn: true,
      pitch: 4.5,
    });
    // 24 columns at 4.5 mm, centred on 127.76 mm.
    expect(view.wells[0]?.x).toBeCloseTo((127.76 - 23 * 4.5) / 2, 6);
    expect(view.notes.join(' ')).toContain('4.5 mm apart');
  });

  it('refuses to guess the size of labware that is not SBS', () => {
    expect(topView({ family: 'reservoir', footprint: { sbs: false } })).toEqual({
      missing: 'Add the outer length and width to draw it.',
    });
  });
});

describe('well section', () => {
  it('shows how far the maximum volume fills a flat well', () => {
    const section = wellSection(plate);
    if ('missing' in section) throw new Error(section.missing);
    expect(section.fill?.volume).toBe('360 µL');
    expect(section.fill?.height).toBeCloseTo(360 / (Math.PI * 3.43 ** 2), 6);
  });

  it('draws round and V wells without a liquid height', () => {
    const section = wellSection({
      ...plate,
      wells: {
        layout: 'grid',
        rows: 8,
        columns: 12,
        well: { top: { shape: 'circular', diameter: mm('6') }, depth: mm('11'), bottom: 'v' },
      },
    });
    if ('missing' in section) throw new Error(section.missing);
    expect(section.fill).toBeUndefined();
    expect(section.notes).toContain('Liquid height is worked out for flat-bottomed wells only.');
  });
});

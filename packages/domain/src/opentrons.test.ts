import { OpentronsDefinition } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { fromOpentrons, loadNameFor, toOpentrons } from './opentrons.ts';

/** Shaped like Opentrons' corning_96_wellplate_360ul_flat definition (values rounded for the test). */
function corning96(): OpentronsDefinition {
  const rows = 'ABCDEFGH'.split('');
  const ordering = Array.from({ length: 12 }, (_, c) => rows.map((r) => `${r}${c + 1}`));
  const wells: OpentronsDefinition['wells'] = {};
  ordering.forEach((column, c) => {
    column.forEach((name, r) => {
      wells[name] = {
        depth: 10.67,
        totalLiquidVolume: 360,
        shape: 'circular',
        diameter: 6.86,
        x: Number((14.38 + 9 * c).toFixed(2)),
        y: Number((74.24 - 9 * r).toFixed(2)),
        z: 3.55,
      };
    });
  });
  return OpentronsDefinition.parse({
    schemaVersion: 2,
    version: 2,
    namespace: 'opentrons',
    metadata: {
      displayName: 'Corning 96 Well Plate 360 µL Flat',
      displayCategory: 'wellPlate',
      displayVolumeUnits: 'µL',
      tags: [],
    },
    brand: { brand: 'Corning', brandId: ['3650', '3590', '3591'] },
    parameters: {
      format: '96Standard',
      isTiprack: false,
      loadName: 'corning_96_wellplate_360ul_flat',
      isMagneticModuleCompatible: false,
    },
    ordering,
    cornerOffsetFromSlot: { x: 0, y: 0, z: 0 },
    dimensions: { xDimension: 127.76, yDimension: 85.47, zDimension: 14.22 },
    wells,
    groups: [{ metadata: { wellBottomShape: 'flat' }, wells: ordering.flat() }],
  });
}

const mm = (value: string) => ({ value, unit: 'mm' });

describe('Opentrons import', () => {
  it('reads a plate as a grid, measuring y from the back edge', () => {
    const imported = fromOpentrons(corning96());
    expect(imported.label).toBe('Corning 96 Well Plate 360 µL Flat');
    expect(imported.brand).toBe('Corning');
    expect(imported.attributes).toEqual({
      family: 'plate',
      catalogNumber: '3650',
      otherCatalogNumbers: ['3590', '3591'],
      footprint: { sbs: true, length: mm('127.76'), width: mm('85.47'), height: mm('14.22') },
      wells: {
        layout: 'grid',
        rows: 8,
        columns: 12,
        pitch: mm('9'),
        a1: { x: mm('14.38'), y: mm('11.23') },
        well: {
          top: { shape: 'circular', diameter: mm('6.86') },
          depth: mm('10.67'),
          bottom: 'flat',
        },
      },
      maxVolume: { value: '360', unit: 'uL' },
      opentronsLoadName: 'corning_96_wellplate_360ul_flat',
    });
  });

  it('lists irregular wells one by one', () => {
    const definition = corning96();
    (definition.wells.B1 as { y: number }).y = 60;
    const { attributes } = fromOpentrons(definition);
    expect(attributes.wells?.layout).toBe('explicit');
    if (attributes.wells?.layout !== 'explicit') return;
    expect(attributes.wells.wells).toHaveLength(96);
    expect(attributes.wells.wells[1]).toMatchObject({ name: 'B1', y: mm('25.47') });
  });

  it('refuses definitions that are not labware', () => {
    const trash = {
      ...corning96(),
      metadata: { ...corning96().metadata, displayCategory: 'trash' },
    };
    expect(() => fromOpentrons(trash)).toThrow('"trash" definitions can\'t be imported');
    expect(OpentronsDefinition.safeParse({ ...corning96(), schemaVersion: 3 }).success).toBe(false);
  });
});

describe('Opentrons export', () => {
  it('round-trips an imported definition', () => {
    const original = corning96();
    const imported = fromOpentrons(original);
    const exported = toOpentrons(imported.attributes, { label: imported.label, brand: 'Corning' });
    expect(exported.wells.H12).toEqual(original.wells.H12);
    expect(exported.ordering).toEqual(original.ordering);
    expect(exported.dimensions).toEqual(original.dimensions);
    expect(exported.parameters).toMatchObject({
      format: '96Standard',
      loadName: original.parameters.loadName,
    });
    expect(fromOpentrons(exported).attributes).toEqual(imported.attributes);
  });

  it('names what is missing before it can export', () => {
    expect(() =>
      toOpentrons(
        { family: 'plate', wells: { layout: 'grid', rows: 8, columns: 12 } },
        { label: 'X' },
      ),
    ).toThrow(
      "Can't export yet: outer size, maximum volume, well positions, well size and depth missing",
    );
    expect(() => toOpentrons({ family: 'lid' }, { label: 'Lid' })).toThrow(
      "can't be exported on its own",
    );
  });

  it('makes load names from labels', () => {
    expect(loadNameFor('Corning 96 Well Plate 360 µL Flat')).toBe(
      'corning_96_well_plate_360_ul_flat',
    );
  });
});

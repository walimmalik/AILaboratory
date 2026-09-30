import {
  compare,
  formatQuantity,
  gridFitProblem,
  LabwareError,
  sbsFootprintProblem,
  sbsPitch,
  sbsPositions,
  wellCapacity,
} from '@ailab/domain';
import {
  defineKind,
  type KindCheck,
  LabwareTypeAttributes,
  type LiquidVolume,
  VendorAttributes,
} from '@ailab/schema';

/** A manufacturer or supplier; labware, instruments and reagents point at it. */
export const vendor = defineKind({
  kind: 'vendor',
  idPrefix: 'vnd',
  namePrefix: 'VND',
  nameWidth: 4,
  attributes: VendorAttributes,
});

type Attributes = LabwareTypeAttributes;

const LIBRARY = 'Labware library (plan 007)';
const holdsLiquid = (a: Attributes) =>
  a.family === 'plate' || a.family === 'reservoir' || a.family === 'tube';

const volume = (v: LiquidVolume) => `${v.value} ${v.unit === 'uL' ? 'µL' : v.unit}`;

const checks: KindCheck<Attributes>[] = [
  {
    id: 'footprint_known',
    label: 'Outer size is known',
    severity: 'blocker',
    source: `${LIBRARY}: needed to place it on a deck or in a rack`,
    section: 'geometry',
    fix: 'Add the length, width and height (for tubes: diameter and height) from the datasheet',
    test: (a) => {
      const f = a.footprint;
      if (a.family === 'tube') {
        return f?.diameter && f.height ? true : 'Diameter or height is missing';
      }
      return f?.length && f.width && f.height ? true : 'Length, width or height is missing';
    },
  },
  {
    id: 'wells_known',
    label: 'Wells are laid out',
    severity: 'blocker',
    source: `${LIBRARY}: plate maps and transfers address wells by name`,
    section: 'geometry',
    fix: 'Give the rows and columns, or list each well',
    applies: (a) => a.family !== 'lid',
    test: (a) => a.wells !== undefined || 'No well layout',
  },
  {
    id: 'max_volume_known',
    label: 'Maximum volume is known',
    severity: 'blocker',
    source: `${LIBRARY}: transfers check that liquid fits`,
    section: 'volumes',
    fix: 'Add the well volume (for tip racks, the tip volume) from the datasheet',
    applies: (a) => a.family !== 'lid' && a.family !== 'rack',
    test: (a) => a.maxVolume !== undefined || 'Not given',
  },
  {
    id: 'sbs_pitch',
    label: 'Well spacing follows the SBS standard',
    severity: 'blocker',
    source: 'ANSI/SLAS 4-2004 (microplate well positions)',
    section: 'geometry',
    fix: 'Check the pitch on the datasheet, or untick SBS if it is not an SBS plate',
    applies: (a) => a.family !== 'tube',
    test: (a) => {
      const w = a.wells;
      if (!a.footprint?.sbs || w?.layout !== 'grid' || !w.pitch) return true;
      const standard = sbsPitch(w.rows, w.columns);
      if (standard === undefined || Math.abs(Number(w.pitch.value) - standard) < 0.05) return true;
      return `${w.rows} × ${w.columns} wells should be ${standard} mm apart, not ${w.pitch.value} mm`;
    },
  },
  {
    id: 'volumes_consistent',
    label: 'Volumes fit together',
    severity: 'blocker',
    source: LIBRARY,
    section: 'volumes',
    fix: 'Dead and working volumes must fit inside the maximum volume',
    test: (a) => {
      const { maxVolume: max, deadVolume: dead, workingVolume: working } = a;
      if (max && dead && compare(dead, max) >= 0) {
        return `Dead volume ${volume(dead)} is not less than the maximum ${volume(max)}`;
      }
      if (max && working?.max && compare(working.max, max) > 0) {
        return `Working volume ${volume(working.max)} is more than the maximum ${volume(max)}`;
      }
      if (working?.min && working.max && compare(working.min, working.max) > 0) {
        return 'The working range runs backwards';
      }
      return true;
    },
  },
  {
    id: 'sbs_footprint',
    label: 'Outer size matches the SBS footprint',
    severity: 'warning',
    source: 'ANSI/SLAS 1-2004 (microplate footprint)',
    section: 'geometry',
    fix: 'Check the length and width, or untick SBS',
    applies: (a) => a.family !== 'tube',
    test: (a) => (a.footprint && sbsFootprintProblem(a.footprint)) ?? true,
  },
  {
    id: 'wells_placed',
    label: 'Well positions are known',
    severity: 'warning',
    source: `${LIBRARY}: robots and plate map drawings need them`,
    section: 'geometry',
    fix: 'Add the pitch and the A1 offset from the left and back edges (datasheet drawing)',
    // A tube is its own single well; lids have none.
    applies: (a) => a.family !== 'tube' && a.family !== 'lid',
    test: (a) => {
      const w = a.wells;
      if (w?.layout !== 'grid') return true;
      const single = w.rows === 1 && w.columns === 1;
      return w.a1 && (w.pitch || single) ? true : 'Pitch or A1 offset is missing';
    },
    quickFix: {
      operation: 'labware.use_standard_positions',
      label: 'Use the standard SBS positions',
      // Offered when the standard places this grid and any pitch already given agrees with it.
      applies: (a) => {
        const w = a.wells;
        const standard = w?.layout === 'grid' && sbsPositions(w.rows, w.columns);
        return (
          a.footprint?.sbs === true &&
          !!standard &&
          (!w.pitch || Number(w.pitch.value) === standard.pitch)
        );
      },
    },
  },
  {
    id: 'wells_fit',
    label: 'Wells lie inside the footprint',
    severity: 'warning',
    source: LIBRARY,
    section: 'geometry',
    fix: 'Check the A1 offset, pitch and well size',
    applies: (a) => a.family !== 'tube',
    test: (a) => (a.wells && a.footprint && gridFitProblem(a.wells, a.footprint)) ?? true,
  },
  {
    id: 'well_shape_known',
    label: 'Well size and depth are known',
    severity: 'warning',
    source: `${LIBRARY}: liquid height and pipetting depth come from them`,
    section: 'geometry',
    fix: 'Add the well opening, depth and bottom shape',
    applies: holdsLiquid,
    test: (a) => {
      if (!a.wells) return true;
      const wells = a.wells.layout === 'grid' ? [a.wells.well] : a.wells.wells.map((w) => w.well);
      return wells.every((w) => w?.top && w.depth && w.bottom)
        ? true
        : 'Opening, depth or bottom is missing';
    },
  },
  {
    id: 'capacity_fits',
    label: 'Maximum volume fits the well',
    severity: 'warning',
    source: `${LIBRARY}: computed from the well size and depth`,
    section: 'volumes',
    fix: 'Check the maximum volume and the well size',
    applies: holdsLiquid,
    test: (a) => {
      if (!a.maxVolume || a.wells?.layout !== 'grid' || !a.wells.well) return true;
      let capacity: number;
      try {
        capacity = wellCapacity(a.wells.well);
      } catch (error) {
        if (error instanceof LabwareError) return true; // Not modelled: nothing to compare.
        throw error;
      }
      const max = { value: capacity.toFixed(1), unit: 'uL' };
      return compare(a.maxVolume, { value: (capacity * 1.05).toFixed(3), unit: 'uL' }) <= 0
        ? true
        : `${volume(a.maxVolume)} is more than the ${volume(max as LiquidVolume)} the well holds`;
    },
  },
  {
    id: 'dead_volume_known',
    label: 'Dead volume is known',
    severity: 'warning',
    source: `${LIBRARY}: digital SOPs add it to what they prepare`,
    section: 'volumes',
    fix: 'Add the dead volume from the datasheet or from your own measurements',
    applies: holdsLiquid,
    test: (a) => a.deadVolume !== undefined || 'Not given',
  },
  {
    id: 'tip_known',
    label: 'Tip length is known',
    severity: 'warning',
    source: `${LIBRARY}: needed for pipetting heights`,
    section: 'geometry',
    fix: 'Add the tip length from the datasheet',
    applies: (a) => a.family === 'tip_rack',
    test: (a) => a.tip?.length !== undefined || 'Not given',
  },
  {
    id: 'catalog_known',
    label: 'Manufacturer and catalog number are known',
    severity: 'warning',
    source: `${LIBRARY}: needed to order it and to match it to a datasheet`,
    section: 'identity',
    fix: 'Add the manufacturer and their catalog number',
    test: (a) =>
      a.manufacturer && a.catalogNumber ? true : 'Manufacturer or catalog number is missing',
  },
];

/**
 * What each family is not asked for: a tube is its own well (no grid spacing, A1 offset or SBS size),
 * a rack holds tubes rather than liquid, a tip rack holds tips, a lid has no wells.
 */
const notApplicable: Record<Attributes['family'], string[]> = {
  plate: ['footprint.diameter', 'tip'],
  reservoir: ['footprint.diameter', 'tip'],
  tube: [
    'footprint.sbs',
    'footprint.length',
    'footprint.width',
    'wells.pitch',
    'wells.a1',
    'wells.topHeight',
    'tip',
    'echoPlateTypes',
  ],
  rack: ['footprint.diameter', 'tip', 'maxVolume', 'workingVolume', 'deadVolume', 'echoPlateTypes'],
  tip_rack: ['footprint.diameter', 'workingVolume', 'deadVolume', 'echoPlateTypes'],
  lid: [
    'footprint.diameter',
    'wells',
    'tip',
    'maxVolume',
    'workingVolume',
    'deadVolume',
    'echoPlateTypes',
  ],
};

/** A labware type (ADR 0023): the kind of a plate, reservoir, tube, rack, tip rack or lid. */
export const labwareType = defineKind({
  kind: 'labware_type',
  idPrefix: 'lwt',
  namePrefix: 'LWT',
  nameWidth: 4,
  attributes: LabwareTypeAttributes,
  links: (a) => (a.manufacturer ? [{ toId: a.manufacturer, relation: 'made_by' }] : []),
  // "96 wells, 360 µL, sterile, TC-treated" (ADR 0050).
  summarize: (a) => {
    const wells =
      a.wells?.layout === 'grid'
        ? a.wells.rows * a.wells.columns
        : a.wells?.layout === 'explicit'
          ? a.wells.wells.length
          : undefined;
    return [
      wells === undefined
        ? a.family.replaceAll('_', ' ')
        : `${wells} ${wells === 1 ? 'well' : 'wells'}`,
      a.maxVolume && formatQuantity(a.maxVolume),
      a.sterile && 'sterile',
      a.surface,
    ]
      .filter(Boolean)
      .join(', ');
  },
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: [
        'family',
        'manufacturer',
        'catalogNumber',
        'otherCatalogNumbers',
        'pack',
        'material',
        'color',
        'surface',
        'sterile',
        'notes',
      ],
    },
    { id: 'geometry', title: 'Geometry', fields: ['footprint', 'wells', 'tip'] },
    { id: 'volumes', title: 'Volumes', fields: ['maxVolume', 'workingVolume', 'deadVolume'] },
    {
      id: 'instruments',
      title: 'Instrument names',
      fields: ['opentronsLoadName', 'hamiltonLabware', 'echoPlateTypes'],
    },
  ],
  checks,
  notApplicable: (a) => notApplicable[a.family] ?? [],
});

export const labwareKinds = [vendor, labwareType];

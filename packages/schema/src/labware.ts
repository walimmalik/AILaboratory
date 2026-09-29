import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { DecimalString } from './quantity.ts';

/**
 * Labware types (plan 007, ADR 0023): the kind of every plate, reservoir, tube, rack, tip rack and lid
 * the lab uses. Physical plates and what is in them belong to inventory (plan 010).
 *
 * Each top-level attribute carries its own evidence and sits in one review section, so values that
 * come from different sources (a datasheet footprint, an estimated dead volume) are separate attributes.
 */

/** A length in millimetres: all labware geometry uses mm. */
export const Millimetres = z.strictObject({ value: DecimalString, unit: z.literal('mm') });
export type Millimetres = z.infer<typeof Millimetres>;

/** A liquid volume in a volume unit. */
export const LiquidVolume = z.strictObject({
  value: DecimalString,
  unit: z.enum(['L', 'mL', 'uL', 'nL']),
});
export type LiquidVolume = z.infer<typeof LiquidVolume>;

export const LabwareFamily = z
  .enum(['plate', 'reservoir', 'tube', 'rack', 'tip_rack', 'lid'])
  .describe('plate, reservoir, tube, rack (holds tubes), tip_rack or lid');
export type LabwareFamily = z.infer<typeof LabwareFamily>;

/** Canonical well names: row letters A to AF, then the column number without padding (A1, P24, AF48). */
export const WellName = z
  .string()
  .regex(/^(?:[A-Z]|A[A-F])(?:[1-9]|[1-3]\d|4[0-8])$/, 'must be a well name like A1, P24 or AF48');

/** The opening of a well (or its base, for tapered wells). Square and rounded-square wells are rectangular. */
export const WellSection = z.discriminatedUnion('shape', [
  z.strictObject({ shape: z.literal('circular'), diameter: Millimetres }),
  z.strictObject({ shape: z.literal('rectangular'), xSize: Millimetres, ySize: Millimetres }),
]);
export type WellSection = z.infer<typeof WellSection>;

export const WellBottom = z
  .enum(['flat', 'round', 'v'])
  .describe('flat, round (U) or v (conical or pyramidal)');

/** One well's shape. Parts may be unknown on a draft; readiness says what is missing. */
export const WellGeometry = z.strictObject({
  top: WellSection.optional().describe('The opening at the top of the well'),
  base: WellSection.optional().describe(
    'The size at the bottom, for tapered wells; same shape as top',
  ),
  depth: Millimetres.optional().describe('From the top of the well to its lowest point'),
  bottom: WellBottom.optional(),
});
export type WellGeometry = z.infer<typeof WellGeometry>;

/** Positions are well centres, measured from the left edge (x) and the back edge (y) of the footprint. */
const Position = { x: Millimetres, y: Millimetres };

const TopHeight = Millimetres.optional().describe(
  'Height of the well opening above the bottom of the labware, when it is not the full height',
);

export const WellLayout = z.discriminatedUnion('layout', [
  z
    .strictObject({
      layout: z.literal('grid'),
      rows: z.number().int().min(1).max(32),
      columns: z.number().int().min(1).max(48),
      pitch: Millimetres.optional().describe(
        'Centre-to-centre distance, the same across rows and columns',
      ),
      a1: z
        .strictObject(Position)
        .optional()
        .describe('Centre of A1 from the left edge (x) and the back edge (y)'),
      topHeight: TopHeight,
      well: WellGeometry.optional(),
    })
    .describe('A regular grid, as a datasheet gives it'),
  z
    .strictObject({
      layout: z.literal('explicit'),
      wells: z
        .array(
          z.strictObject({ name: WellName, ...Position, topHeight: TopHeight, well: WellGeometry }),
        )
        .min(1),
    })
    .describe('Every well listed, for irregular reservoirs and racks'),
]);
export type WellLayout = z.infer<typeof WellLayout>;

export const Footprint = z.strictObject({
  sbs: z.boolean().describe('Follows the ANSI/SLAS microplate footprint (127.76 x 85.48 mm)'),
  length: Millimetres.optional().describe('Left to right (x)'),
  width: Millimetres.optional().describe('Back to front (y)'),
  height: Millimetres.optional().describe('Overall height, e.g. a tube with its cap'),
  diameter: Millimetres.optional().describe('Outer diameter, for tubes'),
});
export type Footprint = z.infer<typeof Footprint>;

export const TipSpec = z.strictObject({
  length: Millimetres.optional(),
  filtered: z.boolean().optional(),
  conductive: z
    .boolean()
    .optional()
    .describe('Conductive tips allow capacitive liquid-level detection'),
});

export const LabwareTypeAttributes = z.strictObject({
  family: LabwareFamily,
  manufacturer: recordIdOf('vnd').optional().describe('The vendor record of the manufacturer'),
  catalogNumber: z.string().min(1).optional().describe("The manufacturer's catalog number"),
  otherCatalogNumbers: z
    .array(z.string().min(1))
    .optional()
    .describe('Equivalent numbers, e.g. other pack sizes or distributors'),
  pack: z.string().min(1).optional().describe('How it is sold, e.g. "10 per bag, 50 per case"'),
  material: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  surface: z
    .string()
    .min(1)
    .optional()
    .describe('Surface treatment, e.g. "TC-treated", "High Bind"'),
  sterile: z.boolean().optional(),
  footprint: Footprint.optional(),
  wells: WellLayout.optional(),
  tip: TipSpec.optional().describe('Tip racks only: the tips it holds'),
  maxVolume: LiquidVolume.optional().describe('What one well (or tip) holds when full'),
  workingVolume: z
    .strictObject({ min: LiquidVolume.optional(), max: LiquidVolume.optional() })
    .optional()
    .describe('The range the manufacturer recommends'),
  deadVolume: LiquidVolume.optional().describe(
    'What stays behind when a well is emptied by pipetting',
  ),
  opentronsLoadName: z
    .string()
    .regex(/^[a-z0-9_.]+$/, 'must be an Opentrons load name like corning_96_wellplate_360ul_flat')
    .optional(),
  hamiltonLabware: z
    .string()
    .min(1)
    .optional()
    .describe('The name of the lab\'s existing Hamilton labware definition, e.g. "STF_L"'),
  echoPlateTypes: z
    .array(z.string().regex(/^[A-Za-z0-9_]+$/))
    .optional()
    .describe('Echo plate type and calibration names, e.g. "384PP_DMSO2"'),
  notes: z.string().min(1).optional(),
});
export type LabwareTypeAttributes = z.infer<typeof LabwareTypeAttributes>;

/** A manufacturer or supplier (shared with instruments and reagents). */
export const VendorAttributes = z.strictObject({
  website: z.url().optional(),
});
export type VendorAttributes = z.infer<typeof VendorAttributes>;

/** One well as computed from a type's layout, for rendering, plate maps and exports. */
export const ComputedWell = z.object({
  name: WellName,
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  x: Millimetres.optional(),
  y: Millimetres.optional(),
  topHeight: Millimetres.optional(),
  well: WellGeometry.optional(),
});
export type ComputedWell = z.infer<typeof ComputedWell>;

const OpentronsWell = z.looseObject({
  depth: z.number().nonnegative(),
  totalLiquidVolume: z.number().nonnegative(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  shape: z.enum(['circular', 'rectangular']),
  diameter: z.number().positive().optional(),
  xDimension: z.number().positive().optional(),
  yDimension: z.number().positive().optional(),
});

/** An Opentrons labware definition (schema version 2), as published in Opentrons shared-data. */
export const OpentronsDefinition = z.looseObject({
  schemaVersion: z.literal(2, 'only Opentrons labware schema version 2 is supported'),
  version: z.number().int().positive(),
  namespace: z.string().min(1),
  metadata: z.looseObject({
    displayName: z.string().min(1),
    displayCategory: z.string().min(1),
    displayVolumeUnits: z.string().min(1),
  }),
  brand: z.looseObject({ brand: z.string().min(1), brandId: z.array(z.string()) }),
  parameters: z.looseObject({
    format: z.string().min(1),
    isTiprack: z.boolean(),
    tipLength: z.number().positive().optional(),
    loadName: z.string().min(1),
    isMagneticModuleCompatible: z.boolean(),
  }),
  ordering: z.array(z.array(z.string()).min(1)).min(1),
  cornerOffsetFromSlot: z.looseObject({ x: z.number(), y: z.number(), z: z.number() }),
  dimensions: z.looseObject({
    xDimension: z.number().positive(),
    yDimension: z.number().positive(),
    zDimension: z.number().positive(),
  }),
  wells: z.record(z.string(), OpentronsWell),
  groups: z.array(
    z.looseObject({
      metadata: z.looseObject({ wellBottomShape: z.enum(['flat', 'u', 'v']).optional() }),
      wells: z.array(z.string()),
    }),
  ),
});
export type OpentronsDefinition = z.infer<typeof OpentronsDefinition>;

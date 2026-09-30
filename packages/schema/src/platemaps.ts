import { z } from 'zod';
import { RecordId, recordIdOf } from './ids.ts';
import { DecimalString, Quantity } from './quantity.ts';

/**
 * Layout templates and plate maps (plan 014, ADR 0043). A layout is the lab's reusable pattern:
 * which roles go where, replicates, fill order, placement strategy, edges and leftovers. It never
 * names the samples; a plate map applies it to real subjects.
 */

export const LayoutId = recordIdOf('lyt');
export const PlateMapId = recordIdOf('pmp');

const LocalName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'a short name like dmso or std')
  .max(40);

/** What a well is for (fixed vocabulary; a free label says anything lab-specific). */
export const WellRole = z.enum([
  'sample',
  'compound',
  'standard',
  'blank',
  'neutral_control',
  'positive_control',
  'negative_control',
  'reference',
  'buffer',
  'empty',
  'other',
]);
export type WellRole = z.infer<typeof WellRole>;

export const PlateWells = z.union([
  z.literal(6),
  z.literal(12),
  z.literal(24),
  z.literal(48),
  z.literal(96),
  z.literal(384),
  z.literal(1536),
]);

export const Region = z
  .array(z.string().min(1))
  .min(1)
  .describe('Wells in lab words, e.g. ["columns 1-2"], ["A1:G2"], ["H1:H2"], ["rows A-B"]');

/** A dilution series (M2): what the map expands into one well per point. */
export const Series = z.strictObject({
  top: Quantity.describe('The highest concentration, e.g. 10 µM'),
  factor: DecimalString.describe('Fold between points, e.g. "3" for 3-fold'),
  points: z.number().int().min(1).max(48),
  direction: z.enum(['down', 'up']).optional().describe('down (default): top first'),
});
export type Series = z.infer<typeof Series>;

/** A region repeated on every plate: controls, blanks, a standard curve (M3). */
export const FixedRegion = z.strictObject({
  id: LocalName,
  role: WellRole,
  label: z.string().min(1).optional().describe('e.g. "DMSO" or "IL-6 standard"'),
  region: Region,
  subject: RecordId.optional().describe('A standing control, e.g. the staurosporine entity'),
  concentration: Quantity.optional(),
  series: Series.optional().describe('A standard curve, point by point'),
  replicates: z.number().int().min(1).max(8).optional(),
});
export type FixedRegion = z.infer<typeof FixedRegion>;

const Placement = {
  replicates: z.number().int().min(1).max(8).optional().describe('Wells per subject (default 1)'),
  arrangement: z
    .enum(['side_by_side', 'down_column', 'another_plate'])
    .optional()
    .describe('Where replicates go (default side by side)'),
  fillOrder: z.enum(['row', 'column']).optional().describe('A1, A2… or A1, B1… (default row)'),
  strategy: z
    .enum(['in_order', 'randomized_within_plate', 'balanced_across_plates'])
    .optional()
    .describe('Default in order; the others store a seed on the plate map'),
  edge: z
    .enum(['use', 'empty', 'buffer'])
    .optional()
    .describe('Whether subjects may use the outer wells (default use)'),
  leftover: z
    .enum(['empty', 'neutral_control', 'buffer'])
    .optional()
    .describe('What fills subject wells left over on a plate (default empty)'),
};

/** How analysis (020) groups wells (M6). */
export const AnalysisGroup = z.strictObject({
  id: LocalName,
  label: z.string().min(1).describe('e.g. "Curve per compound" or "Z\' per plate"'),
  roles: z.array(WellRole).min(1),
  by: z
    .enum(['subject', 'subject_and_point', 'plate'])
    .describe('One group per subject, per subject and series point, or per plate'),
});

export const LayoutAttributes = z.strictObject({
  wells: PlateWells.describe('Plate format by well count; a layout is for one format (M4)'),
  subjectRole: WellRole.describe('What the subjects are, e.g. sample or compound'),
  subjectRegion: Region.optional().describe('Where subjects go; default every well not fixed'),
  subjectConcentration: Quantity.optional().describe('Single point, e.g. 10 µM'),
  subjectSeries: Series.optional().describe('Each subject as a series, e.g. 10-point 3-fold'),
  fixed: z.array(FixedRegion).optional(),
  ...Placement,
  wellVolume: Quantity.optional().describe('Final volume per well'),
  groups: z.array(AnalysisGroup).optional(),
  assays: z.array(z.string().min(1)).optional().describe('Assays it is for, e.g. ELISA'),
  notes: z.string().min(1).optional(),
});
export type LayoutAttributes = z.infer<typeof LayoutAttributes>;

/** One planned well (P2): what goes in, not how it gets there. */
export const WellPlan = z.object({
  well: z.string(),
  role: z.string(),
  subject: z.string().optional(),
  label: z.string().optional(),
  replicate: z.number().int().optional(),
  point: z.number().int().optional(),
  concentration: Quantity.optional(),
  override: z.literal(true).optional(),
});
export type WellPlan = z.infer<typeof WellPlan>;

export const PlatePlan = z.object({ plate: z.number().int(), wells: z.array(WellPlan) });
export type PlatePlan = z.infer<typeof PlatePlan>;

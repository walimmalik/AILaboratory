import { z } from 'zod';
import { recordIdOf } from './ids.ts';

/**
 * Worklist formats (plan 016 T1, 016c): the CSV a lab's own instrument method reads (a Hamilton
 * Venus method, the Mantis or PreciseDrop software), as a record drafted from an example file and
 * confirmed by a person. One generic writer fills it from a transfer plan group; a new lab method
 * is a new format record, not a code change. Echo and Opentrons formats are the vendors', so they
 * are code.
 */

export const WorklistFormatId = recordIdOf('wlf');

export const WorklistValue = z
  .enum([
    'row_number',
    'source_name',
    'source_barcode',
    'source_labware',
    'source_type',
    'source_well',
    'destination_name',
    'destination_barcode',
    'destination_labware',
    'destination_type',
    'destination_well',
    'volume',
    'volume_unit',
    'liquid_class',
    'liquid',
    'new_tip',
    'constant',
  ])
  .describe(
    "What goes in it: row_number (1, 2…), the plate's name in the plan, barcode (its container), labware (the type's name in the instrument's software, e.g. the Hamilton labware), type (the labware type's name), well; volume in the format's unit; volume_unit; liquid_class (its platform name); liquid (the group's liquid, else the source plate's name); new_tip; constant (the text given)",
  );
export type WorklistValue = z.infer<typeof WorklistValue>;

export const WellNaming = z
  .enum(['name', 'index_by_column', 'index_by_row'])
  .describe(
    'A1; or the position counted from 1 down each column (A1, B1…) or along each row (A1, A2…)',
  );
export type WellNaming = z.infer<typeof WellNaming>;

export const WorklistColumn = z.strictObject({
  header: z.string().min(1).max(200),
  value: WorklistValue,
  text: z.string().max(200).optional().describe('For constant: the text written'),
  wells: WellNaming.optional().describe('For wells: how they are named (name when left out)'),
  yes: z
    .string()
    .max(20)
    .optional()
    .describe('For new_tip: what a new tip reads as (1 when left out)'),
  no: z
    .string()
    .max(20)
    .optional()
    .describe('For new_tip: what no new tip reads as (0 when left out)'),
});
export type WorklistColumn = z.infer<typeof WorklistColumn>;

export const WorklistLayout = z.discriminatedUnion('layout', [
  z
    .strictObject({
      layout: z.literal('rows'),
      columns: z.array(WorklistColumn).min(1).max(40),
    })
    .describe('A header row, then one row per transfer in plan order'),
  z
    .strictObject({
      layout: z.literal('grid'),
      preamble: z
        .array(WorklistColumn)
        .max(20)
        .describe('Lines before the grid: the header, then the value, e.g. "Reagent,<liquid>"'),
      empty: z.string().max(20).describe('What a well that gets nothing reads as, e.g. 0'),
    })
    .describe(
      "One volume grid per destination plate and source well (one reagent): a row of column numbers, then a row per plate row with that row's letter",
    ),
]);
export type WorklistLayout = z.infer<typeof WorklistLayout>;

export const WorklistFormatAttributes = z.strictObject({
  instrumentKind: recordIdOf('ink').describe('The instrument kind whose method reads it'),
  method: z
    .string()
    .min(1)
    .describe('The lab\'s method or software that reads it, e.g. "Venus ELISA sample transfer"'),
  layout: WorklistLayout,
  volumeUnit: z.enum(['nL', 'uL', 'mL']),
  tips: z
    .enum(['none', 'new_each', 'per_source', 'column'])
    .describe(
      "How the method handles tips (T5): none (non-contact), a new tip every row, one tip per source, or as the file's new_tip column says (then the plan's tip rule fills it)",
    ),
  example: recordIdOf('fil').optional().describe('The example file it was drafted from'),
  notes: z.string().min(1).optional(),
});
export type WorklistFormatAttributes = z.infer<typeof WorklistFormatAttributes>;

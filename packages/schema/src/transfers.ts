import { z } from 'zod';
import { pinOf } from './design.ts';
import { recordIdOf } from './ids.ts';
import { LocalId } from './instruments.ts';
import { ContainerId } from './inventory.ts';
import { LiquidVolume, WellName } from './labware.ts';
import { LiquidClassId } from './liquids.ts';
import { PlateMapId } from './platemaps.ts';
import { Quantity } from './quantity.ts';
import { LiquidTypeId } from './reagents.ts';

/**
 * Transfer plans (plan 016, T1): how the liquid gets from source containers to target plates, as
 * concrete transfers grouped by method and instrument, each group with the reason it was chosen.
 * Code checks every volume; confirmed plans soft-reserve what they draw (010 V8).
 */

export const TransferPlanId = recordIdOf('tfp');

/** A plate, reservoir or tube the plan uses, by the plan's own short name. */
export const PlanPlate = z.strictObject({
  id: LocalId.describe('The name transfers use for it, e.g. "src1" or "assay1"'),
  label: z.string().min(1).optional().describe('How it reads, e.g. "Compound source plate"'),
  role: z
    .enum(['source', 'destination', 'intermediate'])
    .describe('Drawn from; filled; or made by the plan and then drawn from'),
  labwareType: pinOf(recordIdOf('lwt')),
  container: ContainerId.optional().describe(
    'The container in inventory: sources are picked on the day (P5); new plates get one when made',
  ),
  plateMap: z
    .strictObject({ map: pinOf(PlateMapId), plate: z.number().int().min(1) })
    .optional()
    .describe('The plate of a plate map this plate is'),
});
export type PlanPlate = z.infer<typeof PlanPlate>;

export const PlanWell = z.strictObject({ plate: LocalId, well: WellName });
export type PlanWell = z.infer<typeof PlanWell>;

export const PlannedTransfer = z.strictObject({
  from: PlanWell,
  to: PlanWell,
  volume: LiquidVolume,
});
export type PlannedTransfer = z.infer<typeof PlannedTransfer>;

export const TransferMethod = z.enum([
  'direct_dispense',
  'backfill',
  'intermediate_prep',
  'serial_dilution',
  'stamp',
  'cherry_pick',
  'reagent_addition',
  'pooling',
  'reformat',
]);
export type TransferMethod = z.infer<typeof TransferMethod>;

/** The device limits a group was worked out against, copied from the instrument by code. */
export const DeviceSnapshot = z.strictObject({
  label: z.string(),
  min: Quantity.optional(),
  max: Quantity.optional(),
  step: Quantity.optional(),
});
export type DeviceSnapshot = z.infer<typeof DeviceSnapshot>;

/** One group of transfers: one method on one instrument (or by hand), in the order they run. */
export const TransferGroup = z.strictObject({
  id: LocalId,
  label: z.string().min(1).describe('In lab words, e.g. "Echo: compounds into assay plates"'),
  method: TransferMethod,
  instrument: z
    .strictObject({ instrument: recordIdOf('ins'), node: LocalId.optional() })
    .optional()
    .describe('Left out when a person pipettes by hand'),
  device: DeviceSnapshot.optional().describe('Set by code from the instrument'),
  reason: z.string().min(1).describe('Why this method and instrument'),
  alternatives: z
    .array(z.strictObject({ option: z.string().min(1), why: z.string().min(1) }))
    .optional()
    .describe('What else was considered and why not'),
  liquid: LiquidTypeId.optional(),
  liquidClass: LiquidClassId.optional(),
  tips: z.enum(['none', 'new_each', 'per_source', 'lab_default']).optional(),
  transfers: z.array(PlannedTransfer).min(1).max(20000),
});
export type TransferGroup = z.infer<typeof TransferGroup>;

export const TransferPlanAttributes = z.strictObject({
  experiment: recordIdOf('exp').optional(),
  purpose: z.string().min(1).optional(),
  plates: z.array(PlanPlate).min(1).max(200),
  groups: z.array(TransferGroup).max(100).describe('Run in this order'),
  notes: z.string().min(1).optional(),
});
export type TransferPlanAttributes = z.infer<typeof TransferPlanAttributes>;

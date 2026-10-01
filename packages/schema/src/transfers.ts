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

/** What one deck site holds: a plate of the plan, or a full tip rack of a labware type. */
export const DeckSite = z.union([
  z.strictObject({ slot: LocalId, plate: LocalId.describe("The plan's name for the plate") }),
  z.strictObject({
    slot: LocalId,
    tipRack: pinOf(recordIdOf('lwt')).describe('A full rack of this tip rack type'),
  }),
]);
export type DeckSite = z.infer<typeof DeckSite>;

/**
 * Where everything goes on the instrument for one group (T6): drafted by code, changed with
 * transfers.set_deck, and confirmed by a person as its own section of the plan. Exports and the
 * loading list read it.
 */
export const DeckLayout = z.strictObject({
  group: LocalId.describe('The group it is for'),
  sites: z.array(DeckSite).min(1).max(48),
  free: z
    .array(LocalId)
    .describe('The slots the instrument had free when the layout was set, copied by code'),
  trash: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('trash_bin'), slot: LocalId }),
      z.strictObject({ kind: z.literal('waste_chute'), slot: LocalId }),
    ])
    .describe("Where used tips go, from the instrument's configuration"),
});
export type DeckLayout = z.infer<typeof DeckLayout>;

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

export const TransferRunId = recordIdOf('trn');

/** What a rerun plan redoes (016b-2b): the exceptions of one execution of an earlier plan. */
export const RerunOf = z.strictObject({
  plan: pinOf(TransferPlanId).describe('The plan whose execution this redoes, at that version'),
  run: TransferRunId.describe('The execution whose exceptions this plan redoes'),
});
export type RerunOf = z.infer<typeof RerunOf>;

export const TransferPlanAttributes = z.strictObject({
  experiment: recordIdOf('exp').optional(),
  purpose: z.string().min(1).optional(),
  rerunOf: RerunOf.optional().describe(
    'Set by transfers.import_report on the plan it drafts to redo failed and short transfers',
  ),
  plates: z.array(PlanPlate).min(1).max(200),
  groups: z.array(TransferGroup).max(100).describe('Run in this order'),
  notes: z.string().min(1).optional(),
  decks: z
    .array(DeckLayout)
    .max(100)
    .optional()
    .describe('Opentrons Flex groups: where each plate and tip rack goes, one layout per group'),
});
export type TransferPlanAttributes = z.infer<typeof TransferPlanAttributes>;

// Opentrons Flex protocols (016b-3): what the API sends the science service, which writes the
// protocol from one fixed program and checks it in Opentrons' simulator. Data only, never code.

const FlexSlot = z.string().regex(/^[A-D][1-3]$/, 'must be a Flex deck slot like D1');
const OpentronsName = z.string().regex(/^[a-z0-9_.]+$/, 'must be an Opentrons load name');

export const FlexPipetteName = z.enum([
  'flex_1channel_50',
  'flex_1channel_1000',
  'flex_8channel_50',
  'flex_8channel_1000',
]);
export type FlexPipetteName = z.infer<typeof FlexPipetteName>;

export const FlexProtocolRequest = z.strictObject({
  name: z.string().min(1).max(2000),
  description: z.string().min(1).max(2000),
  pipette: z.strictObject({
    loadName: FlexPipetteName,
    mount: z.enum(['left', 'right']),
    nozzles: z
      .enum(['all', 'single'])
      .describe('single: an 8-channel pipette picks up one tip, at its H1 nozzle'),
  }),
  trash: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('trash_bin'), slot: FlexSlot }),
    z.strictObject({ kind: z.literal('waste_chute') }),
  ]),
  tipRacks: z
    .array(z.strictObject({ loadName: OpentronsName, slot: FlexSlot }))
    .min(1)
    .max(11),
  labware: z
    .array(
      z.strictObject({
        id: LocalId,
        label: z.string().min(1).max(2000),
        slot: FlexSlot,
        loadName: OpentronsName,
        definition: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("A custom definition, for labware Opentrons doesn't name"),
      }),
    )
    .min(1)
    .max(11),
  transfers: z
    .array(
      z.strictObject({
        from: z.strictObject({ labware: LocalId, well: WellName }),
        to: z.strictObject({ labware: LocalId, well: WellName }),
        volume: z.number().positive().describe('Microlitres'),
        newTip: z.boolean(),
      }),
    )
    .min(1)
    .max(20000),
});
export type FlexProtocolRequest = z.infer<typeof FlexProtocolRequest>;

/** What Opentrons' simulator made of a protocol. */
export const ProtocolCheck = z.object({
  ok: z.boolean(),
  simulator: z.string().describe('The Opentrons package version that simulated it'),
  commands: z.number().int().describe('Commands in the simulated run'),
  tips: z.number().int().describe('Tips the simulated run picked up'),
  problem: z.string().nullish().describe('Why the simulator stopped, when it did'),
});
export type ProtocolCheck = z.infer<typeof ProtocolCheck>;

export const FlexProtocolResult = z.object({ protocol: z.string(), check: ProtocolCheck });
export type FlexProtocolResult = z.infer<typeof FlexProtocolResult>;
/** A transfer that did not go as planned in an execution, and what its rerun moves. */
export const TransferException = z.strictObject({
  group: LocalId,
  index: z.number().int().nonnegative().describe("Its place in the group's transfers, from 0"),
  from: PlanWell,
  to: PlanWell,
  outcome: z
    .enum(['short', 'failed', 'not_run'])
    .describe('Moved less than planned; moved nothing; or not in the report at all'),
  planned: LiquidVolume,
  actual: LiquidVolume.optional().describe('What the instrument says it moved'),
  rerun: LiquidVolume.optional().describe(
    'What the rerun plan moves for it: all of it, or for a short one the rest in whole steps. Absent when it is not rerun',
  ),
  note: z.string().min(1).optional().describe('Why it is not rerun, or what the instrument said'),
});
export type TransferException = z.infer<typeof TransferException>;

/**
 * One execution of a confirmed transfer plan (016b-2b, ADR 0060), recorded from the instrument's
 * report: which transfers were done, which were not, and the plan drafted to redo them. Made only
 * by transfers.import_report; it is the outcome, never edited into a different one.
 */
export const TransferRunAttributes = z.strictObject({
  plan: pinOf(TransferPlanId),
  report: recordIdOf('fil').describe('The instrument report it was read from'),
  at: z.iso.datetime().describe('When the report was read'),
  status: z.enum(['complete', 'with_exceptions']),
  containers: z
    .array(z.strictObject({ plate: LocalId, container: ContainerId }))
    .describe("The containers the plan's plates were on the day"),
  counts: z.strictObject({
    planned: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    short: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notRun: z.number().int().nonnegative(),
    unplanned: z.number().int().nonnegative(),
  }),
  exceptions: z.array(TransferException).max(20000),
  unplanned: z
    .array(
      z.strictObject({
        from: z.strictObject({ plate: z.string(), well: z.string() }),
        to: z.strictObject({ plate: z.string(), well: z.string() }),
        actual: LiquidVolume,
      }),
    )
    .max(20000)
    .describe(
      'Transfers the instrument reports that the plan does not have; reported, never rerun',
    ),
  rerun: TransferPlanId.optional().describe('The plan drafted to redo the exceptions'),
});
export type TransferRunAttributes = z.infer<typeof TransferRunAttributes>;

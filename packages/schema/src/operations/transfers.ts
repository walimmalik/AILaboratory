import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { recordIdOf } from '../ids.ts';
import { LocalId } from '../instruments.ts';
import { ContainerId } from '../inventory.ts';
import { LiquidVolume, WellName } from '../labware.ts';
import { defineContract } from '../operation.ts';
import { DecimalString, Quantity } from '../quantity.ts';
import { LiquidTypeId } from '../reagents.ts';
import { RecordEnvelope } from '../record.ts';
import { DeckSite, PlanPlate, ProtocolCheck, TransferGroup, TransferPlanId } from '../transfers.ts';

/**
 * The transfer calculators (plan 016, T2; ADR 0024): read operations over
 * `packages/domain/src/transfers.ts` that agents call instead of doing the arithmetic.
 */

const InstrumentId = recordIdOf('ins');
const LabwareTypeId = recordIdOf('lwt');

/** The device that moves the liquid: a registered instrument, or limits given by hand. */
export const TransferDevice = z
  .union([
    z.strictObject({
      instrument: InstrumentId,
      node: LocalId.optional().describe(
        'The pipette, head or chip on it, when it has more than one that transfers',
      ),
    }),
    z.strictObject({
      limits: z.strictObject({
        min: LiquidVolume.optional(),
        max: LiquidVolume.optional(),
        step: LiquidVolume.optional().describe('e.g. 2.5 nL droplets'),
      }),
    }),
  ])
  .describe('An instrument in the lab (its transfer or dispense limits are used), or limits');

const Percent = DecimalString.describe('Percent v/v, e.g. "0.5"');
const Fraction = DecimalString.describe('e.g. "0.05" for ±5%');

const VolumeFit = z.object({
  requested: Quantity,
  achieved: Quantity,
  steps: z.number().int().optional().describe('Droplets or steps'),
  error: z.string(),
  fits: z.boolean(),
  problem: z.string().optional(),
});

const Dispense = z.object({
  volume: VolumeFit,
  achieved: Quantity.describe('The concentration the well gets'),
  error: z.string(),
  solventPercent: z.string(),
  ok: z.boolean(),
  problems: z.array(z.string()),
});

const DeviceUsed = z.object({
  label: z.string(),
  min: Quantity.optional(),
  max: Quantity.optional(),
  step: Quantity.optional(),
});

export const transfersDilutionOptions = defineContract({
  id: 'transfers.dilution_options',
  verbs: { done: 'worked out dilution options', intent: 'work out dilution options' },
  calculator: true,
  summary:
    'Can each target concentration be reached from a stock with this device: straight from the stock (the volume, droplets, the concentration the well really gets and its error, the solvent it brings) or through an intermediate diluted 10, 100 or 1000 fold. Use it before planning any dilution',
  effect: 'read',
  input: z.strictObject({
    stock: Quantity.describe('e.g. 10 mM in DMSO'),
    targets: z.array(Quantity).min(1).max(96),
    finalVolume: LiquidVolume.describe("The well's volume when everything is in"),
    device: TransferDevice,
    maxSolventPercent: Percent.optional(),
    tolerance: Fraction.optional(),
    factors: z.array(DecimalString).optional().describe('Intermediate folds to try'),
  }),
  output: z.object({
    device: DeviceUsed,
    points: z.array(
      z.object({
        target: Quantity,
        direct: Dispense,
        intermediate: z
          .object({ factor: z.string(), concentration: Quantity, dispense: Dispense })
          .optional(),
        reachable: z.boolean(),
      }),
    ),
  }),
});

export const transfersOptimizeDilution = defineContract({
  id: 'transfers.optimize_dilution',
  verbs: {
    done: 'planned an intermediate dilution plate',
    intent: 'plan an intermediate dilution plate',
  },
  calculator: true,
  summary:
    "The dilution optimizer: for every compound and curve point, dispense from the source plate when that is within tolerance, else from an intermediate well, using the fewest intermediate wells and plates within the solvent limit and the intermediate plate's dead and maximum volume. Returns per point the source or intermediate well, droplets, achieved concentration and error, and per intermediate well what to put in it. Choose between runs with different settings and explain; never work the volumes out yourself",
  effect: 'read',
  input: z.strictObject({
    compounds: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('The compound, e.g. its entity ID'),
          stock: Quantity,
          points: z.array(Quantity).min(1).max(48),
          wellsPerPoint: z
            .number()
            .int()
            .min(1)
            .max(1536)
            .optional()
            .describe('Destination wells per point: replicates × plates'),
        }),
      )
      .min(1)
      .max(1000),
    finalVolume: LiquidVolume,
    device: TransferDevice,
    maxSolventPercent: Percent,
    tolerance: Fraction.optional().describe('Default ±5%'),
    intermediatePlate: LabwareTypeId.describe(
      'The intermediate plate type; its well count, dead volume and working volume are used',
    ),
    factors: z.array(DecimalString).optional(),
  }),
  output: z.object({
    device: DeviceUsed,
    points: z.array(
      z.object({
        compound: z.string(),
        point: z.number().int(),
        target: Quantity,
        from: z.enum(['source', 'intermediate']),
        intermediate: z.string().optional(),
        dispense: Dispense,
      }),
    ),
    intermediates: z.array(
      z.object({
        id: z.string(),
        compound: z.string(),
        factor: z.string(),
        concentration: Quantity,
        plate: z.number().int(),
        well: z.string(),
        stock: Quantity,
        diluent: Quantity,
        volume: Quantity,
        drawn: Quantity,
        dead: Quantity,
      }),
    ),
    plates: z.number().int(),
    unreachable: z.array(
      z.object({
        compound: z.string(),
        point: z.number().int(),
        target: Quantity,
        problems: z.array(z.string()),
      }),
    ),
  }),
});

export const transfersSourceVolumes = defineContract({
  id: 'transfers.source_volumes',
  verbs: { done: 'worked out source volumes', intent: 'work out source volumes' },
  calculator: true,
  summary:
    'What each source well must hold for a set of draws: what is drawn, plus the dead volume of its labware type, plus an overage, against what inventory says the well holds now less what confirmed transfer plans have reserved. Says which wells are short',
  effect: 'read',
  input: z.strictObject({
    draws: z
      .array(z.strictObject({ container: ContainerId, well: WellName, volume: LiquidVolume }))
      .min(1)
      .max(10000),
    overage: Fraction.optional().describe('Extra on top of what is drawn, e.g. "0.1" for 10%'),
    plan: TransferPlanId.optional().describe("Leave this plan's own reservations out"),
  }),
  output: z.object({
    sources: z.array(
      z.object({
        container: z.string(),
        name: z.string(),
        well: z.string(),
        drawn: Quantity,
        dead: Quantity,
        overage: Quantity,
        needed: Quantity,
        draws: z.number().int(),
        holds: Quantity.optional().describe('What the well holds now, when known'),
        reserved: Quantity.optional().describe('What confirmed transfer plans have reserved'),
        short: Quantity.optional().describe(
          'How much is missing, when what it holds less what is reserved is too little',
        ),
      }),
    ),
    notes: z.array(z.string()).describe('Assumptions, e.g. a labware type without a dead volume'),
  }),
});

export const transfersOptions = defineContract({
  id: 'transfers.options',
  verbs: { done: 'compared transfer instruments', intent: 'compare transfer instruments' },
  calculator: true,
  summary:
    'Every instrument in the lab that could move a volume, best first: whether its transfer or dispense limits allow it, the volume it really moves (droplets or steps) and its error, its liquid class for the liquid and whether that class is verified, and how it uses tips (estimated). Instruments without volume limits are listed apart. Pick from these and say why',
  effect: 'read',
  input: z.strictObject({
    volume: LiquidVolume,
    liquid: LiquidTypeId.optional().describe('To pick the liquid class on each device'),
    wells: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The plate format moved into, to leave out devices that do not handle it'),
  }),
  output: z.object({
    options: z.array(
      z.object({
        rank: z.number().int(),
        instrument: z.object({ id: z.string(), name: z.string(), label: z.string() }),
        node: z.string(),
        device: z.string(),
        capability: z.string(),
        fit: VolumeFit,
        tips: z.enum(['none', 'new_each', 'per_source', 'lab_default']),
        liquidClass: z
          .object({ label: z.string().optional(), verified: z.boolean(), why: z.string() })
          .optional(),
      }),
    ),
    unknown: z.array(
      z.object({
        instrument: z.object({ id: z.string(), name: z.string(), label: z.string() }),
        device: z.string(),
        capability: z.string(),
        why: z.string(),
      }),
    ),
    notes: z.array(z.string()),
  }),
});

const Reason = z.string().min(1).optional().describe('Why; kept in history');

const Instrument = z.strictObject({ instrument: InstrumentId, node: LocalId.optional() });

export const transfersDraft = defineContract({
  id: 'transfers.draft',
  verbs: { done: 'drafted a transfer plan', intent: 'draft a transfer plan' },
  summary:
    "Draft a transfer plan: the plates it uses (sources, destinations, intermediates, each with its labware type version and optionally its container or plate map plate) and groups of transfers, each one method on one instrument (or by hand) with why it was chosen and the alternatives. Work volumes out with the transfer calculators first; code copies each instrument's limits into its group and checks every volume in readiness",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "Staurosporine dose-response into 4 assay plates"'),
    experiment: recordIdOf('exp').optional(),
    purpose: z.string().min(1).optional(),
    plates: z.array(PlanPlate).min(1).max(200),
    groups: z.array(TransferGroup.omit({ device: true })).max(100),
    notes: z.string().min(1).optional(),
    evidence: z.record(z.string(), EvidenceInput).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const transfersSetInstrument = defineContract({
  id: 'transfers.set_instrument',
  verbs: { done: 'set the instrument of', intent: 'set the instrument of' },
  summary:
    "Switch a group of a transfer plan to another instrument (or to by hand), with why. Code copies the new instrument's limits; readiness then says which volumes it can't move. Direct on drafts; proposed on a confirmed plan",
  effect: 'write',
  input: z.strictObject({
    id: TransferPlanId,
    expectedVersion: z.number().int().positive(),
    group: LocalId,
    instrument: Instrument.optional().describe('Left out for by hand'),
    why: z.string().min(1).describe('Why this instrument'),
    liquidClass: recordIdOf('lqc').optional(),
    tips: z.enum(['none', 'new_each', 'per_source', 'lab_default']).optional(),
  }),
  output: RecordEnvelope,
});

export const transfersPickSources = defineContract({
  id: 'transfers.pick_sources',
  verbs: { done: 'picked sources for', intent: 'pick sources for' },
  summary:
    "Say which container in inventory each source plate is (P5): usually on the day, once you know which tube or plate has enough (check with transfers.source_volumes). The container must be of the plate's labware type. Direct on drafts; proposed on a confirmed plan",
  effect: 'write',
  input: z.strictObject({
    id: TransferPlanId,
    expectedVersion: z.number().int().positive(),
    picks: z.array(z.strictObject({ plate: LocalId, container: ContainerId })).min(1),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

const Check = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(['blocker', 'warning']),
  passed: z.boolean(),
  problems: z.array(z.string()),
});

export const transfersCheck = defineContract({
  id: 'transfers.check',
  verbs: { done: 'checked', intent: 'check' },
  calculator: true,
  summary:
    "Every rule on a transfer plan, with what is live on the day: each volume against its instrument's limits now, whether each instrument is ready and still has the limits the plan used, what each source well must hold (drawn, dead volume) against what it holds less other plans' reservations, destination wells against their capacity, and whether pinned plate maps and labware are current",
  effect: 'read',
  input: z.strictObject({ id: TransferPlanId }),
  output: z.object({
    ok: z.boolean().describe('No blocker fails'),
    checks: z.array(Check),
    totals: z.object({
      transfers: z.number().int(),
      tips: z.number().int().describe("Estimated from each group's tip rule"),
      sources: z.number().int(),
    }),
  }),
});

export const transfersSetDeck = defineContract({
  id: 'transfers.set_deck',
  verbs: { done: 'set the deck layout of', intent: 'set the deck layout of' },
  summary:
    "Set where each plate and tip rack goes on the Opentrons Flex for a group of a transfer plan, with why. Left out, code lays it out: the plates the group uses in plan order, then enough full tip racks of the lab's Flex tip rack for the pipette, on the slots the instrument's configuration leaves free, front row first. Given, each site is checked against the free slots, the plates the group uses and the tips it takes. The layout is its own section of the plan, confirmed by a person; exports and the loading list use the confirmed layout. Direct on drafts; proposed on a confirmed plan",
  effect: 'write',
  input: z.strictObject({
    id: TransferPlanId,
    expectedVersion: z.number().int().positive(),
    group: LocalId,
    sites: z
      .array(DeckSite)
      .min(1)
      .optional()
      .describe('What goes on each slot; left out, code lays it out'),
    why: z.string().min(1).describe('Why this layout'),
  }),
  output: RecordEnvelope,
});

export const transfersLoadingList = defineContract({
  id: 'transfers.loading_list',
  verbs: { done: 'read the loading list of', intent: 'read the loading list of' },
  summary:
    "What a person does at the instrument before a group runs, as numbered steps in plain words: check the pipette and empty the trash, then put each plate and tip rack on its slot, with how much each source well must hold for this group (what it draws plus the plate type's dead volume). From the plan's deck layouts. Give `group` for one group; groups without a layout are listed as skipped with why",
  effect: 'read',
  input: z.strictObject({
    id: TransferPlanId,
    group: LocalId.optional(),
  }),
  output: z.object({
    plan: z.object({ id: z.string(), name: z.string(), version: z.number().int() }),
    groups: z.array(
      z.object({
        group: z.string(),
        label: z.string(),
        instrument: z.string(),
        steps: z.array(z.string()),
      }),
    ),
    skipped: z.array(z.object({ group: z.string(), why: z.string() })),
  }),
});

export const transfersReserved = defineContract({
  id: 'transfers.reserved',
  verbs: { done: 'looked at what is reserved', intent: 'look at what is reserved' },
  summary:
    'What confirmed transfer plans have reserved from a container, well by well, and by which plan (010 V8). Reservations end when a plan is archived or its run is recorded',
  effect: 'read',
  input: z.strictObject({ container: ContainerId }),
  output: z.object({
    wells: z.array(
      z.object({
        well: z.string(),
        reserved: Quantity,
        plans: z.array(z.object({ id: z.string(), name: z.string(), volume: Quantity })),
      }),
    ),
  }),
});

export const transfersDraftFromPlateMap = defineContract({
  id: 'transfers.draft_from_plate_map',
  verbs: { done: 'drafted a transfer plan from', intent: 'draft a transfer plan from' },
  summary:
    "Draft a transfer plan that makes a plate map's concentrations: code dispenses each well's compound straight from its source well when that is within tolerance and the solvent limit, else from intermediate wells it plans with the dilution optimizer, then backfills every well to the same solvent volume. Give where each subject's stock is, the solvent well, the dispensing instrument with why, the final volume and the solvent limit. Refused, with the points no route reaches, when the settings can't make every well; try other settings with transfers.optimize_dilution",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1),
    map: recordIdOf('pmp').describe('The plate map; its current version is pinned'),
    sourcePlates: z
      .array(PlanPlate.omit({ role: true, plateMap: true }))
      .min(1)
      .max(50)
      .describe('The plates the stocks and the solvent are in'),
    sources: z
      .array(
        z.strictObject({
          subject: z.string().min(1).describe('A subject of the plate map (its record ID)'),
          plate: LocalId,
          well: WellName,
          stock: Quantity.describe('e.g. 10 mM'),
        }),
      )
      .min(1),
    solvent: z
      .strictObject({ plate: LocalId, well: WellName })
      .describe('Where the backfill and intermediate diluent come from, e.g. a DMSO well'),
    finalVolume: LiquidVolume.describe("Each well's volume when everything is in"),
    maxSolventPercent: Percent,
    tolerance: Fraction.optional().describe('Default ±5%'),
    instrument: Instrument,
    why: z.string().min(1).describe('Why this instrument'),
    intermediatePlate: LabwareTypeId.optional().describe(
      'The plate type for intermediate dilutions, when some points need them',
    ),
    experiment: recordIdOf('exp').optional(),
    reason: Reason,
  }),
  output: z.object({
    plan: RecordEnvelope,
    summary: z.object({
      wells: z.number().int(),
      fromSource: z.number().int(),
      fromIntermediates: z.number().int(),
      intermediateWells: z.number().int(),
      backfilled: z.number().int(),
      notes: z.array(z.string()),
    }),
  }),
});

export const transfersExport = defineContract({
  id: 'transfers.export',
  verbs: { done: 'exported a worklist from', intent: 'export a worklist from' },
  summary:
    "Write the instrument files for a confirmed transfer plan: an Echo pick list (CSV) for each group on an Echo, and an Opentrons protocol (Python) for each group on an Opentrons Flex, checked in Opentrons' simulator first, placed as the plan's confirmed deck layout says. Each file is stored in the file store with the plan version it came from. Groups done by hand, on instruments without a writer yet, or stopped by the simulator are listed as skipped with why. Give `group` to write one group's file only",
  effect: 'write',
  input: z.strictObject({
    id: TransferPlanId,
    group: LocalId.optional().describe('One group; left out, every group that has a writer'),
    reason: Reason,
  }),
  output: z.object({
    plan: z.object({ id: z.string(), name: z.string(), version: z.number().int() }),
    files: z.array(
      z.object({
        group: z.string(),
        format: z.enum(['echo_pick_list', 'opentrons_protocol']),
        file: RecordEnvelope,
        filename: z.string(),
        rows: z.number().int(),
        check: ProtocolCheck.optional().describe(
          'Opentrons protocols: what the simulator made of it',
        ),
        deck: z
          .array(z.object({ slot: z.string(), holds: z.string() }))
          .optional()
          .describe('Opentrons protocols: what goes on each deck slot'),
      }),
    ),
    skipped: z.array(z.object({ group: z.string(), why: z.string() })),
  }),
});

const ReportWell = z.object({ plate: z.string(), well: z.string() });

export const transfersImportReport = defineContract({
  id: 'transfers.import_report',
  verbs: { done: 'read an instrument report for', intent: 'read an instrument report for' },
  summary:
    "Read an Echo transfer report or survey (uploaded first with files.upload) against a confirmed transfer plan. A transfer report records the execution (a TRN record: which planned transfers were done, short, failed or not run), records what really moved in the inventory ledger as from a run log, ends the plan's reservations, and drafts a rerun plan for the short, failed and missing transfers for a person to confirm (each report once). A survey compares the measured source volumes with the inventory. Plates are matched by the names and barcodes in the export",
  effect: 'write',
  input: z.strictObject({
    id: TransferPlanId,
    file: recordIdOf('fil').describe('The report, uploaded with files.upload'),
    containers: z
      .array(z.strictObject({ plate: LocalId, container: ContainerId }))
      .optional()
      .describe(
        "The containers used for the plan's plates on the day, when the plan and the report barcodes don't say",
      ),
    reason: Reason,
  }),
  output: z.object({
    report: z.enum(['echo_transfer', 'echo_survey']),
    plan: z.object({ id: z.string(), name: z.string(), version: z.number().int() }),
    counts: z.object({
      rows: z.number().int(),
      done: z.number().int(),
      short: z.number().int(),
      failed: z.number().int(),
      notInReport: z.number().int(),
      notInPlan: z.number().int(),
      flagged: z
        .number()
        .int()
        .describe('Survey wells with a status or a volume off the inventory'),
    }),
    problems: z.array(
      z.object({
        kind: z.enum(['short', 'failed', 'not_in_report', 'not_in_plan', 'survey']),
        source: ReportWell.optional(),
        destination: ReportWell.optional(),
        requested: Quantity.optional(),
        actual: Quantity.optional(),
        message: z.string(),
      }),
    ),
    recorded: z.number().int().describe('Transfers written to the inventory ledger'),
    event: z.string().optional().describe('The inventory event they were written in'),
    execution: z
      .object({ id: z.string(), name: z.string() })
      .optional()
      .describe('The execution recorded from a transfer report'),
    rerun: z
      .object({ id: z.string(), name: z.string() })
      .optional()
      .describe('The draft plan that redoes the exceptions, waiting for a person to confirm'),
    notes: z.array(z.string()),
  }),
});

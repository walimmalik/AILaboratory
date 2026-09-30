import { z } from 'zod';
import { recordIdOf } from '../ids.ts';
import { LocalId } from '../instruments.ts';
import { ContainerId } from '../inventory.ts';
import { LiquidVolume, WellName } from '../labware.ts';
import { defineContract } from '../operation.ts';
import { DecimalString, Quantity } from '../quantity.ts';
import { LiquidTypeId } from '../reagents.ts';

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
  calculator: true,
  summary:
    'What each source well must hold for a set of draws: what is drawn, plus the dead volume of its labware type, plus an overage, against what inventory says the well holds now. Says which wells are short. Reservations by other plans come with transfer plans',
  effect: 'read',
  input: z.strictObject({
    draws: z
      .array(z.strictObject({ container: ContainerId, well: WellName, volume: LiquidVolume }))
      .min(1)
      .max(10000),
    overage: Fraction.optional().describe('Extra on top of what is drawn, e.g. "0.1" for 10%'),
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
        short: Quantity.optional().describe('How much is missing, when it holds too little'),
      }),
    ),
    notes: z.array(z.string()).describe('Assumptions, e.g. a labware type without a dead volume'),
  }),
});

export const transfersOptions = defineContract({
  id: 'transfers.options',
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

import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { CalendarDate } from './instruments.ts';
import { LiquidVolume } from './labware.ts';
import { DecimalString, Quantity } from './quantity.ts';
import { LiquidTypeId } from './reagents.ts';

/**
 * Liquid classes (plan 009b, ADR 0028): how one device aspirates and dispenses one kind of liquid
 * with one tip or source plate, one dispense mode and one volume range (R7). What is stored per
 * platform follows R5: full parameters where we can validate what we generate (Opentrons), a
 * read-only copy of Hamilton's own parameters "as reported", the Echo's calibration name, a
 * technique for people.
 */

export const LiquidClassId = recordIdOf('lqc');

// ---------------------------------------------------------------------------------------------
// Opentrons transfer properties: liquid class schema 1 (shared-data/liquid-class), one pipette
// model and tip rack. Units are Opentrons': µL, µL/s, mm, mm/s, s.

const Offset = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const Position = z.strictObject({
  positionReference: z.enum(['well-top', 'well-bottom', 'well-center', 'liquid-meniscus']),
  offset: Offset,
});
const toggle = <P extends z.ZodRawShape>(params: P) =>
  z.strictObject({ enable: z.boolean(), params: z.strictObject(params) });
const Delay = toggle({ duration: z.number().nonnegative() });
const TouchTip = toggle({ zOffset: z.number(), mmFromEdge: z.number(), speed: z.number() });
const Mix = toggle({ repetitions: z.number().int().nonnegative(), volume: z.number() });
const Blowout = toggle({
  location: z.enum(['source', 'destination', 'trash']),
  flowRate: z.number(),
});
/** [volume in µL, value] pairs; Opentrons interpolates between them. */
const ByVolume = z.array(z.tuple([z.number(), z.number()])).min(1);

const Submerge = z.strictObject({ startPosition: Position, speed: z.number(), delay: Delay });

export const OpentronsTransferProperties = z.strictObject({
  aspirate: z.strictObject({
    submerge: Submerge,
    retract: z.strictObject({
      endPosition: Position,
      speed: z.number(),
      airGapByVolume: ByVolume,
      touchTip: TouchTip,
      delay: Delay,
    }),
    aspiratePosition: Position,
    flowRateByVolume: ByVolume,
    correctionByVolume: ByVolume,
    preWet: z.boolean(),
    mix: Mix,
    delay: Delay,
  }),
  singleDispense: z.strictObject({
    submerge: Submerge,
    retract: z.strictObject({
      endPosition: Position,
      speed: z.number(),
      airGapByVolume: ByVolume,
      blowout: Blowout,
      touchTip: TouchTip,
      delay: Delay,
    }),
    dispensePosition: Position,
    flowRateByVolume: ByVolume,
    correctionByVolume: ByVolume,
    mix: Mix,
    pushOutByVolume: ByVolume,
    delay: Delay,
  }),
  multiDispense: z
    .strictObject({
      submerge: Submerge,
      retract: z.strictObject({
        endPosition: Position,
        speed: z.number(),
        airGapByVolume: ByVolume,
        blowout: Blowout,
        touchTip: TouchTip,
        delay: Delay,
      }),
      dispensePosition: Position,
      flowRateByVolume: ByVolume,
      correctionByVolume: ByVolume,
      conditioningByVolume: ByVolume,
      disposalByVolume: ByVolume,
      delay: Delay,
    })
    .optional(),
});
export type OpentronsTransferProperties = z.infer<typeof OpentronsTransferProperties>;

// ---------------------------------------------------------------------------------------------
// Hamilton parameters as Venus reports them (read-only here, L6). Units: µL, µL/s, mm/s, s, mm.

export const HamiltonParameters = z.strictObject({
  curve: z
    .array(z.tuple([z.number(), z.number()]))
    .min(1)
    .describe('[target µL, volume the channel moves in µL] pairs'),
  aspiration: z.strictObject({
    flowRate: z.number(),
    mixFlowRate: z.number(),
    airTransportVolume: z.number(),
    blowOutVolume: z.number(),
    swapSpeed: z.number(),
    settlingTime: z.number(),
    overAspirateVolume: z.number(),
    clotRetractHeight: z.number(),
  }),
  dispense: z.strictObject({
    flowRate: z.number(),
    mode: z.number().describe("Venus's dispense mode code"),
    mixFlowRate: z.number(),
    airTransportVolume: z.number(),
    blowOutVolume: z.number(),
    swapSpeed: z.number(),
    settlingTime: z.number(),
    stopFlowRate: z.number(),
    stopBackVolume: z.number(),
  }),
});
export type HamiltonParameters = z.infer<typeof HamiltonParameters>;

// ---------------------------------------------------------------------------------------------
// The class itself.

export const DispenseMode = z
  .enum(['jet_empty', 'jet_part', 'surface_empty', 'surface_part'])
  .describe('Jet (from above) or surface (touching the liquid); empty (all) or part (aliquots)');
export type DispenseMode = z.infer<typeof DispenseMode>;

export const LiquidClassSettings = z.discriminatedUnion('platform', [
  z
    .strictObject({
      platform: z.literal('opentrons'),
      pipetteModel: z.string().min(1).describe('E.g. flex_1channel_1000'),
      tiprack: z
        .string()
        .min(1)
        .describe('The Opentrons tip rack URI, e.g. opentrons/opentrons_flex_96_tiprack_200ul/1'),
      properties: OpentronsTransferProperties,
    })
    .describe('Full transfer properties, which we can generate and simulate'),
  z
    .strictObject({
      platform: z.literal('hamilton'),
      system: z.enum(['star', 'vantage']),
      tipVolume: LiquidVolume,
      core: z.boolean().describe('CO-RE 96/384 head tips rather than channels'),
      needle: z.boolean().describe('A steel needle rather than a disposable tip'),
      filter: z.boolean(),
      reportedBy: z
        .enum(['venus', 'hamilton_default'])
        .describe("The lab's own Venus export, or Hamilton's defaults (via PyLabRobot)"),
      changedHere: z
        .boolean()
        .describe('Edited here, so Venus no longer matches until a re-import (R5 note)'),
      parameters: HamiltonParameters.optional(),
    })
    .describe('The Venus class, named, with a read-only copy of its parameters'),
  z
    .strictObject({
      platform: z.literal('echo'),
      calibration: z
        .string()
        .min(1)
        .describe('E.g. DMSO2 or AQ_BP; the class name joins it to the plate type'),
    })
    .describe('An Echo calibration for one source plate type'),
  z
    .strictObject({
      platform: z.literal('dispenser'),
      note: z.string().min(1).optional().describe('Chip or head settings, in plain words'),
    })
    .describe('Mantis, PreciseDrop, washer: the device is the chip or head'),
  z
    .strictObject({
      platform: z.literal('manual'),
      technique: z.enum(['forward', 'reverse']),
      preWet: z.boolean(),
      speed: z.enum(['normal', 'slow']),
    })
    .describe('A person with a pipette'),
]);
export type LiquidClassSettings = z.infer<typeof LiquidClassSettings>;

export const LiquidClassAttributes = z.strictObject({
  instrumentKind: recordIdOf('ink').describe('The instrument model it runs on'),
  device: recordIdOf('eqk').optional().describe('The pipette, head, channel type or chip'),
  tips: z.array(recordIdOf('lwt')).optional().describe('Tip rack types it is for'),
  sourceLabware: recordIdOf('lwt').optional().describe('Echo: the source plate type'),
  mode: DispenseMode.optional(),
  volume: z
    .strictObject({ min: LiquidVolume.optional(), max: LiquidVolume.optional() })
    .optional()
    .describe('The volumes it is meant for'),
  liquidTypes: z.array(LiquidTypeId).min(1).describe('The liquid types it serves'),
  labDefault: z.boolean().describe("The lab's default for its liquid types on this device and tip"),
  platformName: z
    .string()
    .min(1)
    .optional()
    .describe('What the platform calls it, e.g. 384PP_DMSO2'),
  origin: z
    .enum(['vendor_default', 'lab_existing', 'lab_made'])
    .describe("A vendor's default, the lab's existing class, or one made here"),
  settings: LiquidClassSettings,
  notes: z.string().min(1).optional(),
});
export type LiquidClassAttributes = z.infer<typeof LiquidClassAttributes>;

// ---------------------------------------------------------------------------------------------
// Verification (R11): a class is "verified in this lab" only with a passing run that isn't demo.

export const VerificationAttributes = z.strictObject({
  liquidClass: LiquidClassId,
  instrument: recordIdOf('ins').optional().describe('The machine it ran on'),
  method: z.enum(['gravimetric', 'dye', 'photometric']),
  date: CalendarDate,
  target: LiquidVolume,
  replicates: z.number().int().min(2),
  mean: LiquidVolume,
  cv: DecimalString.describe('Coefficient of variation in %'),
  limits: z
    .strictObject({
      accuracy: DecimalString.describe('Largest |mean − target| ÷ target allowed, in %'),
      cv: DecimalString.describe('Largest CV allowed, in %'),
    })
    .describe('What counts as a pass for this check'),
  rawData: z.url().optional(),
  demo: z.boolean().describe('Seed and test runs: never make a class verified'),
  notes: z.string().min(1).optional(),
});
export type VerificationAttributes = z.infer<typeof VerificationAttributes>;

export const VerificationResult = z.object({
  accuracy: DecimalString.describe('(mean − target) ÷ target, in %'),
  passed: z.boolean(),
  why: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

// ---------------------------------------------------------------------------------------------
// Resolving a class (plan 009, "How a transfer gets its liquid class").

export const ClassChoice = z.object({
  liquidClass: LiquidClassId.optional(),
  label: z.string().optional(),
  how: z.enum(['explicit', 'product_override', 'lab_memory', 'lab_default', 'none']),
  why: z.string().describe('In plain words'),
  memory: z
    .array(z.object({ id: z.string(), name: z.string(), statement: z.string() }))
    .optional()
    .describe('The lab memories that shaped the choice (plan 005b)'),
  verified: z.boolean().describe('Verified in this lab'),
  issue: z.string().optional().describe('What stands in the way, when no class fits'),
  alternatives: z
    .array(z.object({ liquidClass: LiquidClassId, label: z.string() }))
    .describe('Other classes that fit the device, tip, liquid type and volume'),
});
export type ClassChoice = z.infer<typeof ClassChoice>;

/** A mixture's parts, for working out its liquid type (R8). */
export const MixturePart = z.object({
  liquidType: LiquidTypeId,
  base: z.enum([
    'aqueous',
    'dmso',
    'glycerol',
    'protein_rich',
    'detergent',
    'ethanol',
    'volatile_organic',
    'cell_suspension',
  ]),
  volume: Quantity,
});
export type MixturePart = z.infer<typeof MixturePart>;

import { z } from 'zod';
import { recordIdOf } from '../ids.ts';
import { LiquidVolume } from '../labware.ts';
import {
  ClassChoice,
  DispenseMode,
  LiquidClassId,
  MixturePart,
  VerificationAttributes,
  VerificationResult,
} from '../liquids.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
import { LiquidTypeId, ProductId } from '../reagents.ts';
import { RecordEnvelope } from '../record.ts';

export const liquidsResolveClass = defineContract({
  id: 'liquids.resolve_class',
  verbs: { done: 'picked a liquid class for', intent: 'pick a liquid class for' },
  calculator: { title: 'Liquid class', group: 'dilutions' },
  summary:
    "Pick the liquid class for a transfer and say why: a class chosen on the step, then the product's own class for that device, then the lab's default for the liquid's type on that device and tip. Only confirmed classes are used; when nothing fits it says what is missing and lists the classes that would do",
  effect: 'read',
  input: z.strictObject({
    liquid: z
      .union([z.strictObject({ product: ProductId }), z.strictObject({ liquidType: LiquidTypeId })])
      .describe(
        'What is pipetted: a product, or a liquid type (for a mixture, see liquids.mixture_type)',
      ),
    instrumentKind: recordIdOf('ink'),
    device: recordIdOf('eqk').optional().describe('The pipette, head, channel type or chip'),
    tip: recordIdOf('lwt').optional().describe('The tip rack type'),
    sourceLabware: recordIdOf('lwt').optional().describe('Echo: the source plate type'),
    mode: DispenseMode.optional(),
    volume: LiquidVolume,
    liquidClass: LiquidClassId.optional().describe('A class chosen on the step, checked to fit'),
  }),
  output: ClassChoice,
});

export const liquidsMixtureType = defineContract({
  id: 'liquids.mixture_type',
  verbs: {
    done: 'worked out the liquid type of a mixture',
    intent: 'work out the liquid type of a mixture',
  },
  summary:
    "Work out a mixture's liquid type from its parts (R8): the largest part decides, unless DMSO (at least 70%), glycerol (over 20%), ethanol or a volatile solvent (at least 50%) passes its threshold. The result is an assumption until a person or the SOP step sets it",
  effect: 'read',
  input: z.strictObject({
    parts: z
      .array(z.strictObject({ liquidType: LiquidTypeId, volume: Quantity }))
      .min(1)
      .describe('Each part and how much of it'),
  }),
  output: z.object({
    liquidType: LiquidTypeId,
    label: z.string(),
    shares: z.array(z.object({ base: MixturePart.shape.base, percent: z.string() })),
    why: z.string(),
  }),
});

export const liquidsRecordVerification = defineContract({
  id: 'liquids.record_verification',
  verbs: { done: 'recorded a gravimetric check of', intent: 'record a gravimetric check of' },
  summary:
    "Record a check of a liquid class (gravimetric, dye or photometric: target, replicates, mean, CV and the limits it must meet). A passing run that isn't marked demo makes the class verified in this lab",
  effect: 'write',
  input: z.strictObject({
    ...VerificationAttributes.shape,
    reason: z.string().min(1).optional().describe('Why; kept in history'),
  }),
  output: z.object({ record: RecordEnvelope, result: VerificationResult }),
});

export const liquidsSearchClasses = defineContract({
  id: 'liquids.search_classes',
  verbs: { done: 'searched liquid classes', intent: 'search liquid classes' },
  summary:
    "Find the lab's liquid classes by name or vendor name, instrument model, device, tip, liquid type or platform, with whether each is verified in this lab and its latest check. For picking a class for a transfer use liquids.resolve_class",
  effect: 'read',
  input: z.strictObject({
    text: z.string().min(1).optional().describe('Matches the name, readable name or vendor name'),
    instrumentKind: recordIdOf('ink').optional(),
    device: recordIdOf('eqk').optional(),
    tip: recordIdOf('lwt').optional(),
    liquidType: LiquidTypeId.optional(),
    platform: z.enum(['opentrons', 'hamilton', 'echo', 'dispenser', 'manual']).optional(),
    verified: z.boolean().optional().describe('true: only classes verified in this lab'),
    status: z.enum(['draft', 'active']).optional().describe('Leave out for both'),
    limit: z.number().int().min(1).max(1000).optional().describe('Default 200'),
  }),
  output: z.object({
    classes: z.array(
      z.object({
        liquidClass: RecordEnvelope,
        verified: z.boolean().describe('Has a passing check that is not demo'),
        lastCheck: z
          .object({ date: z.string(), passed: z.boolean(), demo: z.boolean() })
          .optional(),
      }),
    ),
    total: z.number().int().describe('How many matched before the limit'),
  }),
});

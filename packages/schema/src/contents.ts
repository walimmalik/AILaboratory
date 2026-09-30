import { z } from 'zod';
import { Actor } from './actor.ts';
import { EntityId } from './entities.ts';
import { recordIdOf } from './ids.ts';
import { CalendarDate, Celsius } from './instruments.ts';
import { ContainerId } from './inventory.ts';
import { LiquidVolume, WellName } from './labware.ts';
import { Quantity } from './quantity.ts';
import { HandlingRule, LotId } from './reagents.ts';

/**
 * What is in a well (plan 010c, V2 to V4): the components (samples the lab made, lots it bought or
 * made from a recipe) with their concentration, and the volume. The mixing math lives in
 * `@ailab/domain` (contents.ts).
 */

export const SampleId = recordIdOf('smp');

/**
 * A batch the lab made of an entity (V2): a miniprep, a PCR product, a purified protein, a cell
 * bank. Its QC belongs to the prep and is shared by every aliquot of it.
 */
export const SampleMethod = z
  .enum([
    'miniprep',
    'midiprep',
    'maxiprep',
    'pcr_product',
    'digest',
    'assembly',
    'purification',
    'culture',
    'cell_bank',
    'extraction',
    'synthesis',
    'other',
  ])
  .describe('How it was made');
export type SampleMethod = z.infer<typeof SampleMethod>;

export const SampleQc = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and _')
    .describe('e.g. concentration, a260_280, sequence_verified, passage, viability'),
  value: z
    .union([Quantity, z.boolean(), z.string().min(1)])
    .describe('A quantity with its unit, yes/no, or a short text result'),
  measured: CalendarDate.optional(),
  method: z.string().min(1).optional().describe('e.g. Qubit dsDNA HS, NanoDrop, Sanger'),
});
export type SampleQc = z.infer<typeof SampleQc>;

export const SampleAttributes = z.strictObject({
  entity: EntityId.describe('What it is, e.g. the plasmid pGL4.10'),
  method: SampleMethod,
  made: CalendarDate.optional(),
  madeBy: z.string().min(1).optional().describe('Who made it'),
  derivedFrom: z
    .array(z.union([SampleId, LotId]))
    .optional()
    .describe('Samples or lots it was made from: the colony culture, the parent cell bank'),
  qc: z.array(SampleQc).optional(),
  notes: z.string().min(1).optional(),
});
export type SampleAttributes = z.infer<typeof SampleAttributes>;

export const ComponentSource = z
  .union([SampleId, LotId])
  .describe('A sample the lab made (smp_) or a lot it bought or made from a recipe (lot_)');
export type ComponentSource = z.infer<typeof ComponentSource>;

export const Component = z
  .strictObject({
    source: ComponentSource,
    concentration: Quantity.optional().describe(
      'In a liquid: molar, mass, activity, cells or colonies per volume, or % v/v or % w/v. Left out when unknown',
    ),
    amount: Quantity.optional().describe(
      'In a dry well: how much is there (mol, g, U, cells, CFU), e.g. a dried compound spot',
    ),
  })
  .refine((c) => !(c.concentration && c.amount), 'a component has a concentration or an amount');
export type Component = z.infer<typeof Component>;

export const WellVolume = z
  .union([LiquidVolume, z.literal('unknown')])
  .describe('How much liquid is in the well; "unknown" for things registered without a volume');

export const WellState = z.strictObject({
  volume: WellVolume,
  components: z.array(Component),
  assumed: z
    .boolean()
    .optional()
    .describe('True when the contents were estimated rather than recorded or measured'),
});
export type WellState = z.infer<typeof WellState>;

export const InventoryEventId = recordIdOf('iev');

export const WellRef = z.strictObject({ container: ContainerId, well: WellName });
export type WellRef = z.infer<typeof WellRef>;

export const InventoryEventType = z.enum([
  'fill',
  'transfer',
  'stamp',
  'consume',
  'correct',
  'discard',
]);
export type InventoryEventType = z.infer<typeof InventoryEventType>;

/** One well's change in an event: liquid in, liquid out, or a corrected state. */
export const LedgerLine = z.object({
  container: ContainerId,
  well: WellName,
  change: z.enum(['in', 'out', 'set']),
  volume: Quantity.optional().describe('How much went in or out'),
  from: WellRef.optional().describe('Where liquid that came in came from'),
  to: WellRef.optional().describe('Where liquid that went out went'),
  added: z.array(Component).optional().describe('A fill: what went in from outside the inventory'),
  after: WellState.describe('The well after this line'),
});
export type LedgerLine = z.infer<typeof LedgerLine>;

/** One physical event in the volume ledger (V4): who did what to which wells, and what they held after. */
export const InventoryEvent = z.object({
  id: InventoryEventId,
  type: InventoryEventType,
  at: z.string(),
  actor: Actor,
  operationId: z.string(),
  reason: z.string().optional(),
  runLog: recordIdOf('fil').optional().describe('The instrument report it was recorded from'),
  lines: z.array(LedgerLine),
});
export type InventoryEvent = z.infer<typeof InventoryEvent>;

// ---------------------------------------------------------------------------------------------
// Handling rules a container inherits from what it holds (plan 010d).

export const RuleOrigin = z
  .object({
    id: z.string(),
    kind: z.enum(['product', 'entity', 'entity_kind']),
    name: z.string(),
    label: z.string(),
  })
  .describe('The record the rule is written on: a product, an entity or an entity kind');
export type RuleOrigin = z.infer<typeof RuleOrigin>;

export const RuleContribution = z.object({
  origin: RuleOrigin,
  rule: HandlingRule.describe('The rule as its record states it'),
  via: z
    .array(ComponentSource)
    .describe(
      'The lots and samples in the wells that bring it: a lot through its product, a sample through its entity and entity kind',
    ),
  wells: z.array(z.string()).describe('The wells holding them, as wells or blocks like "A3:P22"'),
});
export type RuleContribution = z.infer<typeof RuleContribution>;

export const EffectiveRule = z.object({
  rule: HandlingRule.describe(
    'The rule that binds the container: the strictest of those below (shortest time, fewest freeze-thaws, narrowest temperature range), enforced when any of them is',
  ),
  from: z.array(RuleContribution).describe('Every rule it was merged from, with its source'),
  conflict: z
    .string()
    .optional()
    .describe('The rules below cannot all be kept, e.g. temperature ranges that do not overlap'),
});
export type EffectiveRule = z.infer<typeof EffectiveRule>;

export const StorageRange = z.strictObject({ min: Celsius.optional(), max: Celsius.optional() });
export type StorageRange = z.infer<typeof StorageRange>;

export const EffectiveStorage = z.object({
  range: StorageRange.describe('The narrowest storage temperature range of everything in it'),
  from: z.array(
    z.object({
      origin: RuleOrigin,
      range: StorageRange,
      via: z.array(ComponentSource),
      wells: z.array(z.string()),
    }),
  ),
  conflict: z.string().optional(),
});
export type EffectiveStorage = z.infer<typeof EffectiveStorage>;

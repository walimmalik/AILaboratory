import { z } from 'zod';
import { Actor } from './actor.ts';
import { EntityId } from './entities.ts';
import { recordIdOf } from './ids.ts';
import { CalendarDate } from './instruments.ts';
import { ContainerId } from './inventory.ts';
import { LiquidVolume, WellName } from './labware.ts';
import { Quantity } from './quantity.ts';
import { LotId } from './reagents.ts';

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
  lines: z.array(LedgerLine),
});
export type InventoryEvent = z.infer<typeof InventoryEvent>;

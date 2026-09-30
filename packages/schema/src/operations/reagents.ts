import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { recordIdOf } from '../ids.ts';
import { CalendarDate } from '../instruments.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
import {
  KitComponent,
  LiquidTypeId,
  LotAttributes,
  LotId,
  LotStatus,
  LotSummary,
  ProductAttributes,
  ProductCategory,
  ProductId,
  ScaledRecipe,
  StorageBand,
} from '../reagents.ts';
import { RecordEnvelope } from '../record.ts';

const ExpectedVersion = z
  .number()
  .int()
  .positive()
  .describe('The version you last read; the change is refused if the record has moved on');
const Reason = z.string().min(1).optional().describe('Why; kept in history');
const Evidence = z
  .record(z.string(), EvidenceInput)
  .optional()
  .describe(
    'Where values came from, by attribute name, e.g. {"storage": {"source": "datasheet", "reference": "https://…"}}. Values you set without a source are marked assumed until a person confirms them',
  );

/** A kit component: an existing product, or a new one drafted with the kit. */
export const DraftComponent = z.union([
  KitComponent,
  KitComponent.omit({ product: true })
    .extend({
      draft: z.strictObject({
        label: z.string().min(1),
        attributes: ProductAttributes.omit({ components: true }),
        evidence: Evidence,
      }),
    })
    .describe('A component product that does not exist yet; it is drafted with the kit'),
]);

export const reagentsDraftProduct = defineContract({
  id: 'reagents.draft_product',
  verbs: { done: 'drafted a product', intent: 'draft a product' },
  summary:
    'Draft a product the lab buys or makes (a reagent, a kit, a lab-made solution with its recipe) from what you know: a catalog number, a datasheet, a description. A kit drafts its new component products with it. Mark where values came from; unknown values stay out rather than guessed',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('The product name, e.g. "Human IL-6 DuoSet ELISA"'),
    attributes: ProductAttributes.omit({ components: true }),
    components: z.array(DraftComponent).optional().describe('A kit: its components'),
    evidence: Evidence,
    reason: Reason,
  }),
  output: z.object({ product: RecordEnvelope, drafted: z.array(RecordEnvelope) }),
});

export const reagentsScaleRecipe = defineContract({
  id: 'reagents.scale_recipe',
  verbs: { done: 'scaled the recipe of', intent: 'scale the recipe of' },
  calculator: true,
  summary:
    "Work out how much of each component a lab-made product's recipe needs for a target batch (e.g. 250 mL of Reagent Diluent). Use this rather than your own arithmetic",
  effect: 'read',
  input: z.strictObject({
    product: ProductId,
    target: Quantity.describe("The batch to make, in a unit of the recipe's yield"),
  }),
  output: ScaledRecipe,
});

export const reagentsReceiveLot = defineContract({
  id: 'reagents.receive_lot',
  verbs: { done: 'received a lot of', intent: 'receive a lot of' },
  summary:
    "Record a lot of a product: lot number, expiry, dates and the certificate's values for the product's lot fields. A kit lot lists its component lots; a lab-made batch lists the lots it was made from. Containers holding it are inventory's (plan 010)",
  effect: 'write',
  input: z.strictObject({
    ...LotAttributes.omit({ status: true, opened: true }).shape,
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const reagentsSetLotStatus = defineContract({
  id: 'reagents.set_lot_status',
  verbs: { done: 'set the status of', intent: 'set the status of' },
  summary:
    "Set a lot's status: opened (with the date, today when left out), quarantined (it can't be used in new plans), expired, used_up or back to unopened",
  effect: 'write',
  input: z.strictObject({
    id: LotId,
    expectedVersion: ExpectedVersion,
    status: LotStatus,
    date: CalendarDate.optional().describe('When it was opened; only with status opened'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const reagentsSearch = defineContract({
  id: 'reagents.search',
  verbs: { done: 'searched reagents', intent: 'search reagents' },
  summary:
    "Find the lab's products by name, catalog number or CAS, and by category, vendor, liquid type, storage or origin; or those with a lot in date, or a lot expiring soon. Each result carries its lot count, lots in date and next expiry",
  effect: 'read',
  input: z.strictObject({
    text: z
      .string()
      .min(1)
      .optional()
      .describe('Matches the name, readable name (PRD-0001), a catalog number or the CAS number'),
    category: ProductCategory.optional(),
    vendor: recordIdOf('vnd').optional(),
    liquidType: LiquidTypeId.optional(),
    storage: StorageBand.optional(),
    origin: z.enum(['bought', 'made']).optional(),
    inDate: z.boolean().optional().describe('true: only products with a lot in date'),
    expiringWithinDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .optional()
      .describe('Only products whose next lot in date expires within this many days'),
    status: z.enum(['draft', 'active']).optional().describe('Leave out for both'),
    today: CalendarDate.optional().describe("Defaults to the server's date"),
    limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
  }),
  output: z.object({
    products: z.array(
      z.object({ product: RecordEnvelope, storage: StorageBand.optional(), lots: LotSummary }),
    ),
    total: z.number().int().describe('How many matched before the limit'),
  }),
});

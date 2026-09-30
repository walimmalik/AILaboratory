import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { CalendarDate } from '../instruments.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
import {
  KitComponent,
  LotAttributes,
  LotId,
  LotStatus,
  ProductAttributes,
  ProductId,
  ScaledRecipe,
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

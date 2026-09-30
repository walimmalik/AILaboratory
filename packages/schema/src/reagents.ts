import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { CalendarDate, Celsius, LocalId } from './instruments.ts';
import { DecimalString, Quantity } from './quantity.ts';

/**
 * Reagents (plan 009a, ADR 0027): products the lab buys or makes, kits as products with component
 * products, recipes for lab-made solutions, lots with their certificate values, liquid types, and
 * the typed handling rules that later bind containers (010) and the scheduler (019).
 */

export const ProductId = recordIdOf('prd');
export const LotId = recordIdOf('lot');
export const LiquidTypeId = recordIdOf('lqt');

/** Shelf lives, stability windows and rests: seconds to days. */
export const Period = z.strictObject({
  value: DecimalString,
  unit: z.enum(['s', 'min', 'h', 'd']),
});
export type Period = z.infer<typeof Period>;

const TemperatureRange = z
  .strictObject({ min: Celsius.optional(), max: Celsius.optional() })
  .refine((t) => t.min || t.max, 'give a minimum, a maximum or both');

// ---------------------------------------------------------------------------------------------
// Handling rules (R6): a typed vocabulary shared by products, recipes and later entity kinds.

export const RuleSource = z
  .strictObject({
    from: z.enum(['vendor', 'lab_convention', 'lab_memory']),
    reference: z.url().optional().describe('The datasheet, manual or memory it comes from'),
  })
  .describe('Where the rule comes from; every rule shows its source');

const ruleBase = {
  text: z.string().min(1).describe('The rule in plain words, as the source says it'),
  source: RuleSource,
  enforced: z
    .boolean()
    .describe('true: the scheduler must keep to it; false: advice shown to the person'),
};

const rule = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S, meaning: string) =>
  z.strictObject({ rule: z.literal(kind), ...ruleBase, ...shape }).describe(meaning);

export const HandlingRule = z.discriminatedUnion('rule', [
  rule('protect_from_light', {}, 'Keep it out of direct light'),
  rule(
    'keep_cold',
    { at: TemperatureRange.optional() },
    'Keep it cold (on ice or a cold block) while in use',
  ),
  rule(
    'freeze_thaw_limit',
    { cycles: z.number().int().nonnegative() },
    'At most this many freeze-thaw cycles; 0 means do not refreeze',
  ),
  rule('stable_after_opening', { period: Period }, 'Use within this long after first opening'),
  rule(
    'stable_after_preparation',
    { period: Period, at: TemperatureRange.optional() },
    'A reconstituted, thawed or working solution keeps this long (at this temperature)',
  ),
  rule(
    'reconstitute',
    { period: Period.optional().describe('Rest after reconstituting') },
    'Reconstitute before use (with what and how is in the text), then rest',
  ),
  rule('thaw', { at: TemperatureRange.optional() }, 'Thaw before use, and how'),
  rule(
    'equilibrate',
    { period: Period.optional() },
    'Bring to room temperature before use (reagent or plate)',
  ),
  rule('mix_before_use', {}, 'Mix before use (how is in the text)'),
  rule('use_within', { period: Period }, 'Use within this long once mixed or dispensed'),
  rule(
    'max_time_out_of_storage',
    { period: Period },
    'At most this long out of its storage temperature',
  ),
  rule('hygroscopic', {}, 'Takes up water from air; keep closed and sealed'),
  rule(
    'read_within',
    { after: z.string().min(1), min: Period.optional(), max: Period.optional() },
    'Read this long after a step (the step is named in `after`)',
  ),
  rule(
    'advice',
    {},
    'Anything else worth knowing; never enforced, so give it a typed rule when it needs to bind',
  ),
]);
export type HandlingRule = z.infer<typeof HandlingRule>;
export type HandlingRuleKind = HandlingRule['rule'];

// ---------------------------------------------------------------------------------------------
// Products, kits and recipes.

export const ProductCategory = z.enum([
  'antibody',
  'assay_kit',
  'blocking_agent',
  'buffer',
  'cell_culture_medium',
  'competent_cells',
  'compound',
  'compound_library',
  'detergent',
  'dissociation_reagent',
  'enzyme',
  'master_mix',
  'purification_kit',
  'serum',
  'solvent',
  'stain',
  'standard',
  'stop_solution',
  'substrate',
  'supplement',
  'other',
]);
export type ProductCategory = z.infer<typeof ProductCategory>;

export const ProductForm = z.enum([
  'liquid',
  'powder',
  'lyophilized',
  'frozen_liquid',
  'frozen_cells',
  'solid',
  'kit',
]);

export const CatalogEntry = z.strictObject({
  number: z.string().min(1),
  packSize: z.string().min(1).optional().describe('In plain words, e.g. "15 plates" or "500 mL"'),
  supplier: recordIdOf('vnd').optional().describe('When bought from someone other than the vendor'),
});

export const Hazards = z.strictObject({
  ghs: z
    .array(z.string().regex(/^(EU)?[HP]\d{3}[A-Za-z]*$/, 'must be a GHS code like H314'))
    .optional(),
  signalWord: z.enum(['danger', 'warning', 'none']).optional(),
  sds: z.url().optional().describe('Link to the safety data sheet'),
  summary: z.string().min(1).optional().describe('What to watch for, in plain words'),
});

export const LotField = z.strictObject({
  key: LocalId,
  label: z.string().min(1).describe('E.g. "Working concentration"'),
  unit: z.string().min(1).optional().describe('The unit its value is given in'),
  typical: Quantity.optional().describe(
    'A typical value, shown as estimated until a lot is picked (R9)',
  ),
});

export const KitComponent = z.strictObject({
  product: ProductId,
  amount: Quantity.optional().describe('How much of it one kit holds'),
  count: z.number().int().positive().optional().describe('How many vials or bottles per kit'),
});
export type KitComponent = z.infer<typeof KitComponent>;

export const RecipeComponent = z.strictObject({
  product: ProductId,
  amount: Quantity.describe('How much goes into one batch of the recipe’s yield'),
});

export const Recipe = z.strictObject({
  yields: Quantity.describe('The batch the amounts make, e.g. 500 mL'),
  components: z.array(RecipeComponent).min(1),
  shelfLife: Period.optional().describe('How long a batch keeps'),
});
export type Recipe = z.infer<typeof Recipe>;

export const ProductAttributes = z.strictObject({
  category: ProductCategory,
  origin: z
    .enum(['bought', 'made'])
    .describe('bought from a vendor, or made in the lab from a recipe (R3)'),
  vendor: recordIdOf('vnd').optional(),
  catalog: z.array(CatalogEntry).optional().describe('Catalog numbers per pack size and supplier'),
  form: ProductForm.optional(),
  composition: z.string().min(1).optional().describe('In plain words, e.g. "1% BSA in PBS"'),
  concentration: Quantity.optional().describe('Stock concentration, when it has one'),
  molarMass: Quantity.optional(),
  cas: z
    .string()
    .regex(/^\d{2,7}-\d{2}-\d$/, 'must be a CAS number like 67-68-5')
    .optional(),
  liquidType: LiquidTypeId.optional().describe('How it behaves when pipetted (R4)'),
  liquidClasses: z
    .array(recordIdOf('lqc'))
    .optional()
    .describe(
      "Liquid classes to use for this product instead of the lab default for its liquid type, on each class's device (009b)",
    ),
  storage: TemperatureRange.optional().describe('Storage temperature'),
  shelfLife: Period.optional().describe('Unopened, from receipt'),
  handlingRules: z.array(HandlingRule).optional(),
  hazards: Hazards.optional(),
  lotFields: z
    .array(LotField)
    .optional()
    .describe('Values that change with each lot and come from its certificate (R9)'),
  components: z.array(KitComponent).optional().describe('A kit: its component products (R2)'),
  recipe: Recipe.optional().describe('A lab-made product: what goes into a batch (R3)'),
  datasheets: z.array(z.url()).optional(),
  notes: z.string().min(1).optional(),
});
export type ProductAttributes = z.infer<typeof ProductAttributes>;

// ---------------------------------------------------------------------------------------------
// Lots (R1): the instance of a product. Containers, volumes and places are 010's.

export const LotStatus = z
  .enum(['unopened', 'opened', 'quarantined', 'expired', 'used_up'])
  .describe('unopened, opened, quarantined (never used in new plans), expired or used_up');
export type LotStatus = z.infer<typeof LotStatus>;

export const Ratio = z.strictObject({
  ratio: z
    .string()
    .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/, 'must be a ratio like "1:200"')
    .describe('A dilution like "1:200"'),
});

export const LotValue = z.strictObject({
  field: LocalId.describe("A key from the product's lot fields"),
  value: z.union([Quantity, Ratio]),
});

export const LotAttributes = z.strictObject({
  product: ProductId,
  lotNumber: z.string().min(1),
  status: LotStatus,
  expiry: CalendarDate.optional(),
  received: CalendarDate.optional().describe('Bought lots: when it arrived'),
  made: CalendarDate.optional().describe('Lab-made lots: when the batch was made'),
  opened: CalendarDate.optional(),
  values: z.array(LotValue).optional().describe('Certificate of analysis values'),
  componentLots: z
    .array(LotId)
    .optional()
    .describe("A kit's component lots, or the lots a lab-made batch was made from"),
  certificate: z.url().optional().describe('Link to the certificate of analysis'),
  notes: z.string().min(1).optional(),
});
export type LotAttributes = z.infer<typeof LotAttributes>;

/** Storage temperature in words, from the upper end of the range (plan 009c filters). */
export const StorageBand = z
  .enum(['room', 'fridge', 'freezer', 'deep_freezer', 'cryo'])
  .describe(
    'room (above 10 °C), fridge (to 10 °C), freezer (to −10 °C), deep_freezer (to −60 °C), cryo (to −130 °C)',
  );
export type StorageBand = z.infer<typeof StorageBand>;

/** A product's lots at a glance: how many, how many usable today, and the next expiry among them. */
export const LotSummary = z.object({
  count: z.number().int(),
  inDate: z.number().int().describe('Unopened or opened, and not past expiry'),
  nextExpiry: CalendarDate.optional().describe('The soonest expiry among lots in date'),
});
export type LotSummary = z.infer<typeof LotSummary>;

// ---------------------------------------------------------------------------------------------
// Liquid types (R4): platform-neutral pipetting behaviour. Liquid classes are 009b.

export const LiquidBase = z.enum([
  'aqueous',
  'dmso',
  'glycerol',
  'protein_rich',
  'detergent',
  'ethanol',
  'volatile_organic',
  'cell_suspension',
]);

const Level = z.enum(['low', 'medium', 'high']);

export const LiquidTypeAttributes = z.strictObject({
  base: LiquidBase.describe('The family it pipettes like'),
  viscosity: Quantity.optional().describe('Dynamic viscosity, e.g. 6 mPa.s'),
  density: Quantity.optional().describe('E.g. 1.1 g/mL'),
  volatility: Level.optional(),
  foaming: Level.optional(),
  surfaceTension: z.enum(['low', 'normal']).optional(),
  hygroscopic: z.boolean().optional(),
  notes: z.string().min(1).optional(),
});
export type LiquidTypeAttributes = z.infer<typeof LiquidTypeAttributes>;

// ---------------------------------------------------------------------------------------------
// Recipe scaling (a calculator, ADR 0024).

export const ScaledRecipe = z.object({
  target: Quantity,
  factor: DecimalString.describe('Target divided by the recipe’s yield'),
  components: z.array(z.object({ product: ProductId, label: z.string(), amount: Quantity })),
});
export type ScaledRecipe = z.infer<typeof ScaledRecipe>;

import { z } from 'zod';
import { RecordId, recordIdOf } from './ids.ts';
import { DocumentId } from './library.ts';
import { DecimalString, Quantity } from './quantity.ts';

/**
 * Digital SOPs (plan 012): a lab procedure as a structured, versioned design document. Materials are
 * roles bound to records when an experiment is planned (G4); steps are typed actions (G2); key values
 * are variables, some computed by formulas (G3, ADR 0036); what the source leaves unclear is an open
 * question (G6). Every step and value can cite the library passage it came from.
 */

export const SopId = recordIdOf('sop');

/** A name for a variable or a role: letters, digits and _, e.g. `well_volume`, `coating_plate`. */
export const SopName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'a name like well_volume or coating_plate');

/** Where a step or value came from in a library document. */
export const Citation = z.strictObject({
  document: DocumentId,
  passage: z.string().min(1).optional().describe('The passage id, from library.read or search'),
  page: z.number().int().positive().optional(),
  quote: z.string().min(1).describe('The words in the source, as written'),
});
export type Citation = z.infer<typeof Citation>;

const cite = z.array(Citation).optional().describe('The source passages behind it');

export const MaterialType = z.enum([
  'reagent',
  'entity',
  'labware',
  'instrument',
  'consumable',
  'solution',
]);

/**
 * A material by role (G4): what the step needs, with requirements and a default, bound to a
 * concrete record when an experiment is planned.
 */
export const SopMaterial = z.strictObject({
  role: SopName.describe('How steps refer to it, e.g. coating_plate'),
  label: z.string().min(1).describe('In lab words, e.g. "Coating plate"'),
  type: MaterialType,
  requirements: z
    .string()
    .min(1)
    .optional()
    .describe('What any choice must meet, e.g. "96-well, high protein binding"'),
  default: RecordId.optional().describe('The usual record: a product, labware type, instrument…'),
  cite,
});
export type SopMaterial = z.infer<typeof SopMaterial>;

/** A solution the SOP has you prepare, e.g. wash buffer; a lab-made product's recipe when there is one. */
export const SopSolution = z.strictObject({
  role: SopName,
  label: z.string().min(1),
  recipe: recordIdOf('prd').optional().describe('A lab-made product with a recipe'),
  text: z.string().min(1).describe('How to make it, e.g. "0.05% Tween 20 in PBS"'),
  cite,
});

export const VariableKind = z
  .enum(['input', 'default', 'record', 'computed'])
  .describe(
    "input: chosen per run (samples, replicates); default: a usual value a run may change; record: read from a bound record (a lot's working concentration), with a typical value until then; computed: a formula over the others",
  );

const VariableValue = z.union([
  DecimalString,
  Quantity,
  z.array(z.union([DecimalString, Quantity])),
]);

export const SopVariable = z
  .strictObject({
    name: SopName,
    label: z.string().min(1).describe('In lab words, e.g. "Well volume"'),
    kind: VariableKind,
    value: VariableValue.optional().describe(
      'The value, the default for an input, or the typical value of a record variable',
    ),
    expression: z.string().min(1).optional().describe('For computed: a formula (ADR 0036)'),
    unit: z.string().min(1).optional().describe('The unit a computed value is given in'),
    min: z.union([DecimalString, Quantity]).optional().describe('Inputs: the least allowed'),
    max: z.union([DecimalString, Quantity]).optional().describe('Inputs: the most allowed'),
    readFrom: z
      .strictObject({
        role: SopName.describe('The material it is read from'),
        field: z.string().min(1).describe('The field on that record, e.g. "workingConcentration"'),
      })
      .optional()
      .describe('For record variables: where the value comes from once bound'),
    note: z.string().min(1).optional(),
    cite,
  })
  .refine((v) => (v.kind === 'computed') === (v.expression !== undefined), {
    message: 'A computed variable has a formula, and only a computed one',
    path: ['expression'],
  })
  .refine((v) => v.kind !== 'record' || v.readFrom !== undefined, {
    message: 'A record variable says which material and field it is read from',
    path: ['readFrom'],
  });
export type SopVariable = z.infer<typeof SopVariable>;

export const StepAction = z
  .enum([
    'add',
    'transfer',
    'serial_dilute',
    'mix',
    'wash',
    'incubate',
    'shake',
    'spin',
    'seal',
    'peel',
    'read',
    'image',
    'wait',
    'make_solution',
    'manual',
  ])
  .describe('What the step does (G2); manual for anything else, with its words in text');

/** A step parameter: a quantity, a number, a variable or words, e.g. volume = well_volume. */
export const StepParameter = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .describe('e.g. volume, duration, temperature, speed, cycles, wavelength'),
    quantity: Quantity.optional(),
    number: DecimalString.optional(),
    variable: SopName.optional().describe('A variable of this SOP'),
    text: z.string().min(1).optional().describe('When it is not a number, e.g. "room temperature"'),
  })
  .refine(
    (p) => [p.quantity, p.number, p.variable, p.text].filter((x) => x !== undefined).length === 1,
    { message: 'A parameter is one of quantity, number, variable or text' },
  );
export type StepParameter = z.infer<typeof StepParameter>;

export const SopStep = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]+$/, 'a short id like s1 or coat'),
  action: StepAction,
  title: z.string().min(1).optional().describe('A short name, e.g. "Coat"'),
  text: z.string().min(1).describe('The step in plain lab language, close to the source'),
  uses: z.array(SopName).optional().describe('The material and solution roles it uses'),
  produces: z
    .array(z.strictObject({ role: SopName, label: z.string().min(1) }))
    .optional()
    .describe('What comes out (a coated plate, a lysate), so workflows can chain SOPs (G8)'),
  parameters: z.array(StepParameter).optional(),
  repeat: z.number().int().min(2).optional().describe('Done this many times, e.g. wash 3 times'),
  group: z.string().min(1).optional().describe('Steps with the same group are shown together'),
  prerequisite: SopId.optional().describe('An SOP to follow first, e.g. making reagent diluent'),
  cite,
});
export type SopStep = z.infer<typeof SopStep>;

/** What the plate must hold (a spec for 014, not a well map). */
export const LayoutRequirement = z.strictObject({
  what: z.enum(['standards', 'samples', 'blanks', 'controls', 'other']),
  label: z.string().min(1),
  count: z
    .union([z.number().int().min(1), SopName])
    .optional()
    .describe('A number or a variable'),
  replicates: z.union([z.number().int().min(1), SopName]).optional(),
  note: z.string().min(1).optional(),
  cite,
});

export const TimingSource = z.enum(['vendor', 'lab_convention', 'lab_memory']);

/** A timing window on a step, e.g. read within 30 min of stopping; binds the scheduler (019). */
export const TimingRule = z
  .strictObject({
    step: z.string().min(1).describe('The step it constrains'),
    after: z
      .string()
      .min(1)
      .optional()
      .describe('Counted from the end of this step; default the one before'),
    min: Quantity.optional().describe('At least this long after'),
    max: Quantity.optional().describe('At most this long after'),
    target: Quantity.optional(),
    tolerance: Quantity.optional().describe('Either side of the target'),
    source: TimingSource,
    enforce: z.boolean().describe('Whether the scheduler must keep it or only warns'),
    note: z.string().min(1).optional(),
    cite,
  })
  .refine((t) => t.min || t.max || t.target, {
    message: 'A timing rule has a min, a max or a target',
  });
export type TimingRule = z.infer<typeof TimingRule>;

/** Something the source leaves unclear (G6); an open one blocks confirming. */
export const OpenQuestion = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  about: z
    .strictObject({
      step: z.string().min(1).optional(),
      variable: SopName.optional(),
      material: SopName.optional(),
    })
    .optional(),
  question: z.string().min(1),
  suggestion: z
    .string()
    .min(1)
    .optional()
    .describe('The answer the agent would pick, marked assumed'),
  passages: z.array(Citation).optional(),
  status: z.enum(['open', 'answered', 'accepted_suggestion']),
  answer: z.string().min(1).optional(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

export const SopAttributes = z.strictObject({
  purpose: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  safety: z.array(z.string().min(1)).optional(),
  assays: z.array(z.string().min(1)).optional().describe('e.g. ["ELISA"]'),
  source: z
    .strictObject({ document: DocumentId, revision: z.string().min(1).optional() })
    .optional()
    .describe('The library document it was built from'),
  derivedFrom: SopId.optional().describe('The SOP this one changes (G7)'),
  materials: z.array(SopMaterial),
  solutions: z.array(SopSolution).optional(),
  variables: z.array(SopVariable),
  steps: z.array(SopStep),
  layout: z.array(LayoutRequirement).optional(),
  analysis: z.string().min(1).optional().describe('How the readout becomes a result'),
  timing: z.array(TimingRule).optional(),
  questions: z.array(OpenQuestion).optional(),
  notes: z.string().min(1).optional(),
});
export type SopAttributes = z.infer<typeof SopAttributes>;

import { z } from 'zod';
import { RecordId, recordIdOf } from './ids.ts';
import { DocumentId, ExactSourceCitation } from './library.ts';
import { DecimalString, Quantity } from './quantity.ts';
import { QuestionDisposition, QuestionResponse, QuestionStage } from './scientific-decisions.ts';

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

/** Record kinds that can fill a role of each material type. */
export const MATERIAL_KINDS: Record<z.infer<typeof MaterialType>, readonly string[]> = {
  labware: ['labware_type', 'container'],
  reagent: ['product', 'lot'],
  entity: ['entity', 'sample'],
  instrument: ['instrument_kind', 'instrument', 'equipment_kind'],
  consumable: ['labware_type', 'product', 'lot'],
  solution: ['product', 'lot'],
};

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
    drawsFrom: SopName.optional().describe(
      'For an amount the run uses (a total volume): the material role it is drawn from, so designs check it against stock',
    ),
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
    memory: recordIdOf('mem')
      .optional()
      .describe('The lab memory it comes from (005a); required for lab_memory'),
    enforce: z.boolean().describe('Whether the scheduler must keep it or only warns'),
    note: z.string().min(1).optional(),
    cite,
  })
  .refine((t) => t.min || t.max || t.target, {
    message: 'A timing rule has a min, a max or a target',
  })
  .refine((t) => t.source !== 'lab_memory' || t.memory, {
    message: 'A timing rule from lab memory names the memory (mem_…)',
    path: ['memory'],
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

/**
 * Plan 004g replacement contract, not yet used by SopAttributes or sops.answer_question.
 * Activate only with SG-02 and the SG-10c accepted-history/future-use gate. A reply never settles it.
 */
export const ScientificQuestion = z
  .strictObject({
    id: OpenQuestion.shape.id,
    about: OpenQuestion.shape.about,
    question: z.string().min(1),
    suggestion: OpenQuestion.shape.suggestion,
    passages: z.array(ExactSourceCitation).optional(),
    stage: QuestionStage,
    responses: z.array(QuestionResponse),
    disposition: QuestionDisposition,
  })
  .superRefine((question, ctx) => {
    if (question.disposition.status === 'deferred') {
      const obligation = question.disposition.action.obligation;
      if (question.stage.stage !== obligation.stage)
        ctx.addIssue({
          code: 'custom',
          path: ['stage'],
          message: 'A deferred question uses its accepted target stage',
        });
      else if (JSON.stringify(question.stage.binding) !== JSON.stringify(obligation.binding))
        ctx.addIssue({
          code: 'custom',
          path: ['stage', 'binding'],
          message: 'A deferred question retains its accepted downstream binding',
        });
    }
  });
export type ScientificQuestion = z.infer<typeof ScientificQuestion>;

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

/**
 * One change the reviewer made (G11): a fix to a value the source settles, or a question where it
 * doesn't. `path` points into the SOP's attributes, e.g. `/steps/2/parameters/0/quantity`.
 */
export const ReviewFinding = z.object({
  type: z.enum(['fix', 'question']),
  path: z.string().describe('Where in the SOP, as a JSON pointer into its attributes'),
  before: z.unknown().optional().describe('The value before the fix; absent when it added one'),
  after: z.unknown().optional().describe('The value after the fix, or the question asked'),
  reason: z.string().min(1).describe('One line: why, e.g. "step 3 says 300 uL"'),
  cite: Citation.optional().describe('The passage the fix relied on'),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

/** One round of the AI review cycle, kept with the SOP so a person can see what the reviewer caught. */
export const SopReviewRound = z.object({
  id: z.string(),
  sop: SopId,
  round: z.number().int().positive(),
  model: z.string().describe('The reviewer model, e.g. openrouter/deepseek/deepseek-chat'),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive().optional().describe('Absent when it changed nothing'),
  findings: z.array(ReviewFinding),
  refused: z
    .array(z.object({ tool: z.string(), problem: z.string() }))
    .describe('Changes the reviewer tried that were refused, and why'),
  summary: z.string().optional().describe("The reviewer's own summary"),
  at: z.iso.datetime(),
});
export type SopReviewRound = z.infer<typeof SopReviewRound>;

/**
 * What a correct digitization of a source must contain (plan 012 G11), hand-checked or derived from
 * a machine-readable model such as LabOP. Kept in `seed/sop-benchmark/`.
 */
export const SopExpectation = z.strictObject({
  key: z.string().min(1),
  document: z.string().min(1).describe('The library document it is for, by title'),
  basis: z.string().min(1).describe('Where the expectation came from, e.g. "LabOP model"'),
  checked: z.boolean().describe('Whether a person has checked it'),
  materials: z
    .array(z.strictObject({ label: z.string().min(1), aliases: z.array(z.string()).optional() }))
    .optional(),
  steps: z
    .array(
      z.strictObject({
        action: z.union([StepAction, z.array(StepAction).min(1)]),
        quantities: z.array(Quantity).optional(),
        words: z.array(z.string().min(1)).optional(),
      }),
    )
    .optional(),
  values: z
    .array(z.strictObject({ quantity: Quantity, about: z.string().min(1).optional() }))
    .optional(),
  questions: z
    .array(z.strictObject({ about: z.string().min(1), words: z.array(z.string().min(1)).min(1) }))
    .optional(),
});
export type SopExpectation = z.infer<typeof SopExpectation>;

const SectionScore = z.object({
  expected: z.number().int(),
  found: z.number().int(),
  recall: z.number(),
  precision: z.number().optional(),
  order: z.number().optional(),
  missing: z.array(z.string()),
});

export const SopScore = z.object({
  materials: SectionScore.optional(),
  steps: SectionScore.optional(),
  values: SectionScore.optional(),
  questions: SectionScore.optional(),
  overall: z.number().describe('The mean recall of the sections expected, 0 to 1'),
});
export type SopScore = z.infer<typeof SopScore>;

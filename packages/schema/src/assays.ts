import { z } from 'zod';
import { pinOf } from './design.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { CapabilityId } from './instruments.ts';
import { LayoutId, WellRole } from './platemaps.ts';
import { DecimalString, Quantity } from './quantity.ts';
import { SopId, SopName } from './sops.ts';

/**
 * Assay templates (plan 017, D1 to D7): the lab's ready-made designers. A template ties confirmed
 * digital SOPs, a layout, default role bindings as capabilities with preferred instruments, the few
 * essential inputs, factors and levels, control and replicate rules with reasons, readouts, quality
 * criteria and the analysis plan together. It is a record, drafted by agents and confirmed by a
 * person; the designer (017b) fills an experiment from it.
 */

export const AssayTemplateId = recordIdOf('asy');

/** A short id inside a template: letters, digits and _. */
const LocalName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'a short name like samples or dilution')
  .max(40);

/** One digital SOP the assay follows, at a confirmed version (ADR 0039). */
export const TemplatePart = z.strictObject({
  id: LocalName.describe('How the template names this part, e.g. assay or seeding'),
  sop: pinOf(SopId),
  note: z.string().min(1).optional(),
});
export type TemplatePart = z.infer<typeof TemplatePart>;

/**
 * A default for one of a part's roles (D4): a capability the work needs, the instruments the lab
 * prefers for it, or a default record for a material (plate type, product). The designer binds it to
 * what the lab has, and says what it would use instead when the preferred one is missing.
 */
export const TemplateRole = z
  .strictObject({
    part: LocalName,
    role: SopName.describe("The SOP's role, e.g. reader or coating_plate"),
    capability: CapabilityId.optional().describe(
      'What the instrument must do, e.g. read_absorbance',
    ),
    preferred: z
      .array(RecordId)
      .max(10)
      .optional()
      .describe('Instruments or instrument kinds the lab prefers, first choice first'),
    record: RecordId.optional().describe('A default record for a material role'),
    version: z.number().int().positive().optional().describe('Its confirmed version'),
    reason: z.string().min(1).optional(),
  })
  .refine(
    (r) => r.capability !== undefined || r.record !== undefined,
    'give the capability the role needs, or a default record',
  );
export type TemplateRole = z.infer<typeof TemplateRole>;

/**
 * An input the designer must ask for when the request doesn't give it (D3): the subjects, or a value
 * for a part's input variable. Everything else comes from the template and lab memory, marked assumed.
 */
export const EssentialInput = z.discriminatedUnion('input', [
  z
    .strictObject({
      input: z.literal('subjects'),
      id: LocalName,
      label: z.string().min(1).describe('e.g. "Which samples"'),
      kinds: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe('Record kinds that may be subjects, e.g. ["sample"]'),
      max: z.number().int().positive().optional().describe('At most this many'),
    })
    .describe('What is tested'),
  z
    .strictObject({
      input: z.literal('variable'),
      id: LocalName,
      label: z.string().min(1).describe('e.g. "Sample dilution"'),
      part: LocalName,
      variable: SopName.describe("The part's input variable it fills"),
    })
    .describe("A value for an SOP's input variable"),
]);
export type EssentialInput = z.infer<typeof EssentialInput>;

/** One level of a factor: a record (a compound, a cell line), a quantity, or a word. */
export const FactorLevel = z.strictObject({
  id: LocalName,
  label: z.string().min(1).optional(),
  value: z.union([Quantity, RecordId, z.string().min(1)]).optional(),
});
export type FactorLevel = z.infer<typeof FactorLevel>;

/**
 * A factor (D5): something the experiment varies. Its levels are listed, or come from an essential
 * input (the subjects the person names), or from a series of concentrations.
 */
export const Factor = z
  .strictObject({
    id: LocalName,
    label: z.string().min(1).describe('e.g. "Compound" or "Time after treatment"'),
    levels: z.array(FactorLevel).min(1).max(200).optional(),
    from: LocalName.optional().describe('An essential input whose answers are the levels'),
    series: z
      .strictObject({
        top: Quantity,
        factor: DecimalString.describe('Fold between points, e.g. "3"'),
        points: z.number().int().min(2).max(48),
      })
      .optional()
      .describe('Concentrations from the top down, e.g. 10-point 3-fold from 10 µM'),
    baseline: LocalName.optional().describe(
      'The level kept while other factors vary (one factor at a time); default the first',
    ),
  })
  .refine(
    (f) => [f.levels, f.from, f.series].filter((x) => x !== undefined).length === 1,
    'give the levels, the essential input they come from, or a series: exactly one',
  );
export type Factor = z.infer<typeof Factor>;

export const DesignKind = z
  .enum(['full_factorial', 'one_factor_at_a_time'])
  .describe(
    'full_factorial: every combination of levels; one_factor_at_a_time: the baseline, then each factor varied alone',
  );
export type DesignKind = z.infer<typeof DesignKind>;

/** A control rule (D6): wells of a role on every plate or every run, and why. */
export const ControlRule = z.strictObject({
  id: LocalName,
  label: z.string().min(1).describe('e.g. "DMSO" or "IL-6 standard"'),
  role: WellRole,
  subject: RecordId.optional().describe('The compound, product or construct, when fixed'),
  wells: z.number().int().min(1).max(384),
  per: z.enum(['plate', 'run']),
  reason: z.string().min(1).describe('e.g. "16 per plate for Z\'"'),
});
export type ControlRule = z.infer<typeof ControlRule>;

/** Replicates (D6): technical (wells per condition) and biological (runs), each with its reason. */
export const ReplicateRule = z.strictObject({
  technical: z.number().int().min(1).max(16),
  biological: z.number().int().min(1).max(20).optional().describe('Runs; default 1'),
  reason: z.string().min(1),
});
export type ReplicateRule = z.infer<typeof ReplicateRule>;

/** What is read, by capability and settings, not by instrument (D4). */
export const TemplateReadout = z.strictObject({
  id: LocalName,
  label: z.string().min(1).describe('e.g. "Absorbance 450 nm"'),
  capability: CapabilityId,
  part: LocalName.optional().describe('The part whose step reads it'),
  mode: z
    .enum(['endpoint', 'kinetic', 'sequential'])
    .optional()
    .describe('sequential: several reads in order, e.g. firefly then Renilla'),
  wavelengths: z
    .array(
      z.strictObject({
        use: z.enum(['measure', 'reference', 'excitation', 'emission']),
        wavelength: Quantity,
      }),
    )
    .optional(),
  interval: Quantity.optional().describe('Kinetic reads'),
  duration: Quantity.optional().describe('Kinetic reads'),
  sequence: z.array(z.string().min(1)).optional().describe('e.g. ["firefly", "renilla"]'),
});
export type TemplateReadout = z.infer<typeof TemplateReadout>;

/** A quality criterion a result must pass (e.g. Z' at least 0.5 per plate); 020 computes it. */
export const QualityCriterion = z.strictObject({
  measure: z.string().min(1).describe("e.g. Z', CV of the standards, R² of the standard curve"),
  comparison: z.enum(['<', '<=', '>', '>=']),
  threshold: DecimalString,
  per: z.enum(['plate', 'run', 'experiment']),
});
export type QualityCriterion = z.infer<typeof QualityCriterion>;

export const AssayTemplateAttributes = z.strictObject({
  purpose: z.string().min(1).describe('What the assay measures, in a sentence'),
  assays: z.array(z.string().min(1)).optional().describe('e.g. ["ELISA"]'),
  parts: z.array(TemplatePart).min(1).max(20),
  layout: pinOf(LayoutId).optional().describe('The layout template its plates follow'),
  roles: z.array(TemplateRole).max(100).optional(),
  essentials: z
    .array(EssentialInput)
    .max(10)
    .describe('What the designer asks for, and nothing else'),
  factors: z.array(Factor).max(10).optional(),
  design: DesignKind.optional().describe('How factors combine; default full factorial'),
  controls: z.array(ControlRule).max(20).optional(),
  replicates: ReplicateRule,
  readouts: z.array(TemplateReadout).min(1).max(10),
  quality: z.array(QualityCriterion).max(10).optional(),
  analysis: z.string().min(1).optional().describe('How readouts become results (020 computes it)'),
  hitRule: z.string().min(1).optional().describe('Shown, not computed, until analysis (020)'),
  next: AssayTemplateId.optional().describe('The usual follow-up assay'),
  notes: z.string().min(1).optional(),
});
export type AssayTemplateAttributes = z.infer<typeof AssayTemplateAttributes>;

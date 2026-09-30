import { z } from 'zod';
import { Actor, UserId } from './actor.ts';
import { pinOf } from './design.ts';
import { FileId } from './files.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { ContainerId } from './inventory.ts';
import { DocumentId } from './library.ts';
import { DecimalString, Quantity } from './quantity.ts';
import { SopId, SopName } from './sops.ts';

/**
 * Campaigns, experiments and runs (plan 013, ADR 0039). A campaign is a lab project with aims; an
 * experiment is one question in it, with the SOP versions it follows; a run is one execution of an
 * experiment's confirmed design on a day. Stage is an attribute, separate from the record status.
 */

export const CampaignId = recordIdOf('cam');
export const ExperimentId = recordIdOf('exp');
export const RunId = recordIdOf('run');
export const SetId = recordIdOf('set');

/** A short id inside a record: letters, digits and _. */
const LocalName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'a short name like aim_1 or dmso')
  .max(40);

const People = {
  owner: UserId.optional().describe('Who leads it'),
  contributors: z.array(UserId).optional(),
};

export const CampaignStage = z.enum(['proposed', 'active', 'paused', 'completed', 'stopped']);
export type CampaignStage = z.infer<typeof CampaignStage>;

export const Aim = z.strictObject({
  id: LocalName,
  text: z.string().min(1).describe('What the aim is, e.g. "Find degraders of BRD4 in HEK293"'),
  success: z
    .string()
    .min(1)
    .optional()
    .describe('How you will know it is met, e.g. "Two compounds with DC50 below 100 nM"'),
});
export type Aim = z.infer<typeof Aim>;

export const CampaignAttributes = z.strictObject({
  goal: z.string().min(1).describe('What the campaign is for, in a sentence'),
  background: z.string().min(1).optional(),
  aims: z.array(Aim),
  stage: CampaignStage,
  ...People,
  starts: z.iso.date().optional(),
  ends: z.iso.date().optional(),
  about: z
    .array(RecordId)
    .optional()
    .describe('The entities it is about: a target protein, a cell line, a compound library'),
  references: z.array(DocumentId).optional().describe('Library documents behind it'),
});
export type CampaignAttributes = z.infer<typeof CampaignAttributes>;

export const ExperimentStage = z.enum([
  'designing',
  'planned',
  'running',
  'analysing',
  'concluded',
  'on_hold',
  'cancelled',
]);
export type ExperimentStage = z.infer<typeof ExperimentStage>;

export const Comparison = z.enum(['<', '<=', '>', '>=', '=']);

/** A testable prediction (E3): a measure on a readout compared with a threshold. */
export const Prediction = z.strictObject({
  readout: LocalName.describe('The readout it is measured on'),
  measure: z.string().min(1).describe("e.g. IC50, DC50, fold change, Z', percent activity"),
  subject: RecordId.optional().describe('What it is about, e.g. the compound'),
  comparison: Comparison,
  threshold: z.union([Quantity, z.string().regex(/^-?\d+(\.\d+)?$/, 'a number')]),
});
export type Prediction = z.infer<typeof Prediction>;

export const Hypothesis = z.strictObject({
  id: LocalName,
  statement: z.string().min(1).describe('In plain words'),
  prediction: Prediction.optional(),
});

/**
 * A role of the SOP bound to a record for this experiment (013b, E5). Definitions (labware types,
 * products, lots, instrument kinds, entities) are pinned by version (ADR 0039); physical things
 * (containers, samples, instruments) are bound by id and checked live.
 */
export const RoleBinding = z.strictObject({
  role: SopName,
  record: RecordId,
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'The confirmed version, for definitions; left out for containers, samples and instruments',
    ),
});
export type RoleBinding = z.infer<typeof RoleBinding>;

/** A confirmed digital SOP version the experiment follows (E5), with its roles and inputs bound. */
export const ProtocolStep = z.strictObject({
  id: LocalName.describe('How the experiment names this part, e.g. seeding or readout'),
  sop: pinOf(SopId),
  bindings: z
    .array(RoleBinding)
    .optional()
    .describe("Records for the SOP's material roles; roles left out use the SOP's default"),
  inputs: z
    .array(
      z.strictObject({
        name: SopName,
        value: z.union([DecimalString, Quantity, z.array(z.union([DecimalString, Quantity]))]),
      }),
    )
    .optional()
    .describe("Values for the SOP's input and default variables, e.g. n_samples = 40"),
  note: z.string().min(1).optional(),
});
export type ProtocolStep = z.infer<typeof ProtocolStep>;

/** What the evidence says about one hypothesis (E9). */
export const Verdict = z.strictObject({
  hypothesis: LocalName.describe("The hypothesis's id"),
  verdict: z.enum(['supported', 'refuted', 'inconclusive']),
  evidence: z
    .array(
      z.strictObject({
        record: RecordId.describe('A run, file, analysis or document that shows it'),
        note: z.string().min(1).optional(),
      }),
    )
    .optional(),
  note: z.string().min(1).optional(),
});
export type Verdict = z.infer<typeof Verdict>;

/** The conclusion of an experiment: a verdict per hypothesis and a summary (E9). */
export const Conclusion = z.strictObject({
  summary: z.string().min(1).describe('What was found, in a few sentences'),
  verdicts: z.array(Verdict).optional(),
  runs: z.array(RunId).optional().describe('The runs the conclusion rests on'),
  at: z.iso.datetime(),
  by: Actor,
});
export type Conclusion = z.infer<typeof Conclusion>;

export const ExperimentAttributes = z.strictObject({
  campaign: CampaignId,
  aim: LocalName.optional().describe("The campaign aim it serves, by the aim's id"),
  question: z.string().min(1).describe('What it asks, in a sentence'),
  hypotheses: z.array(Hypothesis).optional(),
  stage: ExperimentStage,
  ...People,
  followsUp: z
    .strictObject({
      experiment: ExperimentId,
      relation: z.enum(['follows_up', 'repeats_with_changes']),
    })
    .optional(),
  subjects: z
    .array(
      z.strictObject({
        record: RecordId.describe('An entity, sample or container being tested'),
        note: z.string().min(1).optional(),
      }),
    )
    .optional(),
  protocol: z.array(ProtocolStep),
  documents: z
    .array(
      z.strictObject({
        document: DocumentId,
        use: z
          .enum(['follows', 'reference'])
          .describe('follows: done as written, not digitized; nothing computes from it'),
      }),
    )
    .optional(),
  conditions: z
    .array(
      z.strictObject({
        id: LocalName,
        label: z.string().min(1),
        text: z.string().min(1).optional().describe('e.g. "10-point 3-fold from 10 µM"'),
      }),
    )
    .optional(),
  controls: z
    .array(
      z.strictObject({
        id: LocalName,
        label: z.string().min(1),
        role: z.enum(['positive', 'negative', 'neutral', 'vehicle', 'blank', 'standard']),
        subject: RecordId.optional().describe(
          'The compound, sample or construct used as the control',
        ),
        text: z.string().min(1).optional(),
      }),
    )
    .optional(),
  readouts: z
    .array(
      z.strictObject({
        id: LocalName,
        label: z.string().min(1).describe('e.g. "Luminescence (CellTiter-Glo)"'),
        text: z.string().min(1).optional(),
      }),
    )
    .optional(),
  successCriteria: z.array(z.string().min(1)).optional(),
  notes: z.string().min(1).optional(),
  conclusion: Conclusion.optional().describe('Set by experiments.conclude'),
});
export type ExperimentAttributes = z.infer<typeof ExperimentAttributes>;

export const RunStatus = z.enum(['scheduled', 'in_progress', 'done', 'failed', 'aborted']);
export type RunStatus = z.infer<typeof RunStatus>;

/** A planned or actual value of a step parameter: a quantity, a number or words. */
export const RunValue = z.union([Quantity, DecimalString, z.string().min(1)]);
export type RunValue = z.infer<typeof RunValue>;

/** Something that went differently from the plan (E7), with why. */
export const Deviation = z.strictObject({
  what: z.string().min(1).describe('What was different, e.g. "incubated 75 min, not 60"'),
  why: z.string().min(1),
  impact: z.string().min(1).optional().describe('What it may change in the results'),
  at: z.iso.datetime(),
  by: Actor,
});
export type Deviation = z.infer<typeof Deviation>;

/**
 * One step of the pinned SOPs as a line of the run's checklist (E7). Ticking it records the planned
 * values as done; a value typed in because it differed is an actual, and makes a deviation.
 */
export const RunStep = z.strictObject({
  part: LocalName.describe('The protocol part it belongs to'),
  step: z.string().min(1).describe('The SOP step id'),
  title: z.string().min(1),
  planned: z.array(z.strictObject({ name: z.string().min(1), value: RunValue })),
  status: z.enum(['pending', 'done', 'skipped']),
  at: z.iso.datetime().optional().describe('When it was ticked'),
  by: Actor.optional(),
  actuals: z
    .array(z.strictObject({ name: z.string().min(1), value: RunValue }))
    .optional()
    .describe('Only values that differed from the plan'),
  deviation: Deviation.omit({ at: true, by: true }).optional(),
});
export type RunStep = z.infer<typeof RunStep>;

/** One execution of an experiment's confirmed design (E2), recorded as a checklist (E7). */
export const RunAttributes = z.strictObject({
  experiment: pinOf(ExperimentId).describe('The experiment and the design version it runs'),
  status: RunStatus,
  date: z.iso.date().optional(),
  operator: UserId.optional(),
  startedAt: z.iso.datetime().optional(),
  startedBy: Actor.optional().describe(
    'A run a person started lets agents record into it directly',
  ),
  finishedAt: z.iso.datetime().optional(),
  steps: z.array(RunStep).optional(),
  deviations: z.array(Deviation).optional().describe('Deviations not tied to one step'),
  data: z
    .array(
      z.strictObject({
        file: FileId,
        part: LocalName.optional(),
        step: z.string().min(1).optional().describe('The read step it came from'),
        container: ContainerId.optional().describe('The plate it was read from'),
        note: z.string().min(1).optional(),
      }),
    )
    .optional()
    .describe('Data files that came out, e.g. reader exports (E9)'),
  notes: z.string().min(1).optional(),
});
export type RunAttributes = z.infer<typeof RunAttributes>;

/**
 * A set (E10): a named list of entities, samples or containers one experiment hands to the next
 * ("12 hits from EXP-0012, viability below 3 SD"), used as a follow-up's subjects.
 */
export const SetAttributes = z.strictObject({
  members: z
    .array(
      z.strictObject({
        record: RecordId.describe('An entity, sample or container'),
        note: z.string().min(1).optional().describe('e.g. its value that qualified it'),
      }),
    )
    .min(1),
  criterion: z.string().min(1).describe('Why these made it, e.g. "viability below 3 SD of DMSO"'),
  from: z
    .strictObject({ experiment: ExperimentId, run: RunId.optional() })
    .optional()
    .describe('The experiment (and run) that picked them'),
});
export type SetAttributes = z.infer<typeof SetAttributes>;

import { z } from 'zod';
import { UserId } from './actor.ts';
import { pinOf } from './design.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { DocumentId } from './library.ts';
import { Quantity } from './quantity.ts';
import { SopId } from './sops.ts';

/**
 * Campaigns, experiments and runs (plan 013, ADR 0039). A campaign is a lab project with aims; an
 * experiment is one question in it, with the SOP versions it follows; a run is one execution of an
 * experiment's confirmed design on a day. Stage is an attribute, separate from the record status.
 */

export const CampaignId = recordIdOf('cam');
export const ExperimentId = recordIdOf('exp');
export const RunId = recordIdOf('run');

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

/** A confirmed digital SOP version the experiment follows (E5); roles and inputs bind in 013b. */
export const ProtocolStep = z.strictObject({
  id: LocalName.describe('How the experiment names this part, e.g. seeding or readout'),
  sop: pinOf(SopId),
  note: z.string().min(1).optional(),
});
export type ProtocolStep = z.infer<typeof ProtocolStep>;

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
});
export type ExperimentAttributes = z.infer<typeof ExperimentAttributes>;

export const RunStatus = z.enum(['scheduled', 'in_progress', 'done', 'failed', 'aborted']);
export type RunStatus = z.infer<typeof RunStatus>;

/** One execution of an experiment's confirmed design (E2); step actuals come with 013c. */
export const RunAttributes = z.strictObject({
  experiment: pinOf(ExperimentId).describe('The experiment and the design version it runs'),
  status: RunStatus,
  date: z.iso.date().optional(),
  operator: UserId.optional(),
  notes: z.string().min(1).optional(),
});
export type RunAttributes = z.infer<typeof RunAttributes>;

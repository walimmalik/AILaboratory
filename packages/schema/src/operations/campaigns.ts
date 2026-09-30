import { z } from 'zod';
import {
  CampaignAttributes,
  CampaignId,
  CampaignStage,
  ExperimentAttributes,
  ExperimentId,
  ExperimentStage,
} from '../campaigns.ts';
import { EvidenceInput } from '../design.ts';
import { RecordId } from '../ids.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');
const Evidence = z
  .record(z.string(), EvidenceInput)
  .optional()
  .describe('Where values came from, by attribute name; values without a source are assumed');

const { stage: _campaignStage, ...campaignFields } = CampaignAttributes.shape;
const { stage: _experimentStage, ...experimentFields } = ExperimentAttributes.shape;

export const campaignsDraft = defineContract({
  id: 'campaigns.draft',
  summary:
    'Draft a campaign: a lab project with a goal, background, aims (each with how you will know it is met), owner and people, and the entities it is about ("BRD4 degrader screen"). It starts as proposed; a person confirms it',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('Its title, e.g. "BRD4 degrader screen"'),
    ...campaignFields,
    aims: campaignFields.aims.optional(),
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const campaignsSetStage = defineContract({
  id: 'campaigns.set_stage',
  summary:
    "Move a campaign to another stage: proposed, active, paused, completed or stopped. Only a confirmed campaign can be active; an agent's change is a proposal a person confirms",
  effect: 'write',
  input: z.strictObject({
    id: CampaignId,
    expectedVersion: z.number().int().positive(),
    stage: CampaignStage,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const experimentsDraft = defineContract({
  id: 'experiments.draft',
  summary:
    "Draft an experiment in a campaign: the question and hypotheses (each with an optional testable prediction), what is tested, the confirmed SOP versions it follows (`protocol: [{id, sop: {id, version}}]`; a version must be one a person confirmed), documents it follows that aren't digitized, conditions, controls, readouts and success criteria. It starts in designing",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('Its title, e.g. "Single-point screen of the kinase set"'),
    ...experimentFields,
    protocol: experimentFields.protocol.optional(),
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const experimentsSetStage = defineContract({
  id: 'experiments.set_stage',
  summary:
    "Move an experiment to another stage. designing → planned needs a confirmed, ready design (the design is then fixed; changing it goes back to designing). planned → running → analysing → concluded; analysing can go back to running for another run; on_hold and cancelled from any open stage, and on_hold back to an open stage. An agent's change is a proposal a person confirms",
  effect: 'write',
  input: z.strictObject({
    id: ExperimentId,
    expectedVersion: z.number().int().positive(),
    stage: ExperimentStage,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const experimentsAdoptVersions = defineContract({
  id: 'experiments.adopt_versions',
  summary:
    'Move every SOP an experiment follows to its latest confirmed version, when that version changed something. The experiment keeps its pins until someone adopts; see what changed with records.history first',
  effect: 'write',
  input: z.strictObject({
    id: ExperimentId,
    expectedVersion: z.number().int().positive(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

const Use = z.object({
  id: RecordId,
  name: z.string(),
  label: z.string(),
  stage: z.string().optional(),
  how: z.string().describe('e.g. "follows v3", "tests", "runs v2 of EXP-0004"'),
});

export const experimentsWhereUsed = defineContract({
  id: 'experiments.where_used',
  summary:
    'Every campaign, experiment and run that uses a record: an SOP (optionally one version: "which runs followed SOP-0004 v3"), an entity or sample it tests, a document, a campaign or an experiment',
  effect: 'read',
  input: z.strictObject({
    record: RecordId,
    version: z.number().int().positive().optional().describe('Only uses of this version'),
  }),
  output: z.object({
    campaigns: z.array(Use),
    experiments: z.array(Use),
    runs: z.array(Use),
  }),
});

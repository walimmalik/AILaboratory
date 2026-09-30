import { z } from 'zod';
import { UserId } from '../actor.ts';
import {
  CampaignAttributes,
  CampaignId,
  CampaignStage,
  ExperimentAttributes,
  ExperimentId,
  ExperimentStage,
  ProtocolStep,
  RoleBinding,
  RunId,
  RunValue,
  SetAttributes,
  SetId,
  Verdict,
} from '../campaigns.ts';
import { EvidenceInput } from '../design.ts';
import { FileId } from '../files.ts';
import { RecordId } from '../ids.ts';
import { ContainerId } from '../inventory.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';
import { SopName } from '../sops.ts';
import { sopsCalculate } from './sops.ts';

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

export const experimentsBindProtocol = defineContract({
  id: 'experiments.bind_protocol',
  summary:
    "Bind what an SOP the experiment follows leaves open, for one protocol part: its material roles to records (a labware type, product, lot, instrument kind or entity pinned by `version`; a container, sample or instrument by id) and its input variables (n_samples = 40). Given roles and inputs replace earlier ones; `unbind` and `clear` remove them. Then experiments.calculate works out the run's values",
  effect: 'write',
  input: z.strictObject({
    id: ExperimentId,
    expectedVersion: z.number().int().positive(),
    part: z.string().min(1).describe("The protocol part's id, e.g. coating"),
    bindings: z.array(RoleBinding).optional(),
    inputs: ProtocolStep.shape.inputs,
    unbind: z.array(SopName).optional().describe('Roles to go back to the SOP default'),
    clear: z.array(SopName).optional().describe('Inputs to go back to the SOP value'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const experimentsCalculate = defineContract({
  id: 'experiments.calculate',
  calculator: true,
  summary:
    "Work out every protocol part of an experiment as it is pinned: each SOP at its pinned version, with the experiment's bindings (read at their pinned versions) and inputs. Says where every value came from and what is still missing or does not fit, which planning needs cleared",
  effect: 'read',
  input: z.strictObject({
    id: ExperimentId,
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Work out an earlier version of the design, e.g. the one a run follows'),
  }),
  output: z.object({
    parts: z.array(
      z.object({
        part: z.string(),
        sop: z.object({ id: z.string(), name: z.string(), version: z.number().int() }),
        bindings: sopsCalculate.output.shape.bindings,
        variables: sopsCalculate.output.shape.variables,
        problems: z.array(z.string()).describe('Missing values and misfit records, in words'),
      }),
    ),
    ready: z.boolean().describe('Every value works out and every record fits'),
  }),
});

export const experimentsAdoptVersions = defineContract({
  id: 'experiments.adopt_versions',
  summary:
    'Move every SOP and bound record an experiment pins to its latest confirmed version, when that version changed something. Bindings and inputs the new SOP version no longer has are dropped and named in the reason. The experiment keeps its pins until someone adopts; see what changed with records.history first',
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

const RunTarget = {
  id: RunId,
  expectedVersion: z.number().int().positive(),
};

export const runsStart = defineContract({
  id: 'runs.start',
  summary:
    "Start a run of a planned experiment: a checklist of every step of its pinned SOPs with the planned values worked out (experiments.calculate), pinned to the design version it follows. The experiment moves to running. An agent's start is a proposal; once a person started a run, agents record into it directly",
  effect: 'write',
  input: z.strictObject({
    experiment: ExperimentId,
    label: z.string().min(1).optional().describe('e.g. "Day 1"; defaults to the date'),
    date: z.iso.date().optional().describe('Defaults to today'),
    operator: UserId.optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

const StepRef = {
  part: z.string().min(1).describe("The protocol part's id"),
  step: z.string().min(1).describe('The SOP step id'),
};

export const runsRecordStep = defineContract({
  id: 'runs.record_step',
  summary:
    'Tick a step of a run as done as planned. Give `changed` only for values that differed (with `why`), which records them as actuals and makes a deviation; `skipped` with `why` records it was not done',
  effect: 'write',
  input: z
    .strictObject({
      ...RunTarget,
      ...StepRef,
      changed: z
        .array(z.strictObject({ name: z.string().min(1), value: RunValue }))
        .optional()
        .describe(
          'Only what differed, e.g. [{"name": "duration", "value": {"value": "75", "unit": "min"}}]',
        ),
      skipped: z.literal(true).optional(),
      why: z.string().min(1).optional(),
      impact: z.string().min(1).optional(),
      reason: Reason,
    })
    .refine((i) => !(i.changed?.length || i.skipped) || i.why !== undefined, {
      message: 'Say why when a value differed or the step was skipped',
    }),
  output: RecordEnvelope,
});

export const runsDoneAsPlanned = defineContract({
  id: 'runs.done_as_planned',
  summary: "Tick every step of a run that isn't ticked yet as done as planned",
  effect: 'write',
  input: z.strictObject({ ...RunTarget, reason: Reason }),
  output: RecordEnvelope,
});

export const runsRecordDeviation = defineContract({
  id: 'runs.record_deviation',
  summary:
    "Record something that went differently in a run and is not one step's value: a plate dropped, the incubator door left open, a reagent swapped",
  effect: 'write',
  input: z.strictObject({
    ...RunTarget,
    what: z.string().min(1),
    why: z.string().min(1),
    impact: z.string().min(1).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const runsAttachData = defineContract({
  id: 'runs.attach_data',
  summary:
    'Attach a data file (upload it with files.upload first) to a run, with the read step and the plate it came from, so analysis can join reads to well contents',
  effect: 'write',
  input: z.strictObject({
    ...RunTarget,
    file: FileId,
    part: z.string().min(1).optional(),
    step: z.string().min(1).optional(),
    container: ContainerId.optional(),
    note: z.string().min(1).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const runsFinish = defineContract({
  id: 'runs.finish',
  summary:
    'Finish a run: done (every step ticked or skipped), failed or aborted, with a note. The experiment stays running until a person moves it on',
  effect: 'write',
  input: z.strictObject({
    ...RunTarget,
    status: z.enum(['done', 'failed', 'aborted']),
    note: z.string().min(1).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const runsCorrect = defineContract({
  id: 'runs.correct',
  summary:
    "Record a late actual or deviation on a finished run, e.g. from a notebook entry written after the checklist closed. Give the part and step with `changed` values when it is a step's value (kept structured like runs.record_step, so lab memory can group it), or `what` for anything else; always `why`, and `source` for where it came from. The run's finish time stays; the history shows the correction. A person's correction is recorded directly; an agent's is a proposal",
  effect: 'write',
  input: z
    .strictObject({
      ...RunTarget,
      part: z.string().min(1).optional(),
      step: z.string().min(1).optional(),
      changed: z
        .array(z.strictObject({ name: z.string().min(1), value: RunValue }))
        .min(1)
        .optional()
        .describe('The values that really differed'),
      what: z
        .string()
        .min(1)
        .optional()
        .describe("What went differently, when it is not a step's value"),
      why: z.string().min(1),
      impact: z.string().min(1).optional(),
      source: z
        .string()
        .min(1)
        .optional()
        .describe('Where it was stated, e.g. a notebook entry ID'),
      reason: Reason,
    })
    .refine((i) => (i.changed !== undefined) !== (i.what !== undefined), {
      message:
        "Give `changed` with a part and step for a step's value, or `what` for anything else",
    })
    .refine((i) => i.changed === undefined || (i.part !== undefined && i.step !== undefined), {
      message: 'Say which part and step the changed values belong to',
    }),
  output: RecordEnvelope,
});

export const experimentsConclude = defineContract({
  id: 'experiments.conclude',
  summary:
    "Conclude a running or analysing experiment: a verdict per hypothesis (supported, refuted, inconclusive) with the runs, files or analyses that show it, and a short summary. The experiment moves to concluded, which is final. An agent's conclusion is a draft a person confirms (a proposal)",
  effect: 'write',
  input: z.strictObject({
    id: ExperimentId,
    expectedVersion: z.number().int().positive(),
    summary: z.string().min(1),
    verdicts: z.array(Verdict).optional().describe('One per hypothesis, when it has hypotheses'),
    runs: z
      .array(RunId)
      .optional()
      .describe('The runs it rests on; defaults to every finished run'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const setsCreate = defineContract({
  id: 'sets.create',
  summary:
    'Make a set: a named list of entities, samples or containers one experiment hands to the next ("12 hits from EXP-0012"), with the criterion that picked them. A follow-up experiment lists the set among its subjects. An agent\'s set is a proposal a person confirms',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "BRD4 screen hits"'),
    ...SetAttributes.shape,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const setsGet = defineContract({
  id: 'sets.get',
  summary: 'A set with its members named, and the experiments that test it',
  effect: 'read',
  input: z.strictObject({ id: SetId }),
  output: z.object({
    set: RecordEnvelope,
    members: z.array(
      z.object({
        id: RecordId,
        name: z.string(),
        label: z.string(),
        kind: z.string(),
        note: z.string().optional(),
      }),
    ),
    usedBy: z.array(z.object({ id: ExperimentId, name: z.string(), label: z.string().nullable() })),
  }),
});

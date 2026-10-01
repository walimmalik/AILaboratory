import { z } from 'zod';
import { AssayTemplateAttributes, AssayTemplateId } from '../assays.ts';
import { CampaignId } from '../campaigns.ts';
import { EvidenceInput } from '../design.ts';
import { RecordId, recordIdOf } from '../ids.ts';
import { CapabilityId } from '../instruments.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');

const LocalName = z.string().regex(/^[a-z][a-z0-9_]*$/, 'a short name like samples');

export const assaysDraftTemplate = defineContract({
  id: 'assays.draft_template',
  verbs: { done: 'drafted an assay template', intent: 'draft an assay template' },
  summary:
    "Draft an assay template: the lab's ready-made designer for one assay (plan 017). Pin the confirmed digital SOPs it follows (parts) and the layout; give roles as capabilities with the instruments the lab prefers, or default records for materials; the few essential inputs the designer asks for (the subjects, or an SOP input variable); factors with levels (listed, from an essential input, or a concentration series) and the design (full factorial or one factor at a time); controls per plate or run and replicates, each with a reason; readouts by capability and settings; quality criteria and the analysis plan. Build it from a conversation, the SOPs and the lab's past experiments. A person confirms it",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "IL-6 sandwich ELISA"'),
    ...AssayTemplateAttributes.shape,
    evidence: z
      .record(z.string(), EvidenceInput)
      .optional()
      .describe('Where values came from, by attribute name; values without a source are assumed'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

const Answers = z
  .record(
    LocalName,
    z.union([
      z.number().int().min(1).max(5000),
      z.array(RecordId).min(1).max(5000),
      Quantity,
      z.string().min(1),
    ]),
  )
  .describe(
    'By essential input id: a subjects input takes a count or the records; a variable its value',
  );

const Condition = z.object({
  id: z.string(),
  levels: z.record(z.string(), z.string()),
  label: z.string(),
});

export const assaysDesign = defineContract({
  id: 'assays.design',
  verbs: { done: 'worked out an assay design', intent: 'work out an assay design' },
  summary:
    "Work out what a template gives for a request: the essential inputs still missing, the conditions (factors combined, full factorial or one factor at a time), and the wells, plates and runs from its replicate and control rules. Give a saved template (and optionally its version) or template attributes to try, and the answers to its essential inputs: for subjects a count or the records, for a variable its value. Plates hold the template layout's well count unless you give `wellsPerPlate`. Use it instead of counting conditions and wells yourself",
  effect: 'read',
  calculator: { title: 'Assay design', group: 'plates' },
  input: z.strictObject({
    template: AssayTemplateId.optional(),
    version: z.number().int().positive().optional(),
    attributes: AssayTemplateAttributes.optional().describe('A template to try without saving it'),
    answers: Answers.optional(),
    wellsPerPlate: z.number().int().min(1).max(1536).optional(),
    show: z.number().int().min(0).max(500).optional().describe('Conditions to list; default 50'),
  }),
  output: z.object({
    missing: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .describe('Essential inputs the answers leave open'),
    conditions: z.number().int().describe('How many; 0 while a factor waits for its input'),
    listed: z.array(Condition),
    more: z.number().int(),
    totals: z
      .object({
        conditions: z.number().int(),
        runs: z.number().int(),
        subjectWells: z.number().int(),
        controlWells: z.number().int(),
        plates: z.number().int().describe('Per run'),
        totalPlates: z.number().int(),
        totalWells: z.number().int(),
        spare: z.number().int().describe('Empty wells on the last plate of a run'),
      })
      .optional()
      .describe('Left out while a factor waits for its input'),
    lines: z.array(z.string()),
  }),
});

export const assaysSearch = defineContract({
  id: 'assays.search',
  verbs: { done: 'searched assay templates', intent: 'search assay templates' },
  summary:
    "The lab's assay templates, confirmed first: what each measures, its SOPs, readouts, essential inputs and status. Filter by words, an assay name (ELISA) or a readout capability. Check it before drafting a template or designing an experiment",
  effect: 'read',
  input: z.strictObject({
    text: z.string().min(1).optional().describe('Words in the name or purpose'),
    assay: z.string().min(1).optional().describe('e.g. ELISA'),
    capability: CapabilityId.optional().describe('A readout capability, e.g. read_luminescence'),
    status: z.enum(['active', 'draft', 'any']).optional().describe('Default any (not archived)'),
    limit: z.number().int().min(1).max(100).optional().describe('Default 25'),
  }),
  output: z.object({
    templates: z.array(
      z.object({
        id: AssayTemplateId,
        name: z.string(),
        label: z.string(),
        status: z.string(),
        version: z.number().int(),
        purpose: z.string(),
        assays: z.array(z.string()),
        parts: z.number().int(),
        readouts: z.array(z.string()),
        essentials: z.array(z.string()),
      }),
    ),
  }),
});

export const designerStart = defineContract({
  id: 'designer.start',
  verbs: { done: 'designed an experiment from', intent: 'design an experiment from' },
  summary:
    "Design an experiment from a confirmed assay template in one step (plan 017b): give the template, the campaign (and aim) it serves, and the answers to every essential input (check what is still needed with assays.design). It drafts the experiment with the template's SOP versions, its default role bindings and your variable values, the subjects, conditions, controls and readouts, and, when the template has a layout and the subjects are records, the plate map. Everything is drafted for a person to review and confirm; values from the template are marked as copied from it. Change the drafts with records.update and experiments.bind_protocol",
  effect: 'write',
  input: z.strictObject({
    template: AssayTemplateId,
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Default the template's current version; it must be one a person confirmed"),
    campaign: CampaignId,
    aim: LocalName.optional().describe("The campaign aim it serves, by the aim's id"),
    label: z.string().min(1).optional().describe('Default "<template>: <n> <subjects>"'),
    question: z
      .string()
      .min(1)
      .optional()
      .describe("What it asks; default the template's purpose, marked assumed"),
    answers: Answers,
    reason: Reason,
  }),
  output: z.object({
    experiment: RecordEnvelope,
    plateMap: RecordEnvelope.optional(),
    totals: z
      .object({
        conditions: z.number().int(),
        plates: z.number().int(),
        totalPlates: z.number().int(),
        totalWells: z.number().int(),
      })
      .optional(),
    lines: z.array(z.string()).describe('What was drafted, and what was left for later'),
  }),
});

export const designerFeasibility = defineContract({
  id: 'designer.feasibility',
  verbs: { done: 'checked the feasibility of', intent: 'check the feasibility of' },
  summary:
    "Check whether the lab can run an experiment designed from an assay template (plan 017b, D6), before anything is confirmed: for each instrument role and readout, the lab's registered instruments that can do it on this plate format (preferred ones first, with their status); the plates and wells from the template's rules; and the protocol amounts, with what is still missing. Use it after designer.start and after changes, and tell the person what the lab can't do and what it would use instead",
  effect: 'read',
  input: z.strictObject({
    experiment: recordIdOf('exp'),
    version: z.number().int().positive().optional().describe('Default the current version'),
  }),
  output: z.object({
    template: z.object({ id: AssayTemplateId, name: z.string(), version: z.number().int() }),
    needs: z.array(
      z.object({
        for: z
          .string()
          .describe('e.g. "the role reader in assay" or "the readout Absorbance 450 nm"'),
        capability: CapabilityId,
        instruments: z.array(
          z.object({
            id: RecordId,
            name: z.string(),
            label: z.string(),
            status: z.string(),
            preferred: z.boolean(),
          }),
        ),
        verdict: z
          .enum(['ready', 'not_ready', 'missing'])
          .describe(
            'ready: one can do it now; not_ready: only ones in maintenance or out of service',
          ),
      }),
    ),
    totals: z
      .object({
        conditions: z.number().int(),
        plates: z.number().int(),
        totalPlates: z.number().int(),
        totalWells: z.number().int(),
      })
      .optional(),
    amounts: z.object({
      ready: z.boolean(),
      problems: z.array(z.string()),
    }),
    feasible: z.boolean().describe('Every need has a ready instrument and every amount works out'),
    lines: z.array(z.string()),
  }),
});

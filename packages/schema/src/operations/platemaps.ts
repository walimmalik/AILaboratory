import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { defineContract } from '../operation.ts';
import { LayoutAttributes, LayoutId, PlatePlan } from '../platemaps.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');

export const layoutsDraft = defineContract({
  id: 'layouts.draft',
  summary:
    'Draft a layout template: the lab\'s reusable plate pattern for one format. Say the subject role and region ("compounds in columns 3-22"), fixed regions repeated on every plate (controls, blanks, a standard series), replicates and where they go, fill order, placement strategy, edges and leftovers, and how analysis groups wells. It never names samples; a plate map does. A person confirms it',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "IL-6 ELISA 96"'),
    ...LayoutAttributes.shape,
    evidence: z
      .record(z.string(), EvidenceInput)
      .optional()
      .describe('Where values came from, by attribute name; values without a source are assumed'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const layoutsPreview = defineContract({
  id: 'layouts.preview',
  summary:
    'Work out what a layout gives for a number of subjects: how many fit on a plate, how many plates, and every planned well. Give a saved layout (and optionally its version) or layout attributes to try. Use it instead of counting wells yourself',
  effect: 'read',
  calculator: true,
  input: z.strictObject({
    layout: LayoutId.optional(),
    version: z.number().int().positive().optional(),
    attributes: LayoutAttributes.optional().describe('A layout to try without saving it'),
    subjects: z.number().int().min(0).max(5000).describe('How many subjects to place'),
    seed: z.number().int().optional().describe('For the randomized and balanced strategies'),
  }),
  output: z.object({
    perPlate: z.number().int().describe('Subjects that fit on one plate'),
    plates: z.number().int(),
    wells: z.array(PlatePlan),
  }),
});

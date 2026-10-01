import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { defineContract } from '../operation.ts';
import {
  LayoutAttributes,
  LayoutId,
  PlateMapAttributes,
  PlateMapId,
  PlatePlan,
  WellOverride,
} from '../platemaps.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');

export const layoutsDraft = defineContract({
  id: 'layouts.draft',
  verbs: { done: 'drafted a plate layout', intent: 'draft a plate layout' },
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
  verbs: { done: 'previewed a plate layout', intent: 'preview a plate layout' },
  summary:
    'Work out what a layout gives for a number of subjects: how many fit on a plate, how many plates, and every planned well. Give a saved layout (and optionally its version) or layout attributes to try. Use it instead of counting wells yourself',
  effect: 'read',
  calculator: { title: 'Plate layout preview', group: 'plates' },
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

export const platemapsDraft = defineContract({
  id: 'platemaps.draft',
  verbs: { done: 'drafted a plate map', intent: 'draft a plate map' },
  summary:
    "Draft a plate map: apply a confirmed layout to real subjects (entities, samples, lots or containers, in the order they are placed) across as many plates as they need. Give the layout (its current version is pinned unless you give one), the subjects, and optionally the experiment, the plate type, records for the layout's control regions, and a strategy. Randomized and balanced maps get a seed so they rebuild exactly",
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "IL-6 ELISA, 40 supernatants"'),
    layout: LayoutId,
    layoutVersion: z.number().int().positive().optional(),
    ...PlateMapAttributes.omit({ layout: true, seed: true, overrides: true }).shape,
    seed: z.number().int().optional(),
    evidence: z.record(z.string(), EvidenceInput).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

const PlateMapWells = z.object({
  perPlate: z.number().int(),
  plates: z.array(PlatePlan),
  staleOverrides: z.array(WellOverride).describe('Hand edits that no longer land on a plate'),
});

export const platemapsWells = defineContract({
  id: 'platemaps.wells',
  verbs: { done: 'listed the wells of', intent: 'list the wells of' },
  summary:
    'Every planned well of a plate map, plate by plate: role, subject and its name, replicate, series point and concentration. What the plate editor draws and what transfer plans and analysis read',
  effect: 'read',
  input: z.strictObject({ id: PlateMapId, version: z.number().int().positive().optional() }),
  output: PlateMapWells,
});

export const platemapsOverride = defineContract({
  id: 'platemaps.override',
  verbs: { done: 'changed wells on', intent: 'change wells on' },
  summary:
    'Change wells by hand: give each well its role and optionally a subject, with a note why. `clear` removes earlier hand edits so those wells follow the layout again',
  effect: 'write',
  input: z.strictObject({
    id: PlateMapId,
    expectedVersion: z.number().int().positive(),
    overrides: z.array(WellOverride).optional(),
    clear: z.array(z.strictObject({ plate: z.number().int().min(1), well: z.string() })).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const platemapsExport = defineContract({
  id: 'platemaps.export',
  verbs: { done: 'exported', intent: 'export' },
  summary:
    "The plate map as a CSV file (plate, well, role, subject, name, replicate, point, concentration, unit), for people and for instruments that take a plate map file. The app offers it to the person as a file to download; don't copy it into your reply",
  effect: 'read',
  input: z.strictObject({ id: PlateMapId, version: z.number().int().positive().optional() }),
  output: z.object({ filename: z.string(), csv: z.string() }),
  file: ({ filename, csv }) => ({ name: filename, mediaType: 'text/csv', text: csv }),
});

export const layoutsSaveFromMap = defineContract({
  id: 'layouts.save_from_map',
  verbs: { done: "saved a plate map's layout as", intent: "save a plate map's layout as" },
  summary:
    "Save a plate map's pattern as a new layout draft: its layout with the map's strategy, and the hand edits on plate 1 that change what a well is for (controls, blanks, empty wells) as regions repeated on every plate. Hand edits that place a particular sample are left out, since a layout never names samples. A person confirms the new layout",
  effect: 'write',
  input: z.strictObject({
    map: PlateMapId,
    label: z.string().min(1).describe('e.g. "IL-6 ELISA 96, blanks in H11:H12"'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

import { z } from 'zod';
import { recordIdOf } from '../ids.ts';
import { ComputedWell, OpentronsDefinition } from '../labware.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

const LabwareTypeId = recordIdOf('lwt');

export const labwareWells = defineContract({
  id: 'labware.wells',
  summary:
    "List a labware type's wells with their names and positions (mm from the left and back edges)",
  effect: 'read',
  input: z.strictObject({
    id: LabwareTypeId,
    order: z
      .enum(['column', 'row'])
      .optional()
      .describe('column (A1, B1, C1…, the default, as liquid handlers run) or row (A1, A2, A3…)'),
  }),
  output: z.object({ wells: z.array(ComputedWell) }),
});

export const labwareImportOpentrons = defineContract({
  id: 'labware.import_opentrons',
  summary:
    'Draft a labware type from an Opentrons labware definition (JSON, schema version 2); every value is marked as imported from it',
  effect: 'write',
  input: z.strictObject({
    definition: OpentronsDefinition,
    reason: z.string().min(1).optional().describe('Why it was imported; kept in history'),
  }),
  output: RecordEnvelope,
});

export const labwareExportOpentrons = defineContract({
  id: 'labware.export_opentrons',
  summary:
    'Write a labware type as an Opentrons labware definition (schema version 2), for simulation or loading as custom labware',
  effect: 'read',
  input: z.strictObject({ id: LabwareTypeId }),
  output: z.object({ definition: OpentronsDefinition }),
});

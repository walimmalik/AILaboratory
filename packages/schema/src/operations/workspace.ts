import { z } from 'zod';
import { ExperimentId } from '../campaigns.ts';
import { defineContract } from '../operation.ts';
import { WorkspaceProjection, WorkspaceView } from '../workspace.ts';

export const experimentsWorkspace = defineContract({
  id: 'experiments.workspace',
  verbs: { done: 'opened a view of', intent: 'open a view of' },
  summary:
    'Read a bounded experiment workspace: Design with named related records, Plates with one selected map plate and up to 64 selected wells, or Transfers with a selected saved plan and paged group rows. Returns the validated selection and an Open view link; does not change scientific records or claim a browser displayed it. Versions must still be current. Unsupported view fields are refused; no search, addition selection or color metrics in this slice',
  effect: 'read',
  input: z.strictObject({
    id: ExperimentId,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Refuse if the current experiment changed; omitted for initial entry'),
    view: WorkspaceView,
  }),
  output: WorkspaceProjection,
});

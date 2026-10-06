import { z } from 'zod';
import { SopInputDecisionPreview } from './sop-input-decision.ts';
import { SopMaterial } from './sops.ts';

/** Server-owned whole material-role preview; no selected material or compatibility claim. */
export const SopMaterialDecisionPreview = SopInputDecisionPreview.omit({
  type: true,
  input: true,
  consequence: true,
}).extend({
  type: z.literal('sop_experiment_material'),
  material: SopMaterial,
  consequence: z.literal('Still requires an explicit material choice for the experiment.'),
});
export type SopMaterialDecisionPreview = z.infer<typeof SopMaterialDecisionPreview>;

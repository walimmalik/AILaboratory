import { z } from 'zod';
import { Actor } from './actor.ts';
import { DilutionCompletion } from './dilution-completion.ts';
import { RecordChange } from './operations/records.ts';
import { Quantity } from './quantity.ts';
import { QuestionDispositionRequest } from './scientific-decisions.ts';
import { SopDefaultDecisionPreview } from './sop-default-decision.ts';
import { ScientificQuestion, SopId, SopStep } from './sops.ts';

/** One strictly bounded alternative of the existing public decision preparation contract. */
export const SopDilutionDecision = z.strictObject({
  type: z.literal('dilution_final_volume'),
  sop: SopId,
  expectedVersion: z.number().int().positive(),
  question: z.string().regex(/^[a-z0-9_-]+$/),
  value: Quantity.strict(),
  passage: z.string().min(1),
  reason: z.string().trim().min(1),
});
export type SopDilutionDecision = z.infer<typeof SopDilutionDecision>;

const Calculation = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('missing'), waitsOn: z.array(z.string()).min(1) }),
  z.strictObject({
    status: z.literal('calculated'),
    final: Quantity,
    sample: Quantity,
    diluent: Quantity,
    recomposed: Quantity,
    factor: z.string(),
  }),
]);
/** Actual rollback preview; association acceptance is disclosed, full assay validation is not claimed. */
export const SopDilutionDecisionPreview = SopDefaultDecisionPreview.omit({
  type: true,
  variable: true,
  changes: true,
  questions: true,
}).extend({
  type: z.literal('sop_dilution_final_volume'),
  question: ScientificQuestion,
  step: SopStep,
  completion: DilutionCompletion,
  changes: z.array(RecordChange).min(1),
  passage: z.strictObject({
    text: z.string().min(1),
    heading: z.array(z.string()),
    page: z.number().int().positive().optional(),
  }),
  warnings: z.array(z.string()),
  calculation: z.strictObject({ before: Calculation, after: Calculation }),
  acceptance: z.strictObject({
    status: z.literal('resolved'),
    by: z.literal('applying_person'),
    proposedBy: Actor,
    action: QuestionDispositionRequest.options[0],
    relationship: z.literal(
      'The applying person accepts that this retained quotation supplies this declared dilution final volume.',
    ),
  }),
});
export type SopDilutionDecisionPreview = z.infer<typeof SopDilutionDecisionPreview>;

import { z } from 'zod';
import { Actor } from './actor.ts';
import { RecordId, RecordName } from './ids.ts';
import { QuestionDispositionRequest } from './scientific-decisions.ts';
import { DecisionReadiness } from './sop-default-decision.ts';
import { ScientificQuestion, SopId, SopVariable } from './sops.ts';

/** The existing-question selector of review.prepare_decision; the server owns its obligation. */
export const SopInputDecision = z.strictObject({
  sop: SopId,
  expectedVersion: z.number().int().positive(),
  question: z.string().regex(/^[a-z0-9_-]+$/),
  reason: z.string().trim().min(1),
});
export type SopInputDecision = z.infer<typeof SopInputDecision>;

const Fact = z.strictObject({ id: RecordId, version: z.number().int().positive() });
const Phase = z.strictObject({ target: Fact, reads: z.array(Fact), readiness: DecisionReadiness });
const Defer = QuestionDispositionRequest.options[1];

/** Exact acceptance facts; no simulated acceptor, acceptance time or scientific resolution. */
export const SopInputDecisionPreview = z.strictObject({
  type: z.literal('sop_experiment_input'),
  target: z.strictObject({
    id: SopId,
    name: RecordName,
    label: z.string().min(1),
    version: z.number().int().positive(),
  }),
  question: ScientificQuestion,
  input: SopVariable,
  reason: z.string().min(1),
  acceptance: z.strictObject({
    status: z.literal('deferred'),
    by: z.literal('applying_person'),
    proposedBy: Actor,
    action: Defer,
  }),
  before: Phase,
  after: Phase,
  changedPath: z.string().startsWith('/questions/'),
  consequence: z.literal('Still required for every experiment.'),
  methodChanges: z.literal('none'),
  sectionConfirmations: z.literal('unchanged'),
  resultingStatus: z.literal('draft'),
  finalConfirmation: z.literal('separate'),
  scientificValidation: z.literal('not_claimed'),
});
export type SopInputDecisionPreview = z.infer<typeof SopInputDecisionPreview>;

import { z } from 'zod';
import { Actor } from './actor.ts';
import {
  FieldEvidence,
  Readiness,
  ReadinessField,
  ReadinessItem,
  ReadinessSection,
} from './design.ts';
import { RecordId, RecordName } from './ids.ts';
import { RecordChange } from './operations/records.ts';
import { Quantity } from './quantity.ts';
import { SopId, SopName, SopVariable } from './sops.ts';

/** The only supported review.prepare_decision edit; the server owns preview and dependency facts. */
export const SopDefaultEdit = z.strictObject({
  sop: SopId,
  expectedVersion: z.number().int().positive(),
  variable: SopName,
  value: Quantity.strict(),
  reason: z.string().trim().min(1),
});
export type SopDefaultEdit = z.infer<typeof SopDefaultEdit>;

/** Evidence identity without a future write time or an invented applying-person identity. */
export const DecisionEvidence = FieldEvidence.omit({ at: true, by: true }).extend({
  by: z.union([Actor, z.literal('applying_person')]),
});
export type DecisionEvidence = z.infer<typeof DecisionEvidence>;

const Item = ReadinessItem.omit({ evidence: true }).extend({
  evidence: DecisionEvidence.optional(),
});
const Field = ReadinessField.omit({ evidence: true, items: true }).extend({
  evidence: DecisionEvidence.optional(),
  items: z.array(Item).optional(),
});
const Section = ReadinessSection.omit({ review: true, fields: true }).extend({
  fields: z.array(Field),
});
export const DecisionReadiness = Readiness.omit({ sections: true }).extend({
  sections: z.array(Section),
});
export type DecisionReadiness = z.infer<typeof DecisionReadiness>;

const Fact = z.strictObject({ id: RecordId, version: z.number().int().positive() });
const Phase = z.strictObject({ target: Fact, reads: z.array(Fact), readiness: DecisionReadiness });

/** Server-owned exact facts for the only supported draft-default edit. */
export const SopDefaultDecisionPreview = z.strictObject({
  type: z.literal('sop_volume_default'),
  target: z.strictObject({
    id: SopId,
    name: RecordName,
    label: z.string().min(1),
    version: z.number().int().positive(),
  }),
  variable: z.strictObject({
    name: SopName,
    label: z.string().min(1),
    path: z.string().startsWith('/variables/'),
    before: Quantity,
    after: Quantity,
  }),
  reason: z.string().min(1),
  changes: z
    .array(RecordChange.extend({ change: z.literal('changed'), before: Quantity, after: Quantity }))
    .length(1),
  before: Phase,
  after: Phase,
  evidence: z.strictObject({
    path: z.string(),
    before: DecisionEvidence.optional(),
    after: DecisionEvidence,
  }),
  confirmation: z.strictObject({
    by: z.literal('applying_person'),
    section: z.strictObject({
      id: z.literal('variables'),
      title: z.string(),
      before: z.strictObject({ variables: z.array(SopVariable) }),
      after: z.strictObject({ variables: z.array(SopVariable) }),
    }),
    evidence: z.record(z.string(), DecisionEvidence),
    assumed: z.array(z.string()),
    unchecked: z.array(z.string()),
  }),
  questions: z.array(
    z.strictObject({
      id: z.string(),
      question: z.string(),
      stage: z.enum(['method', 'experiment', 'run']),
      status: z.enum(['open', 'resolved', 'deferred']),
    }),
  ),
  remainingQuestions: z.number().int().nonnegative(),
  resultingStatus: z.literal('draft'),
  finalConfirmation: z.literal('separate'),
  scientificValidation: z.literal('not_claimed'),
});
export type SopDefaultDecisionPreview = z.infer<typeof SopDefaultDecisionPreview>;

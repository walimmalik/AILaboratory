import { z } from 'zod';
import { Actor, UserActor } from './actor.ts';
import { DilutionCompletion } from './dilution-completion.ts';
import { Sha256 } from './files.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { ExactSourceReference, SourceParseIdentity } from './library.ts';

/** Plan 004g foundation only: these contracts are not an enabled approval or SOP migration path. */
const Version = z.number().int().positive();
const QuestionId = z.string().regex(/^[a-z0-9_-]+$/);
const SopName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const Path = z.string().startsWith('/');

/** Server-stamped originating request. Unknown historical work is never grouped by conversation. */
export const OriginatingIntent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user_message'),
    conversation: z.string().regex(/^cnv_[0-9A-HJKMNP-TV-Z]{26}$/),
    message: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('unknown'),
    changeSet: z.string().min(1).optional().describe('Known original change-set boundary only'),
  }),
]);
export type OriginatingIntent = z.infer<typeof OriginatingIntent>;

const InputBinding = z.strictObject({ type: z.literal('input'), variable: SopName });
const MaterialBinding = z.strictObject({ type: z.literal('material_role'), role: SopName });
const RunCheckBinding = z.strictObject({ type: z.literal('run_check'), check: z.string().min(1) });
const ExperimentBinding = z.discriminatedUnion('type', [InputBinding, MaterialBinding]);
const RunBinding = z.discriminatedUnion('type', [InputBinding, MaterialBinding, RunCheckBinding]);

/** Names an existing declared input/role/check, not prose that invents a downstream obligation. */
export const DeferredObligation = z.discriminatedUnion('stage', [
  z.strictObject({
    stage: z.literal('experiment'),
    condition: z.string().min(1),
    binding: ExperimentBinding,
  }),
  z.strictObject({
    stage: z.literal('run'),
    condition: z.string().min(1),
    binding: RunBinding,
  }),
]);
export type DeferredObligation = z.infer<typeof DeferredObligation>;

/** Stage assignment must also be verified against the actual method by its owning operation. */
export const QuestionStage = z.discriminatedUnion('stage', [
  z.strictObject({ stage: z.literal('method'), reason: z.string().min(1) }),
  z.strictObject({
    stage: z.literal('experiment'),
    reason: z.string().min(1),
    binding: ExperimentBinding,
  }),
  z.strictObject({ stage: z.literal('run'), reason: z.string().min(1), binding: RunBinding }),
]);
export type QuestionStage = z.infer<typeof QuestionStage>;

/** A reply is an observation, never a resolution. The server supplies actor/time/version. */
export const QuestionResponse = z.strictObject({
  text: z.string().min(1),
  by: UserActor,
  at: z.iso.datetime(),
  version: Version,
});
export type QuestionResponse = z.infer<typeof QuestionResponse>;

export const RecordVersionDependency = z.strictObject({
  id: RecordId,
  version: Version,
  paths: z
    .array(Path)
    .min(1)
    .describe('Affected/read attribute paths; versions remain record-wide'),
});
export type RecordVersionDependency = z.infer<typeof RecordVersionDependency>;

/** Scientific basis cannot be reduced to an arbitrary answer string. Hard checks still apply. */
const SourceEvidence = z.strictObject({
  type: z.literal('evidence'),
  sources: z.array(ExactSourceReference.extend({ parse: SourceParseIdentity })).min(1),
  records: z.array(RecordVersionDependency),
});
export const ScientificBasis = z.union([
  SourceEvidence,
  SourceEvidence.extend({
    sources: z.array(ExactSourceReference.extend({ parse: SourceParseIdentity })).max(0),
    records: z.array(RecordVersionDependency).min(1),
  }),
  z.strictObject({
    type: z.literal('scientific_rationale'),
    rationale: z.string().min(1),
    validation: z.literal('unvalidated_method_variation'),
    sources: z.array(ExactSourceReference),
  }),
]);
export type ScientificBasis = z.infer<typeof ScientificBasis>;

/** Request inside a proposal; accepting and rechecking it produces QuestionDisposition. */
export const QuestionDispositionRequest = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('resolve'),
    sop: recordIdOf('sop'),
    expectedVersion: Version,
    question: QuestionId,
    reason: z.string().min(1),
    basis: ScientificBasis,
    affected: z.array(RecordVersionDependency).min(1),
    completion: DilutionCompletion.optional().describe(
      'Only the guarded private dilution owner may produce these accepted facts',
    ),
  }),
  z.strictObject({
    type: z.literal('defer'),
    sop: recordIdOf('sop'),
    expectedVersion: Version,
    question: QuestionId,
    reason: z.string().min(1),
    obligation: DeferredObligation,
  }),
]);
export type QuestionDispositionRequest = z.infer<typeof QuestionDispositionRequest>;

const Acceptance = {
  proposal: z.string().regex(/^prp_[0-9A-HJKMNP-TV-Z]{26}$/),
  proposedBy: Actor,
  acceptedBy: UserActor,
  at: z.iso.datetime(),
};

/** The record service keeps prior dispositions in history; no duplicate attribute snapshot here. */
export const QuestionDisposition = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('open'),
    reopened: z
      .strictObject({
        fromVersion: Version,
        reason: z.string().min(1),
        affected: z.array(RecordVersionDependency).min(1),
      })
      .optional(),
  }),
  z.strictObject({
    status: z.literal('resolved'),
    ...Acceptance,
    action: QuestionDispositionRequest.options[0],
    recheck: z.strictObject({
      version: Version,
      checks: z.array(z.strictObject({ id: z.string().min(1), passed: z.literal(true) })).min(1),
      at: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    status: z.literal('deferred'),
    ...Acceptance,
    action: QuestionDispositionRequest.options[1],
  }),
]);
export type QuestionDisposition = z.infer<typeof QuestionDisposition>;

/** Server-derived explicit confirmation scope. SOP confirmation is never part of Apply decision. */
export const ConfirmationScope = z
  .strictObject({
    type: z.literal('confirmation_scope'),
    records: z
      .array(
        z.strictObject({
          id: z
            .string()
            .regex(
              /^(?!sop_)[a-z]{2,5}_[0-9A-HJKMNP-TV-Z]{26}$/,
              'Final SOP confirmation is separate',
            ),
          version: Version,
          kind: z
            .string()
            .min(1)
            .regex(/^(?!sop$)[\s\S]+$/, 'Final SOP confirmation is separate'),
        }),
      )
      .min(1)
      .max(50)
      .describe('Exact server-derived records, in dependency order'),
  })
  .superRefine((scope, ctx) => {
    if (new Set(scope.records.map((record) => record.id)).size !== scope.records.length)
      ctx.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'A confirmation scope names each record once',
      });
  });
export type ConfirmationScope = z.infer<typeof ConfirmationScope>;

/** Stored in the existing proposal row; operationId/input still owns ordinary executable changes. */
export const ScientificDecisionMetadata = z.strictObject({
  origin: OriginatingIntent,
  reads: z.array(RecordVersionDependency),
  writes: z.array(RecordVersionDependency),
  sources: z.array(ExactSourceReference),
  previewIdentity: z.strictObject({
    digest: Sha256.describe('Digest of the server-derived exact changes/checks/consequences'),
    preparedAt: z.iso.datetime(),
  }),
  scope: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('operation_change'),
      disposition: QuestionDispositionRequest.optional(),
    }),
    z.strictObject({
      type: z.literal('question_disposition'),
      disposition: QuestionDispositionRequest,
    }),
    ConfirmationScope,
  ]),
});
export type ScientificDecisionMetadata = z.infer<typeof ScientificDecisionMetadata>;

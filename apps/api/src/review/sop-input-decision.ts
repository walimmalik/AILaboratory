import { createHash } from 'node:crypto';
import {
  type DecisionReadiness,
  ScientificDecisionMetadata as Metadata,
  type Proposal,
  type QuestionDispositionRequest,
  type RecordEnvelope,
  type ScientificDecisionMetadata,
  SopInputDecision,
  SopInputDecisionPreview,
  SopMaterialDecisionPreview,
} from '@ailab/schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { OperationError } from '../operations/errors.ts';
import {
  createProposal,
  findProposal,
  refreshPendingDecision,
  toProposal,
} from '../operations/proposal-store.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import type { SopReadinessCapture } from '../records/sop-read-capture.ts';
import {
  applyPreparedSopInputDecision,
  applyPreparedSopMaterialDecision,
  selectedSopInputDecision,
  selectedSopMaterialDecision,
} from '../sops/input-decision-authority.ts';

interface Deps {
  db: Db;
  kinds: KindRegistry;
  registry: OperationRegistry;
}
type Defer = Extract<QuestionDispositionRequest, { type: 'defer' }>;
export interface PreparedSopInput {
  input: Defer;
  preview: SopInputDecisionPreview;
  decision: ScientificDecisionMetadata;
}
export interface PreparedSopMaterial {
  input: Defer;
  preview: SopMaterialDecisionPreview;
  decision: ScientificDecisionMetadata;
}
type PreparedObligation = PreparedSopInput | PreparedSopMaterial;
type BindingKind = 'input' | 'material';
export interface SopMaterialAuthorization {
  readonly type: 'sop_material_authorization';
}
/** Opaque authorization is local to the exact held transaction; it is never serialized. */
export interface SopInputAuthorization {
  readonly type: 'sop_input_authorization';
}
const authorizations = new WeakMap<
  SopInputAuthorization | SopMaterialAuthorization,
  {
    db: Db;
    ctx: RecordContext;
    proposal: string;
    prepared: PreparedObligation;
    kind: BindingKind;
  }
>();
export type SopInputRefresh =
  | { status: 'stale' | 'refreshed'; proposal: Proposal }
  | {
      status: 'unchanged';
      proposal: Proposal;
      prepared: PreparedSopInput;
      authorization: SopInputAuthorization;
    };
export type SopMaterialRefresh =
  | { status: 'stale' | 'refreshed'; proposal: Proposal }
  | {
      status: 'unchanged';
      proposal: Proposal;
      prepared: PreparedSopMaterial;
      authorization: SopMaterialAuthorization;
    };

function refuse(message: string): never {
  throw new OperationError('invalid_input', message);
}
function transaction(db: Db) {
  if (!(db instanceof PgTransaction))
    throw new OperationError('invalid_state', 'The input decision requires its caller transaction');
}
function complete(capture: SopReadinessCapture) {
  if (capture.status !== 'complete')
    throw new OperationError(
      'unavailable',
      'The input decision could not capture every validation read',
      capture.issues,
    );
  return capture;
}
function decisionReadiness(state: SopReadinessCapture & { status: 'complete' }): DecisionReadiness {
  return {
    ...state.readiness,
    sections: state.readiness.sections.map(({ review: _review, ...section }) => ({
      ...section,
      fields: section.fields.map(({ evidence, items, ...field }) => ({
        ...field,
        ...(evidence ? { evidence: omitTime(evidence) } : {}),
        ...(items
          ? {
              items: items.map(({ evidence, ...item }) => ({
                ...item,
                ...(evidence ? { evidence: omitTime(evidence) } : {}),
              })),
            }
          : {}),
      })),
    })),
  };
}
function omitTime<T extends { at: string }>(fact: T): Omit<T, 'at'> {
  const { at: _at, ...identity } = fact;
  return identity;
}
function obligationMeaningDigest(preview: SopInputDecisionPreview | SopMaterialDecisionPreview) {
  const checks = (phase: typeof preview.before) => ({
    status: phase.readiness.status,
    ready: phase.readiness.ready,
    missing: phase.readiness.missing.toSorted(),
    assumed: phase.readiness.assumed.toSorted(),
    unchecked: phase.readiness.unchecked.toSorted(),
    notApplicable: phase.readiness.notApplicable.toSorted(),
    sections: phase.readiness.sections
      .map((s) => ({ id: s.id, state: s.state }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    checks: phase.readiness.checks.map((c) => ({
      ...c,
      ...(c.options
        ? {
            options: c.options.map((o) => {
              const { expectedVersion: _v, ...input } = o.input;
              return { ...o, input };
            }),
          }
        : {}),
    })),
  });
  const { version: _version, ...target } = preview.target;
  const { expectedVersion: _expected, ...action } = preview.acceptance.action;
  return createHash('sha256')
    .update(
      stable({
        target,
        question: preview.question,
        ...(preview.type === 'sop_experiment_input'
          ? { input: preview.input }
          : { material: preview.material }),
        reason: preview.reason,
        acceptance: { ...preview.acceptance, action },
        before: checks(preview.before),
        after: checks(preview.after),
        reads: [
          ...new Set([...preview.before.reads, ...preview.after.reads].map((r) => r.id)),
        ].sort(),
        changedPath: preview.changedPath,
        consequence: preview.consequence,
        methodChanges: preview.methodChanges,
        sectionConfirmations: preview.sectionConfirmations,
        resultingStatus: preview.resultingStatus,
        finalConfirmation: preview.finalConfirmation,
        scientificValidation: preview.scientificValidation,
      }),
    )
    .digest('hex');
}
class PreviewRollback extends Error {
  constructor(readonly prepared: PreparedObligation) {
    super('Input decision rollback');
  }
}
async function previewPhase(
  deps: Deps,
  ctx: RecordContext,
  proposal: Proposal,
  record: RecordEnvelope,
  input: SopInputDecision,
  kind: BindingKind,
): Promise<PreparedObligation> {
  const facts =
    kind === 'input'
      ? selectedSopInputDecision(record, input)
      : selectedSopMaterialDecision(record, input);
  const action = facts.action;
  try {
    await deps.db.transaction(async (tx) => {
      const local = new RecordService(tx, deps.kinds);
      await local.assertSopEditable(ctx, record.id);
      const before = complete(await local.captureSopReadiness(ctx, record.id));
      // Scope is a real server-stored proposal, including during rollback simulation.
      await refreshPendingDecision(tx, ctx, proposal.id, {
        input: action,
        preview: null,
        decision: {
          ...Metadata.parse(proposal.decision),
          scope: { type: 'question_disposition', disposition: action },
        },
      });
      const witness =
        ctx.actor.type === 'user'
          ? ctx.actor
          : { type: 'user' as const, userId: ctx.actor.onBehalfOf };
      const { approvedBy: _approval, ...unapproved } = ctx;
      const simulated = { ...unapproved, actor: witness };
      const owningWrite =
        kind === 'input' ? applyPreparedSopInputDecision : applyPreparedSopMaterialDecision;
      const updated = await owningWrite({ ...deps, db: tx }, simulated, proposal.id, action);
      const after = complete(await local.captureSopReadiness(simulated, record.id));
      const { questions: _old, ...methodBefore } = record.attributes;
      const { questions: _new, ...methodAfter } = updated.attributes;
      if (
        updated.status !== 'draft' ||
        stable(methodBefore) !== stable(methodAfter) ||
        stable(record.evidence) !== stable(updated.evidence) ||
        stable(record.reviews) !== stable(updated.reviews)
      )
        throw new OperationError(
          'internal',
          'Input acceptance changed scientific method or section reviews',
        );
      const identities = new Map<string, number>();
      for (const r of [...before.reads, ...after.reads]) {
        if (r.id === record.id) continue;
        if (identities.has(r.id) && identities.get(r.id) !== r.version)
          throw new OperationError('unavailable', 'A validation dependency changed between phases');
        identities.set(r.id, r.version);
      }
      const common = {
        target: { id: record.id, name: record.name, label: record.label, version: record.version },
        question: facts.question,
        reason: input.reason,
        acceptance: {
          status: 'deferred',
          by: 'applying_person',
          proposedBy: proposal.proposedBy,
          action,
        },
        before: {
          target: before.target,
          reads: before.reads,
          readiness: decisionReadiness(before),
        },
        after: { target: after.target, reads: after.reads, readiness: decisionReadiness(after) },
        changedPath: `/questions/${facts.question.id}/disposition`,
        methodChanges: 'none',
        sectionConfirmations: 'unchanged',
        resultingStatus: 'draft',
        finalConfirmation: 'separate',
        scientificValidation: 'not_claimed',
      };
      const preview =
        'variable' in facts
          ? SopInputDecisionPreview.parse({
              ...common,
              type: 'sop_experiment_input',
              input: facts.variable,
              consequence: 'Still required for every experiment.',
            })
          : SopMaterialDecisionPreview.parse({
              ...common,
              type: 'sop_experiment_material',
              material: facts.material,
              consequence: 'Still requires an explicit material choice for the experiment.',
            });
      const decision: ScientificDecisionMetadata = {
        origin: proposal.decision?.origin ?? { type: 'unknown' },
        reads: [...identities]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, version]) => ({ id, version, paths: ['/'] })),
        writes: [{ id: record.id, version: record.version, paths: [preview.changedPath] }],
        sources: [],
        scope: { type: 'question_disposition', disposition: action },
        previewIdentity: {
          digest: obligationMeaningDigest(preview),
          preparedAt: new Date().toISOString(),
        },
      };
      throw new PreviewRollback(
        preview.type === 'sop_experiment_input'
          ? { input: action, preview, decision }
          : { input: action, preview, decision },
      );
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.prepared;
    throw error;
  }
  throw new Error('Preview must roll back');
}

async function lockedPreview(
  deps: Deps,
  ctx: RecordContext,
  proposal: Proposal,
  input: SopInputDecision,
  kind: BindingKind,
  refresh = false,
) {
  transaction(deps.db);
  const local = new RecordService(deps.db, deps.kinds);
  const [record] = await local.lockSopDecisionRecords(ctx, [input.sop]);
  if (!record) throw new Error('Expected locked SOP');
  if (!refresh && record.version !== input.expectedVersion)
    throw new OperationError('version_conflict', 'The SOP changed before preparation');
  const locked = new Map([[record.id, record.version]]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const prepared = await previewPhase(
      deps,
      ctx,
      proposal,
      record,
      {
        ...input,
        expectedVersion: record.version,
      },
      kind,
    );
    const needed = prepared.decision.reads.filter((r) => !locked.has(r.id));
    if (locked.size + needed.length > 64)
      refuse('The limited input decision supports at most 64 read records');
    if (needed.length) {
      for (const r of await local.lockSopDecisionRecords(
        ctx,
        needed.map((r) => r.id),
      ))
        locked.set(r.id, r.version);
      continue;
    }
    if (prepared.decision.reads.some((r) => locked.get(r.id) !== r.version))
      throw new OperationError('unavailable', 'A locked dependency changed');
    return prepared;
  }
  throw new OperationError('unavailable', 'Validation dependencies changed; prepare again');
}

/** Bounded producer for the existing-question selector of review.prepare_decision. */
async function prepareSopObligationDecision(
  deps: Deps,
  ctx: RecordContext,
  raw: unknown,
  kind: BindingKind,
): Promise<Proposal> {
  const parsed = SopInputDecision.safeParse(raw);
  if (!parsed.success) refuse(parsed.error.message);
  return deps.registry.transaction(deps.db, async (tx) => {
    const local = new RecordService(tx, deps.kinds);
    const [record] = await local.lockSopDecisionRecords(ctx, [parsed.data.sop]);
    if (!record) throw new Error('Expected SOP');
    const { action } =
      kind === 'input'
        ? selectedSopInputDecision(record, parsed.data)
        : selectedSopMaterialDecision(record, parsed.data);
    const decision: ScientificDecisionMetadata = {
      origin: ctx.origin ?? { type: 'unknown' },
      reads: [],
      writes: [
        {
          id: record.id,
          version: record.version,
          paths: [`/questions/${action.question}/disposition`],
        },
      ],
      sources: [],
      scope: { type: 'question_disposition', disposition: action },
      previewIdentity: { digest: '0'.repeat(64), preparedAt: new Date().toISOString() },
    };
    const proposal = await createProposal(tx, ctx, {
      operationId: 'sops.answer_question',
      input: action,
      preview: null,
      decision,
      reason: action.reason,
    });
    const prepared = await lockedPreview({ ...deps, db: tx }, ctx, proposal, parsed.data, kind);
    return refreshPendingDecision(tx, ctx, proposal.id, prepared);
  });
}

/** Future approval caller must keep this transaction open through owning write and receipt. */
async function revalidateSopObligationDecision(
  deps: Deps,
  applying: RecordContext,
  id: string,
  expectedPreview: string,
  kind: BindingKind,
): Promise<SopInputRefresh | SopMaterialRefresh> {
  transaction(deps.db);
  if (applying.actor.type !== 'user')
    throw new OperationError('forbidden', 'A person applies this decision');
  const row = await findProposal(deps.db, applying, id, { forUpdate: true });
  const preview =
    kind === 'input'
      ? SopInputDecisionPreview.safeParse(row.preview)
      : SopMaterialDecisionPreview.safeParse(row.preview);
  const metadata = Metadata.safeParse(row.decision);
  if (
    row.status !== 'pending' ||
    row.operationId !== 'sops.answer_question' ||
    !preview.success ||
    !metadata.success ||
    metadata.data.scope.type !== 'question_disposition' ||
    metadata.data.scope.disposition.type !== 'defer' ||
    metadata.data.sources.length
  )
    refuse('This is not a supported pending experiment-input decision');
  const p = preview.data,
    d = metadata.data;
  if (d.scope.type !== 'question_disposition') refuse('Unsupported decision scope');
  if (
    d.previewIdentity.digest !== obligationMeaningDigest(p) ||
    stable(row.input) !== stable(p.acceptance.action) ||
    stable(d.scope.disposition) !== stable(row.input) ||
    stable(d.writes) !==
      stable([{ id: p.target.id, version: p.target.version, paths: [p.changedPath] }]) ||
    p.changedPath !== `/questions/${p.question.id}/disposition` ||
    p.acceptance.action.sop !== p.target.id ||
    p.acceptance.action.expectedVersion !== p.target.version ||
    p.acceptance.action.question !== p.question.id ||
    p.acceptance.action.reason !== p.reason ||
    stable(p.acceptance.proposedBy) !== stable(row.proposedBy)
  )
    refuse('Stored input decision facts are inconsistent');
  if (expectedPreview !== d.previewIdentity.digest)
    return { status: 'stale', proposal: toProposal(row) };
  const { approvedBy: _approval, ...unapproved } = applying;
  const ctx = { ...unapproved, origin: d.origin };
  const prepared = await lockedPreview(
    deps,
    ctx,
    toProposal(row),
    {
      sop: p.target.id,
      expectedVersion: p.target.version,
      question: p.question.id,
      reason: p.reason,
    },
    kind,
    true,
  );
  const proposal = await refreshPendingDecision(deps.db, ctx, id, prepared);
  if (prepared.decision.previewIdentity.digest !== d.previewIdentity.digest)
    return { status: 'refreshed', proposal };
  if (kind === 'input' && prepared.preview.type === 'sop_experiment_input') {
    const authorization: SopInputAuthorization = Object.freeze({ type: 'sop_input_authorization' });
    authorizations.set(authorization, { db: deps.db, ctx, proposal: id, prepared, kind });
    return {
      status: 'unchanged',
      proposal,
      prepared: { ...prepared, preview: prepared.preview },
      authorization,
    };
  }
  if (kind === 'material' && prepared.preview.type === 'sop_experiment_material') {
    const authorization: SopMaterialAuthorization = Object.freeze({
      type: 'sop_material_authorization',
    });
    authorizations.set(authorization, { db: deps.db, ctx, proposal: id, prepared, kind });
    return {
      status: 'unchanged',
      proposal,
      prepared: { ...prepared, preview: prepared.preview },
      authorization,
    };
  }
  throw new Error('Prepared binding changed');
}

/** No public caller accepts this authorization; it is single-use and bound to the held transaction. */
async function executeSopObligationDecision(
  deps: Deps,
  authorization: SopInputAuthorization | SopMaterialAuthorization,
  kind: BindingKind,
) {
  const scope = authorizations.get(authorization);
  if (!scope || scope.db !== deps.db || scope.kind !== kind)
    throw new OperationError(
      'forbidden',
      'No matching transaction-bound input decision authorization',
    );
  authorizations.delete(authorization);
  const row = await findProposal(deps.db, scope.ctx, scope.proposal, { forUpdate: true });
  if (
    stable(row.decision) !== stable(scope.prepared.decision) ||
    stable(row.preview) !== stable(scope.prepared.preview)
  )
    throw new OperationError('forbidden', 'The prepared decision authorization changed');
  const owningWrite =
    kind === 'input' ? applyPreparedSopInputDecision : applyPreparedSopMaterialDecision;
  return owningWrite(deps, scope.ctx, scope.proposal, scope.prepared.input);
}

export function sopInputMeaningDigest(preview: SopInputDecisionPreview) {
  return obligationMeaningDigest(preview);
}
export function sopMaterialMeaningDigest(preview: SopMaterialDecisionPreview) {
  return obligationMeaningDigest(preview);
}
/** Existing public input path stays input-only. */
export function prepareSopInputDecision(deps: Deps, ctx: RecordContext, raw: unknown) {
  return prepareSopObligationDecision(deps, ctx, raw, 'input');
}
export function revalidateSopInputDecision(
  deps: Deps,
  ctx: RecordContext,
  id: string,
  expectedPreview: string,
): Promise<SopInputRefresh> {
  return revalidateSopObligationDecision(
    deps,
    ctx,
    id,
    expectedPreview,
    'input',
  ) as Promise<SopInputRefresh>;
}
export function executeSopInputDecision(deps: Deps, authorization: SopInputAuthorization) {
  return executeSopObligationDecision(deps, authorization, 'input');
}
/** Material path uses the existing question selector and held approval transaction. */
export function prepareSopMaterialDecision(deps: Deps, ctx: RecordContext, raw: unknown) {
  return prepareSopObligationDecision(deps, ctx, raw, 'material');
}
export function revalidateSopMaterialDecision(
  deps: Deps,
  ctx: RecordContext,
  id: string,
  expectedPreview: string,
): Promise<SopMaterialRefresh> {
  return revalidateSopObligationDecision(
    deps,
    ctx,
    id,
    expectedPreview,
    'material',
  ) as Promise<SopMaterialRefresh>;
}
export function executeSopMaterialDecision(deps: Deps, authorization: SopMaterialAuthorization) {
  return executeSopObligationDecision(deps, authorization, 'material');
}

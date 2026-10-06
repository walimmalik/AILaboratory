import {
  type Actor,
  type QuestionDispositionRequest,
  type RecordEnvelope,
  ScientificDecisionMetadata,
  SopAttributes,
  type SopInputDecision,
} from '@ailab/schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { OperationError } from '../operations/errors.ts';
import { findProposal } from '../operations/proposal-store.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { operationalSop, stageProblem } from './questions.ts';

type Defer = Extract<QuestionDispositionRequest, { type: 'defer' }>;
function refuse(message: string): never {
  throw new OperationError('invalid_input', message);
}

// Only the private owning producer holds these context identities, for one awaited write.
const scopes = new WeakMap<RecordContext, { id: string; before: string; after: string }>();

async function withInputDecisionWrite<T>(
  db: Db,
  ctx: RecordContext,
  proposal: string,
  record: RecordEnvelope,
  attributes: SopAttributes,
  kind: 'input' | 'material',
  write: (scoped: RecordContext) => Promise<T>,
): Promise<T> {
  const transactionBound: boolean = db instanceof PgTransaction;
  if (!transactionBound || ctx.actor.type !== 'user')
    throw new OperationError(
      'forbidden',
      'Input acceptance requires its person and held transaction',
    );
  const row = await findProposal(db, ctx, proposal, { forUpdate: true });
  const metadata = ScientificDecisionMetadata.safeParse(row.decision);
  if (
    row.status !== 'pending' ||
    row.operationId !== 'sops.answer_question' ||
    !metadata.success ||
    metadata.data.scope.type !== 'question_disposition' ||
    metadata.data.scope.disposition.type !== 'defer'
  )
    throw new OperationError('forbidden', 'No matching pending question disposition');
  const action = metadata.data.scope.disposition;
  const old = SopAttributes.parse(record.attributes);
  const question = old.questions?.find((q) => q.id === action.question);
  const changed = attributes.questions?.find((q) => q.id === action.question);
  const acceptance = changed?.disposition;
  const facts =
    kind === 'input'
      ? selectedSopInputDecision(record, action)
      : selectedSopMaterialDecision(record, action);
  if (stable(action) !== stable(facts.action))
    throw new OperationError(
      'forbidden',
      'The obligation must name its unchanged declared binding',
    );
  if (
    action.sop !== record.id ||
    action.expectedVersion !== record.version ||
    stable(row.input) !== stable(action) ||
    question?.disposition.status !== 'open' ||
    acceptance?.status !== 'deferred' ||
    acceptance.proposal !== row.id ||
    stable(acceptance.action) !== stable(action) ||
    stable(acceptance.proposedBy) !== stable(row.proposedBy) ||
    stable(acceptance.acceptedBy) !== stable(ctx.actor)
  )
    throw new OperationError(
      'forbidden',
      'The proposal does not authorize this exact SOP question and action',
    );
  const expected = {
    ...old,
    questions: old.questions?.map((q) =>
      q.id === action.question ? { ...q, disposition: acceptance } : q,
    ),
  };
  if (stable(expected) !== stable(attributes))
    throw new OperationError(
      'forbidden',
      'Obligation acceptance may change only its selected disposition',
    );
  const scoped = { ...ctx, via: 'sops.answer_question' };
  scopes.set(scoped, {
    id: record.id,
    before: stable(record.attributes),
    after: stable(attributes),
  });
  try {
    return await write(scoped);
  } finally {
    scopes.delete(scoped);
  }
}

/** Operation names, approval identity and caller-supplied proposal IDs cannot grant this scope. */
export function assertQuestionDispositionWrite(
  ctx: RecordContext,
  id: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
) {
  if (!SopAttributes.safeParse(after).success) return;
  const was = (before?.questions ?? []) as SopAttributes['questions'];
  const now = (after.questions ?? []) as SopAttributes['questions'];
  const scope = scopes.get(ctx);
  if (scope?.id === id && scope.before === stable(before) && scope.after === stable(after)) return;
  if (was?.some((q) => q.disposition?.status === 'deferred' && !now?.some((n) => n.id === q.id)))
    throw new OperationError(
      'forbidden',
      'An accepted experiment obligation cannot be removed; it needs reconsideration.',
    );
  for (const q of now ?? []) {
    const prior = was?.find((p) => p.id === q.id);
    if (q.disposition.status !== 'open' && stable(prior?.disposition) !== stable(q.disposition))
      throw new OperationError(
        'forbidden',
        'Question disposition requires its matching prepared decision',
      );
    if (prior && stable(prior.disposition) !== stable(q.disposition))
      throw new OperationError(
        'forbidden',
        'Question disposition requires its matching prepared decision',
      );
    if (prior?.disposition.status === 'deferred') {
      const { responses: _old, ...old } = prior;
      const { responses: _new, ...changed } = q;
      if (stable(old) !== stable(changed))
        throw new OperationError(
          'invalid_input',
          'This accepted experiment obligation needs reconsideration before its question wording or scope changes; responses may still be added.',
        );
    }
  }
}

export function selectedSopInputDecision(record: RecordEnvelope, input: SopInputDecision) {
  if (record.kind !== 'sop' || record.status !== 'draft')
    refuse('Choose a never-confirmed draft SOP');
  const attributes = operationalSop(record.attributes);
  const question = attributes.questions?.find((q) => q.id === input.question);
  if (
    question?.disposition.status !== 'open' ||
    question.stage.stage !== 'experiment' ||
    question.stage.binding.type !== 'input' ||
    stageProblem(attributes, question)
  )
    refuse('Choose one existing open experiment question bound to its declared input');
  const binding = question.stage.binding;
  const variable = attributes.variables.find((v) => v.name === binding.variable);
  if (variable?.kind !== 'input') refuse('The selected input no longer exists');
  const action: Defer = {
    type: 'defer',
    sop: record.id,
    expectedVersion: record.version,
    question: question.id,
    reason: input.reason,
    obligation: {
      stage: 'experiment',
      binding: question.stage.binding,
      condition: `Supply an explicit value for ${variable.label} before the experiment is ready.`,
    },
  };
  return { attributes, question, variable, action };
}

/** The role and condition are derived only from the persisted open question. */
export function selectedSopMaterialDecision(record: RecordEnvelope, input: SopInputDecision) {
  if (record.kind !== 'sop' || record.status !== 'draft')
    refuse('Choose a never-confirmed draft SOP');
  const attributes = operationalSop(record.attributes);
  const question = attributes.questions?.find((q) => q.id === input.question);
  if (
    question?.disposition.status !== 'open' ||
    question.stage.stage !== 'experiment' ||
    question.stage.binding.type !== 'material_role' ||
    stageProblem(attributes, question)
  )
    refuse(
      'Choose one existing open experiment question bound to its declared material role without a default',
    );
  const binding = question.stage.binding;
  const material = attributes.materials.find((m) => m.role === binding.role);
  if (!material || material.default)
    refuse('The selected material role no longer permits an explicit choice');
  const action: Defer = {
    type: 'defer',
    sop: record.id,
    expectedVersion: record.version,
    question: question.id,
    reason: input.reason,
    obligation: {
      stage: 'experiment',
      binding,
      condition: `Choose ${material.label} explicitly for each experiment.`,
    },
  };
  return { attributes, question, material, action };
}

/** This private owning mutation never trusts a public proposal ID, via or approvedBy alone. */
async function applyPreparedSopObligationDecision(
  deps: { db: Db; kinds: KindRegistry },
  ctx: RecordContext,
  id: string,
  action: Defer,
  kind: 'input' | 'material',
) {
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError('invalid_state', 'Input acceptance requires its caller transaction');
  if (ctx.actor.type !== 'user')
    throw new OperationError('forbidden', 'A person accepts an experiment input');
  const row = await findProposal(deps.db, ctx, id, { forUpdate: true });
  const metadata = ScientificDecisionMetadata.safeParse(row.decision);
  if (
    row.status !== 'pending' ||
    row.operationId !== 'sops.answer_question' ||
    !metadata.success ||
    metadata.data.scope.type !== 'question_disposition' ||
    stable(metadata.data.scope.disposition) !== stable(action) ||
    stable(row.input) !== stable(action)
  )
    throw new OperationError(
      'forbidden',
      'The proposal does not authorize this exact SOP question and action',
    );
  const service = new RecordService(deps.db, deps.kinds);
  const record = await service.get(ctx, action.sop);
  await service.assertSopEditable(ctx, record.id);
  const facts =
    kind === 'input'
      ? selectedSopInputDecision(record, action)
      : selectedSopMaterialDecision(record, action);
  if (record.version !== action.expectedVersion || stable(facts.action) !== stable(action))
    throw new OperationError('version_conflict', 'The prepared question or input has changed');
  const attributes = {
    ...facts.attributes,
    questions: (facts.attributes.questions ?? []).map((q) =>
      q.id === action.question
        ? {
            ...q,
            disposition: {
              status: 'deferred' as const,
              proposal: row.id,
              proposedBy: row.proposedBy,
              acceptedBy: ctx.actor as Extract<Actor, { type: 'user' }>,
              at: new Date().toISOString(),
              action,
            },
          }
        : q,
    ),
  };
  return withInputDecisionWrite(deps.db, ctx, id, record, attributes, kind, (scoped) =>
    service.update(scoped, record.id, {
      expectedVersion: action.expectedVersion,
      attributes,
      reason: action.reason,
    }),
  );
}

/** Public input consumer keeps its existing input-only eligibility. */
export function applyPreparedSopInputDecision(
  deps: { db: Db; kinds: KindRegistry },
  ctx: RecordContext,
  id: string,
  action: Defer,
) {
  return applyPreparedSopObligationDecision(deps, ctx, id, action, 'input');
}
/** Private material owner; still requires the exact pending row and scoped write. */
export function applyPreparedSopMaterialDecision(
  deps: { db: Db; kinds: KindRegistry },
  ctx: RecordContext,
  id: string,
  action: Defer,
) {
  return applyPreparedSopObligationDecision(deps, ctx, id, action, 'material');
}

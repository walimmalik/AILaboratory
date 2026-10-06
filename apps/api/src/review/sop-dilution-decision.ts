import { createHash } from 'node:crypto';
import { diffValues, sectionValues } from '@ailab/domain';
import {
  type Proposal,
  type RecordEnvelope,
  ScientificDecisionMetadata,
  SopDilutionDecision,
  SopDilutionDecisionPreview,
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
  applyPreparedSopDilutionDecision,
  buildSopDilutionDecision,
} from '../sops/input-decision-authority.ts';
import { decisionReadiness, evidenceIdentity } from './sop-default-decision.ts';

type Deps = { db: Db; kinds: KindRegistry; registry: OperationRegistry };
export interface PreparedSopDilution {
  input: Awaited<ReturnType<typeof buildSopDilutionDecision>>['action'];
  preview: SopDilutionDecisionPreview;
  decision: ScientificDecisionMetadata;
}
export interface SopDilutionAuthorization {
  readonly type: 'sop_dilution_authorization';
}
const authorizations = new WeakMap<
  SopDilutionAuthorization,
  { db: Db; ctx: RecordContext; proposal: string; prepared: PreparedSopDilution }
>();
export type SopDilutionRefresh =
  | { status: 'stale' | 'refreshed'; proposal: Proposal }
  | {
      status: 'unchanged';
      proposal: Proposal;
      prepared: PreparedSopDilution;
      authorization: SopDilutionAuthorization;
    };
function transaction(db: Db) {
  if (!(db instanceof PgTransaction))
    throw new OperationError(
      'invalid_state',
      'Dilution decision requires its held caller transaction',
    );
}
function complete(c: SopReadinessCapture) {
  if (c.status !== 'complete')
    throw new OperationError(
      'unavailable',
      'Dilution decision could not capture every validation read',
      c.issues,
    );
  return c;
}
class PreviewRollback extends Error {
  constructor(readonly prepared: PreparedSopDilution) {
    super('Dilution preview rollback');
  }
}

/** Keep historical question facts; redact only this rollback's newly simulated acceptance. */
function normalizedAfterReadiness(
  readiness: SopDilutionDecisionPreview['after']['readiness'],
  proposal: string,
) {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if (object.status === 'resolved' && object.proposal === proposal) {
      const { acceptedBy: _person, at: _at, recheck, ...facts } = object;
      const { version: _version, at: _time, ...checks } = recheck as Record<string, unknown>;
      return { ...facts, acceptedBy: 'applying_person', recheck: checks };
    }
    return Object.fromEntries(
      Object.entries(object).map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return normalize(readiness) as typeof readiness;
}

/** Only mechanical versions/times and unrelated display notes are excluded; scientific facts remain. */
export function sopDilutionMeaningDigest(preview: SopDilutionDecisionPreview) {
  const { version: _version, ...target } = preview.target;
  const { expectedVersion: _expected, affected, ...action } = preview.acceptance.action;
  const checks = (phase: typeof preview.before) => ({
    status: phase.readiness.status,
    ready: phase.readiness.ready,
    missing: phase.readiness.missing,
    assumed: phase.readiness.assumed,
    unchecked: phase.readiness.unchecked,
    notApplicable: phase.readiness.notApplicable,
    sections: phase.readiness.sections.map(({ fields: _fields, ...s }) => s),
    checks: phase.readiness.checks.map((c) => ({
      ...c,
      ...(c.options
        ? {
            options: c.options.map((o) => {
              const { expectedVersion: _version, ...input } = o.input;
              return { ...o, input };
            }),
          }
        : {}),
    })),
  });
  return createHash('sha256')
    .update(
      stable({
        target,
        question: preview.question,
        step: preview.step,
        completion: preview.completion,
        reason: preview.reason,
        changes: preview.changes,
        passage: preview.passage,
        warnings: preview.warnings,
        calculation: preview.calculation,
        acceptance: {
          ...preview.acceptance,
          action: { ...action, affected: affected.map(({ version: _v, ...r }) => r) },
        },
        before: checks(preview.before),
        after: checks(preview.after),
        reads: [
          ...new Set([...preview.before.reads, ...preview.after.reads].map((r) => r.id)),
        ].sort(),
        confirmation: preview.confirmation,
        evidence: preview.evidence,
        remainingQuestions: preview.remainingQuestions,
        resultingStatus: preview.resultingStatus,
        finalConfirmation: preview.finalConfirmation,
        scientificValidation: preview.scientificValidation,
      }),
    )
    .digest('hex');
}

async function previewPhase(
  deps: Deps,
  ctx: RecordContext,
  proposal: Proposal,
  record: RecordEnvelope,
  input: SopDilutionDecision,
): Promise<PreparedSopDilution> {
  const facts = await buildSopDilutionDecision(deps, ctx, record, input);
  const section = deps.kinds.get('sop').sections?.find((s) => s.id === 'variables');
  if (section?.fields.length !== 1 || section.fields[0] !== 'variables')
    throw new OperationError('unavailable', 'Unsupported Values review scope');
  try {
    await deps.db.transaction(async (tx) => {
      const local = new RecordService(tx, deps.kinds);
      const file = await local.get(ctx, facts.checked.source.file);
      const fileRead = { id: file.id, version: file.version };
      const before = complete(await local.captureSopReadiness(ctx, record.id));
      await refreshPendingDecision(tx, ctx, proposal.id, {
        input: facts.action,
        preview: null,
        decision: {
          ...ScientificDecisionMetadata.parse(proposal.decision),
          scope: { type: 'question_disposition', disposition: facts.action },
        },
      });
      const witness =
        ctx.actor.type === 'user'
          ? ctx.actor
          : { type: 'user' as const, userId: ctx.actor.onBehalfOf };
      const { approvedBy: _approval, ...unapproved } = ctx;
      const simulated = { ...unapproved, actor: witness };
      const updated = await applyPreparedSopDilutionDecision(
        { ...deps, db: tx },
        simulated,
        proposal.id,
        facts.action,
      );
      const after = complete(await local.captureSopReadiness(simulated, record.id));
      if (updated.status !== 'draft')
        throw new OperationError('internal', 'Dilution completion must leave a draft');
      const reads = new Map<string, number>();
      reads.set(file.id, file.version);
      for (const r of [...before.reads, ...after.reads]) {
        if (r.id === record.id) continue;
        if (reads.has(r.id) && reads.get(r.id) !== r.version)
          throw new OperationError('unavailable', 'A validation read changed between phases');
        reads.set(r.id, r.version);
      }
      const path = `/variables/${facts.facts.final.name}`;
      const historic = new Set(Object.values(record.evidence).map(stable));
      const simulatedEvidence = new Set(
        Object.entries(updated.evidence)
          .filter(([, e]) => !historic.has(stable(e)))
          .map(([p]) => p),
      );
      const sectionPath = (p: string) => p === 'variables' || p.startsWith('/variables/');
      const evidence = updated.evidence[path];
      if (!evidence) throw new OperationError('internal', 'Accepted volume lacks evidence');
      const preview = SopDilutionDecisionPreview.parse({
        type: 'sop_dilution_final_volume',
        target: { id: record.id, name: record.name, label: record.label, version: record.version },
        question: facts.facts.question,
        step: facts.facts.step,
        completion: facts.action.completion,
        reason: input.reason,
        changes: diffValues(
          record.attributes,
          updated.attributes,
          deps.kinds.get('sop').items,
        ).filter((c) => !c.path.startsWith('/questions/')),
        passage: {
          text: facts.passage.text,
          heading: facts.passage.heading,
          ...(facts.passage.page ? { page: facts.passage.page } : {}),
        },
        warnings: facts.checked.warnings,
        calculation: facts.calculation,
        acceptance: {
          status: 'resolved',
          by: 'applying_person',
          proposedBy: proposal.proposedBy,
          action: facts.action,
          relationship:
            'The applying person accepts that this retained quotation supplies this declared dilution final volume.',
        },
        before: {
          target: before.target,
          reads: [...before.reads, fileRead],
          readiness: decisionReadiness(before.readiness),
        },
        after: {
          target: after.target,
          reads: [...after.reads, fileRead],
          readiness: normalizedAfterReadiness(
            decisionReadiness(after.readiness, simulatedEvidence),
            proposal.id,
          ),
        },
        evidence: {
          path,
          ...(record.evidence[path] ? { before: evidenceIdentity(record.evidence[path]) } : {}),
          after: evidenceIdentity(evidence, true),
        },
        confirmation: {
          by: 'applying_person',
          section: {
            id: section.id,
            title: section.title,
            before: sectionValues(section, record.attributes),
            after: sectionValues(section, updated.attributes),
          },
          evidence: Object.fromEntries(
            Object.entries(updated.evidence)
              .filter(([p]) => sectionPath(p))
              .map(([p, e]) => [p, evidenceIdentity(e, simulatedEvidence.has(p))]),
          ),
          assumed: before.readiness.assumed.filter((p) => sectionPath(p) && p !== path).sort(),
          unchecked: before.readiness.unchecked.filter((p) => sectionPath(p) && p !== path).sort(),
        },
        remainingQuestions: (facts.attributes.questions ?? []).filter(
          (q) => q.disposition.status !== 'resolved' && q.id !== input.question,
        ).length,
        resultingStatus: 'draft',
        finalConfirmation: 'separate',
        scientificValidation: 'not_claimed',
      });
      const decision: ScientificDecisionMetadata = {
        origin: proposal.decision?.origin ?? { type: 'unknown' },
        reads: [...reads]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, version]) => ({ id, version, paths: ['/'] })),
        writes: facts.action.affected,
        sources: [facts.checked.source],
        scope: { type: 'question_disposition', disposition: facts.action },
        previewIdentity: {
          digest: sopDilutionMeaningDigest(preview),
          preparedAt: new Date().toISOString(),
        },
      };
      throw new PreviewRollback({ input: facts.action, preview, decision });
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
  input: SopDilutionDecision,
  refresh = false,
) {
  transaction(deps.db);
  const local = new RecordService(deps.db, deps.kinds);
  const [record] = await local.lockSopDecisionRecords(ctx, [input.sop]);
  if (!record) throw new Error('Expected locked SOP');
  if (!refresh && record.version !== input.expectedVersion)
    throw new OperationError('version_conflict', 'SOP changed before preparation');
  const locked = new Map([[record.id, record.version]]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const prepared = await previewPhase(deps, ctx, proposal, record, {
      ...input,
      expectedVersion: record.version,
    });
    const needed = prepared.decision.reads.filter((r) => !locked.has(r.id));
    if (locked.size + needed.length > 64)
      throw new OperationError(
        'invalid_input',
        'Dilution decision supports at most 64 validation records',
      );
    if (needed.length) {
      for (const r of await local.lockSopDecisionRecords(
        ctx,
        needed.map((r) => r.id),
      ))
        locked.set(r.id, r.version);
      continue;
    }
    if (prepared.decision.reads.some((r) => locked.get(r.id) !== r.version))
      throw new OperationError('unavailable', 'A locked validation dependency changed');
    return prepared;
  }
  throw new OperationError('unavailable', 'Dilution dependencies changed during preparation');
}

/** Private stage-one producer only. Existing public preparation/approval intentionally refuse this scope. */
export async function prepareSopDilutionDecision(deps: Deps, ctx: RecordContext, raw: unknown) {
  const parsed = SopDilutionDecision.safeParse(raw);
  if (!parsed.success) throw new OperationError('invalid_input', parsed.error.message);
  return deps.registry.transaction(deps.db, async (tx) => {
    const local = new RecordService(tx, deps.kinds),
      [record] = await local.lockSopDecisionRecords(ctx, [parsed.data.sop]);
    if (!record) throw new Error('Expected SOP');
    const built = await buildSopDilutionDecision({ ...deps, db: tx }, ctx, record, parsed.data);
    const proposal = await createProposal(tx, ctx, {
      operationId: 'sops.answer_question',
      input: built.action,
      preview: null,
      reason: parsed.data.reason,
      decision: {
        origin: ctx.origin ?? { type: 'unknown' },
        reads: [],
        writes: built.action.affected,
        sources: [built.checked.source],
        scope: { type: 'question_disposition', disposition: built.action },
        previewIdentity: { digest: '0'.repeat(64), preparedAt: new Date().toISOString() },
      },
    });
    const prepared = await lockedPreview({ ...deps, db: tx }, ctx, proposal, parsed.data);
    return refreshPendingDecision(tx, ctx, proposal.id, prepared);
  });
}

export async function revalidateSopDilutionDecision(
  deps: Deps,
  applying: RecordContext,
  id: string,
  expectedPreview: string,
): Promise<SopDilutionRefresh> {
  transaction(deps.db);
  if (applying.actor.type !== 'user')
    throw new OperationError('forbidden', 'A person applies dilution completion');
  const row = await findProposal(deps.db, applying, id, { forUpdate: true });
  const preview = SopDilutionDecisionPreview.safeParse(row.preview),
    metadata = ScientificDecisionMetadata.safeParse(row.decision);
  if (
    row.status !== 'pending' ||
    row.operationId !== 'sops.answer_question' ||
    !preview.success ||
    !metadata.success ||
    metadata.data.scope.type !== 'question_disposition' ||
    metadata.data.scope.disposition.type !== 'resolve'
  )
    throw new OperationError('invalid_input', 'Not a supported pending dilution decision');
  const p = preview.data,
    d = metadata.data;
  if (d.scope.type !== 'question_disposition')
    throw new OperationError('invalid_input', 'Unsupported dilution scope');
  if (
    d.previewIdentity.digest !== sopDilutionMeaningDigest(p) ||
    stable(row.input) !== stable(p.acceptance.action) ||
    stable(d.scope.disposition) !== stable(row.input) ||
    stable(d.writes) !== stable(p.acceptance.action.affected) ||
    stable(d.sources) !== stable([p.completion.source]) ||
    stable(p.acceptance.action.completion) !== stable(p.completion) ||
    p.acceptance.action.sop !== p.target.id ||
    p.acceptance.action.question !== p.question.id ||
    p.acceptance.action.expectedVersion !== p.target.version ||
    stable(p.acceptance.proposedBy) !== stable(row.proposedBy)
  )
    throw new OperationError('invalid_input', 'Stored dilution facts are inconsistent');
  if (expectedPreview !== d.previewIdentity.digest)
    return { status: 'stale', proposal: toProposal(row) };
  const { approvedBy: _approval, ...unapproved } = applying;
  const ctx = { ...unapproved, origin: d.origin };
  const prepared = await lockedPreview(
    deps,
    ctx,
    toProposal(row),
    {
      type: 'dilution_final_volume',
      sop: p.target.id,
      expectedVersion: p.target.version,
      question: p.question.id,
      value: p.completion.value,
      passage: p.completion.passage,
      reason: p.reason,
    },
    true,
  );
  const proposal = await refreshPendingDecision(deps.db, ctx, id, prepared);
  if (prepared.decision.previewIdentity.digest !== d.previewIdentity.digest)
    return { status: 'refreshed', proposal };
  const authorization: SopDilutionAuthorization = Object.freeze({
    type: 'sop_dilution_authorization',
  });
  authorizations.set(authorization, { db: deps.db, ctx, proposal: id, prepared });
  return { status: 'unchanged', proposal, prepared, authorization };
}

export async function executeSopDilutionDecision(
  deps: Deps,
  authorization: SopDilutionAuthorization,
) {
  const scope = authorizations.get(authorization);
  if (!scope || scope.db !== deps.db)
    throw new OperationError('forbidden', 'No matching transaction-bound dilution authorization');
  authorizations.delete(authorization);
  const row = await findProposal(deps.db, scope.ctx, scope.proposal, { forUpdate: true });
  if (
    stable(row.decision) !== stable(scope.prepared.decision) ||
    stable(row.preview) !== stable(scope.prepared.preview)
  )
    throw new OperationError('forbidden', 'The dilution authorization changed');
  return applyPreparedSopDilutionDecision(deps, scope.ctx, scope.proposal, scope.prepared.input);
}

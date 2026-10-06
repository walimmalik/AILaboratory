import { createHash } from 'node:crypto';
import { compare, diffValues, getUnit, isUnit, LabDecimal, sectionValues } from '@ailab/domain';
import {
  type DecisionEvidence,
  type DecisionReadiness,
  type FieldEvidence,
  type Proposal,
  type Readiness,
  type RecordEnvelope,
  recordsUpdate,
  ScientificDecisionMetadata,
  type SopAttributes,
  SopDefaultDecisionPreview,
  SopDefaultEdit,
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
import { operationalSop } from '../sops/questions.ts';

interface Deps {
  db: Db;
  kinds: KindRegistry;
  registry: OperationRegistry;
}
export interface PreparedSopDefault {
  input: ReturnType<typeof recordsUpdate.input.parse>;
  preview: SopDefaultDecisionPreview;
  decision: ScientificDecisionMetadata;
}
export type SopDefaultRefresh =
  | { status: 'stale' | 'refreshed'; proposal: Proposal }
  | {
      status: 'unchanged';
      proposal: Proposal;
      prepared: PreparedSopDefault;
      executionContext: RecordContext;
    };

class PreviewRollback extends Error {
  constructor(readonly prepared: PreparedSopDefault) {
    super('SOP default preview rollback');
  }
}
function refuse(message: string): never {
  throw new OperationError('invalid_input', message);
}
const complete = (phase: SopReadinessCapture) => {
  if (phase.status !== 'complete')
    throw new OperationError(
      'unavailable',
      'The SOP decision could not capture all validation reads',
      phase.issues,
    );
  return phase;
};
const evidenceIdentity = (evidence: FieldEvidence, applyingPerson = false): DecisionEvidence => {
  const { at: _at, ...identity } = evidence;
  return {
    ...identity,
    by: applyingPerson && evidence.by.type === 'user' ? 'applying_person' : evidence.by,
  };
};
const decisionReadiness = (
  state: Readiness,
  simulatedEvidence: ReadonlySet<string> = new Set(),
): DecisionReadiness => ({
  ...state,
  sections: state.sections.map(({ review: _review, ...section }) => ({
    ...section,
    fields: section.fields.map(({ evidence, items, ...field }) => ({
      ...field,
      ...(evidence
        ? { evidence: evidenceIdentity(evidence, simulatedEvidence.has(field.field)) }
        : {}),
      ...(items
        ? {
            items: items.map(({ evidence: itemEvidence, ...item }) => ({
              ...item,
              ...(itemEvidence
                ? { evidence: evidenceIdentity(itemEvidence, simulatedEvidence.has(item.path)) }
                : {}),
            })),
          }
        : {}),
    })),
  })),
});

function selectedDefault(record: RecordEnvelope, edit: SopDefaultEdit) {
  if (record.kind !== 'sop' || record.status !== 'draft')
    refuse('Choose a never-confirmed draft SOP');
  const attributes = operationalSop(record.attributes);
  const variable = attributes.variables.find((v) => v.name === edit.variable);
  if (
    variable?.kind !== 'default' ||
    !variable.value ||
    Array.isArray(variable.value) ||
    typeof variable.value !== 'object'
  )
    refuse('Choose an existing scalar quantity default');
  if (variable.min !== undefined || variable.max !== undefined)
    refuse('This limited edit does not support bounded defaults');
  if (variable.cite?.length)
    refuse('A cited default needs its source reconciled before changing its value');
  if (
    attributes.questions?.some(
      (q) =>
        q.stage.stage === 'method' &&
        q.disposition.status === 'open' &&
        q.about?.variable === variable.name,
    )
  )
    refuse('An open method question names this default; use its scientific question workflow');
  const old = variable.value;
  if (!isUnit(old.unit) || getUnit(old.unit).dimension !== 'volume' || edit.value.unit !== old.unit)
    refuse('Choose a positive volume in exactly the existing unit');
  if (!new LabDecimal(old.value).greaterThan(0) || !new LabDecimal(edit.value.value).greaterThan(0))
    refuse('Both the existing and proposed volume must be positive');
  if (compare(old, edit.value) === 0) refuse('The proposed volume is unchanged');
  return { attributes, variable, old };
}

/** Meaning excludes mechanical versions, write times and display order, not affected section facts. */
export function sopDefaultMeaningDigest(preview: SopDefaultDecisionPreview): string {
  const checks = (state: DecisionReadiness) => ({
    status: state.status,
    ready: state.ready,
    missing: [...state.missing].sort(),
    assumed: [...state.assumed].sort(),
    unchecked: [...state.unchecked].sort(),
    notApplicable: [...state.notApplicable].sort(),
    sections: state.sections
      .map((s) => ({ id: s.id, state: s.state }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    checks: state.checks
      .map((check) => ({
        ...check,
        ...(check.options
          ? {
              options: check.options
                .map((option) => {
                  const { expectedVersion: _version, ...input } = option.input;
                  return { ...option, input };
                })
                .sort((a, b) => a.label.localeCompare(b.label)),
            }
          : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const values = (section: Record<string, unknown>) => ({
    ...section,
    variables: (section.variables as SopAttributes['variables']).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
  });
  const { version: _version, ...target } = preview.target;
  const meaning = {
    target,
    variable: preview.variable,
    reason: preview.reason,
    changes: preview.changes,
    before: checks(preview.before.readiness),
    after: checks(preview.after.readiness),
    reads: [...new Set([...preview.before.reads, ...preview.after.reads].map((r) => r.id))].sort(),
    evidence: preview.evidence,
    confirmation: {
      ...preview.confirmation,
      section: {
        ...preview.confirmation.section,
        before: values(preview.confirmation.section.before),
        after: values(preview.confirmation.section.after),
      },
      assumed: [...preview.confirmation.assumed].sort(),
      unchecked: [...preview.confirmation.unchecked].sort(),
    },
    questions: preview.questions.toSorted((a, b) => a.id.localeCompare(b.id)),
    remainingQuestions: preview.remainingQuestions,
    resultingStatus: preview.resultingStatus,
    finalConfirmation: preview.finalConfirmation,
    scientificValidation: preview.scientificValidation,
  };
  return createHash('sha256').update(stable(meaning)).digest('hex');
}

async function previewPhase(
  deps: Deps,
  ctx: RecordContext,
  record: RecordEnvelope,
  edit: SopDefaultEdit,
): Promise<PreparedSopDefault> {
  const { attributes, variable, old } = selectedDefault(record, edit);
  const path = `/variables/${variable.name}/value`;
  const evidencePath = `/variables/${variable.name}`;
  const section = deps.kinds.get('sop').sections?.find((s) => s.id === 'variables');
  if (section?.fields.length !== 1 || section.fields[0] !== 'variables')
    throw new OperationError('unavailable', 'The SOP Values review scope is unsupported');
  const input = recordsUpdate.input.parse({
    id: record.id,
    expectedVersion: record.version,
    reason: edit.reason,
    attributes: {
      ...attributes,
      variables: attributes.variables.map((v) =>
        v.name === variable.name ? { ...v, value: edit.value } : v,
      ),
    },
  });
  try {
    await deps.db.transaction(async (tx) => {
      const local = new RecordService(tx, deps.kinds);
      const before = complete(await local.captureSopReadiness(ctx, record.id));
      // Real authenticated preparing/applying user, solely as a rollback witness for ordinary approval effects.
      const witness =
        ctx.approvedBy ??
        (ctx.actor.type === 'user'
          ? ctx.actor
          : { type: 'user' as const, userId: ctx.actor.onBehalfOf });
      if (witness.type !== 'user')
        throw new OperationError('forbidden', 'A person must witness the approval preview');
      const simulated = { ...ctx, approvedBy: witness };
      const ran = await deps.registry.runStep(simulated, 'records.update', input, tx);
      const updated = ran.output as RecordEnvelope;
      const after = complete(await local.captureSopReadiness(simulated, record.id));
      if (updated.status !== 'draft')
        throw new OperationError('invalid_state', 'A default decision must leave the SOP draft');
      const identities = new Map<string, number>();
      for (const read of [...before.reads, ...after.reads]) {
        if (read.id === record.id) continue;
        const prior = identities.get(read.id);
        if (prior !== undefined && prior !== read.version)
          throw new OperationError(
            'unavailable',
            'A dependency changed between SOP preview phases',
          );
        identities.set(read.id, read.version);
      }
      const afterEvidence = updated.evidence[evidencePath];
      if (!afterEvidence)
        throw new OperationError('internal', 'The changed default has no ordinary evidence');
      // The supported update rewrites both the parent array and selected item. Keep exact
      // historical facts (including inherited item evidence); replace every new human stamp.
      const historicalEvidence = new Set(Object.values(record.evidence).map(stable));
      const simulatedEvidence = new Set(
        Object.entries(updated.evidence)
          .filter(
            ([p, e]) =>
              p === 'variables' || p === evidencePath || !historicalEvidence.has(stable(e)),
          )
          .map(([p]) => p),
      );
      const sectionPath = (p: string) => p === 'variables' || p.startsWith('/variables/');
      const assumed = before.readiness.assumed.filter((p) => sectionPath(p) && p !== evidencePath);
      if (afterEvidence.source === 'assumed') assumed.push(evidencePath);
      const preview = SopDefaultDecisionPreview.parse({
        type: 'sop_volume_default',
        target: { id: record.id, name: record.name, label: record.label, version: record.version },
        variable: {
          name: variable.name,
          label: variable.label,
          path,
          before: old,
          after: edit.value,
        },
        reason: edit.reason,
        changes: diffValues(record.attributes, updated.attributes, deps.kinds.get('sop').items),
        before: {
          target: before.target,
          reads: before.reads,
          readiness: decisionReadiness(before.readiness),
        },
        after: {
          target: after.target,
          reads: after.reads,
          readiness: decisionReadiness(after.readiness, simulatedEvidence),
        },
        evidence: {
          path: evidencePath,
          ...(record.evidence[evidencePath]
            ? { before: evidenceIdentity(record.evidence[evidencePath]) }
            : {}),
          after: evidenceIdentity(afterEvidence, true),
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
          assumed: [...new Set(assumed)].sort(),
          unchecked: before.readiness.unchecked
            .filter((p) => sectionPath(p) && p !== evidencePath)
            .sort(),
        },
        questions: (attributes.questions ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          stage: q.stage.stage,
          status: q.disposition.status,
        })),
        remainingQuestions: (attributes.questions ?? []).filter(
          (q) => q.disposition.status !== 'resolved',
        ).length,
        resultingStatus: 'draft',
        finalConfirmation: 'separate',
        scientificValidation: 'not_claimed',
      });
      const decision: ScientificDecisionMetadata = {
        origin: ctx.origin ?? { type: 'unknown' },
        reads: [...identities]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, version]) => ({ id, version, paths: ['/'] })),
        writes: [{ id: record.id, version: record.version, paths: [path] }],
        sources: [],
        scope: { type: 'operation_change' },
        previewIdentity: {
          digest: sopDefaultMeaningDigest(preview),
          preparedAt: new Date().toISOString(),
        },
      };
      throw new PreviewRollback({ input, preview, decision });
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.prepared;
    throw error;
  }
  throw new Error('The SOP preview must roll back');
}

/** Caller transaction owns these locks until Apply commits; bounded discovery is re-previewed under every observed lock. */
export async function lockedSopDefaultPreview(
  deps: Deps,
  ctx: RecordContext,
  edit: SopDefaultEdit,
  refresh = false,
): Promise<PreparedSopDefault> {
  const local = new RecordService(deps.db, deps.kinds);
  const [record] = await local.lockSopDecisionRecords(ctx, [edit.sop]);
  if (!record) throw new Error('Expected the locked SOP');
  if (!refresh && record.version !== edit.expectedVersion)
    throw new OperationError(
      'version_conflict',
      'The SOP changed before this decision was prepared',
    );
  const locked = new Map([[record.id, record.version]]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const prepared = await previewPhase(deps, ctx, record, {
      ...edit,
      expectedVersion: record.version,
    });
    const needed = prepared.decision.reads.filter((r) => !locked.has(r.id));
    if (locked.size + needed.length > 64)
      refuse('This limited SOP decision supports at most 64 read records');
    if (needed.length) {
      for (const r of await local.lockSopDecisionRecords(
        ctx,
        needed.map((r) => r.id),
      ))
        locked.set(r.id, r.version);
      continue;
    }
    if (prepared.decision.reads.some((r) => locked.get(r.id) !== r.version))
      throw new OperationError('unavailable', 'A locked SOP dependency changed during preview');
    return prepared;
  }
  throw new OperationError(
    'unavailable',
    'The SOP dependencies changed during preparation; prepare again',
  );
}

/** Bounded producer used by review.prepare_decision; stores one existing proposal row. */
export async function prepareSopDefaultDecision(
  deps: Deps,
  ctx: RecordContext,
  rawInput: unknown,
): Promise<Proposal> {
  const parsed = SopDefaultEdit.safeParse(rawInput);
  if (!parsed.success) throw new OperationError('invalid_input', parsed.error.message);
  return deps.registry.transaction(deps.db, async (tx) => {
    const prepared = await lockedSopDefaultPreview({ ...deps, db: tx }, ctx, parsed.data);
    return createProposal(tx, ctx, {
      operationId: 'records.update',
      ...prepared,
      reason: parsed.data.reason,
    });
  });
}

/** Sole approval consumer keeps this transaction open through execution and durable receipt. */
export async function revalidateSopDefaultDecision(
  deps: Deps,
  applying: RecordContext,
  id: string,
  expectedPreview: string,
): Promise<SopDefaultRefresh> {
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError(
      'invalid_state',
      'Decision revalidation requires the caller approval transaction',
    );
  if (applying.actor.type !== 'user')
    throw new OperationError('forbidden', 'A person applies a prepared decision');
  const row = await findProposal(deps.db, applying, id, { forUpdate: true });
  const parsed = SopDefaultDecisionPreview.safeParse(row.preview);
  const metadata = ScientificDecisionMetadata.safeParse(row.decision);
  if (
    row.status !== 'pending' ||
    row.operationId !== 'records.update' ||
    !parsed.success ||
    !metadata.success ||
    metadata.data.scope.type !== 'operation_change' ||
    metadata.data.scope.disposition ||
    metadata.data.sources.length
  )
    throw new OperationError(
      'invalid_input',
      'This is not a supported pending SOP default decision',
    );
  const decision = metadata.data;
  const preview = parsed.data;
  const write = decision.writes[0];
  if (
    decision.writes.length !== 1 ||
    write?.id !== preview.target.id ||
    write.version !== preview.target.version ||
    stable(write.paths) !== stable([preview.variable.path]) ||
    preview.variable.path !== `/variables/${preview.variable.name}/value` ||
    decision.previewIdentity.digest !== sopDefaultMeaningDigest(preview)
  )
    throw new OperationError('invalid_input', 'The stored SOP decision facts are inconsistent');
  if (expectedPreview !== decision.previewIdentity.digest)
    return { status: 'stale', proposal: toProposal(row) };
  const executionContext: RecordContext = {
    ...applying,
    actor: row.proposedBy.type === 'agent' ? row.proposedBy : applying.actor,
    approvedBy: applying.actor,
    origin: decision.origin,
  };
  const prepared = await lockedSopDefaultPreview(
    deps,
    executionContext,
    {
      sop: preview.target.id,
      expectedVersion: preview.target.version,
      variable: preview.variable.name,
      value: preview.variable.after,
      reason: preview.reason,
    },
    true,
  );
  const proposal = await refreshPendingDecision(deps.db, applying, id, prepared);
  if (prepared.decision.previewIdentity.digest !== decision.previewIdentity.digest)
    return { status: 'refreshed', proposal };
  return { status: 'unchanged', proposal, prepared, executionContext };
}

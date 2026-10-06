import { type EvidenceInput, SopAttributes } from '@ailab/schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { OperationError } from '../operations/errors.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import { RecordError } from '../records/errors.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService, type UpdateRecordInput } from '../records/service.ts';
import { citationsOf } from './citations.ts';
import { canonicalizeSopExactSource } from './exact-source.ts';

type Deps = { db: Db; kinds: KindRegistry; registry: OperationRegistry };
const scopes = new WeakMap<RecordContext, { id: string; before: string; after: string }>();

/** Existing operation ownership seam: operation names/approval identities grant no exact scope. */
export function assertSopExactSourceWrite(
  db: Db,
  ctx: RecordContext,
  id: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
) {
  const prior = before as Partial<SopAttributes> | undefined;
  const next = after as Partial<SopAttributes>;
  const sourceFree = !prior || (!prior.source && citationsOf(prior).length === 0);
  if (sourceFree && !next.source?.exact && (next.source || citationsOf(next).length))
    throw new OperationError(
      'invalid_input',
      'A new source-linked SOP requires one explicitly selected exact edition through sops.draft; a source-free draft cannot add an unbound association',
    );
  if (!prior?.source?.exact && !next.source?.exact) return;
  const scope = scopes.get(ctx);
  if (
    db instanceof PgTransaction &&
    scope?.id === id &&
    scope.before === stable(before) &&
    scope.after === stable(after)
  )
    return;
  if (stable(prior?.source) !== stable(next.source))
    throw new OperationError(
      'forbidden',
      'Exact SOP instructions require the owning validated draft operation; generic writes cannot attach, replace or remove them',
    );
  if (stable(citationsOf(prior as Partial<SopAttributes>)) !== stable(citationsOf(next)))
    throw new OperationError(
      'forbidden',
      'Exact SOP citations require the owning validated source operation',
    );
}

async function withWrite<T>(
  deps: Deps,
  ctx: RecordContext,
  id: string,
  before: unknown,
  after: SopAttributes,
  write: (scoped: RecordContext) => Promise<T>,
) {
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError(
      'invalid_state',
      'Exact source writes require their caller transaction',
    );
  const scoped = { ...ctx };
  scopes.set(scoped, { id, before: stable(before), after: stable(after) });
  try {
    return await write(scoped);
  } finally {
    scopes.delete(scoped);
  }
}

/** Private prepared dilution owner composes exact citation and question witnesses for one write. */
export async function withPreparedDilutionSourceWrite<T>(
  deps: Deps,
  ctx: RecordContext,
  current: Awaited<ReturnType<RecordService['get']>>,
  candidate: SopAttributes,
  write: (scoped: RecordContext, attributes: SopAttributes) => Promise<T>,
) {
  if (
    ctx.via !== 'sops.answer_question' ||
    !candidate.source?.exact ||
    stable(current.attributes.source) !== stable(candidate.source)
  )
    throw new OperationError(
      'forbidden',
      'Prepared dilution must preserve its established exact instructions',
    );
  const { attributes, result } = await canonicalizeSopExactSource(deps, ctx, candidate);
  if (result.status !== 'checked')
    throw new OperationError('invalid_input', 'The dilution needs checked exact text');
  return withWrite(deps, ctx, current.id, current.attributes, attributes, (scoped) =>
    write(scoped, attributes),
  );
}

/** Owning draft creation validates the selected edition inside the caller transaction. */
export async function createExactSopDraft(
  deps: Deps,
  ctx: RecordContext,
  input: {
    label: string;
    attributes: SopAttributes;
    reason?: string;
    evidence?: Record<string, EvidenceInput>;
  },
) {
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError(
      'invalid_state',
      'Exact source writes require their caller transaction',
    );
  if (!input.attributes.source?.exact)
    throw new OperationError(
      'invalid_input',
      'Select one explicit exact source for this new draft',
    );
  const { attributes, result } = await canonicalizeSopExactSource(deps, ctx, input.attributes);
  const record = await withWrite(
    deps,
    { ...ctx, via: 'sops.draft' },
    '',
    undefined,
    attributes,
    (scoped) =>
      new RecordService(deps.db, deps.kinds).create(scoped, {
        kind: 'sop',
        label: input.label,
        attributes,
        ...(input.evidence ? { evidence: input.evidence } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      }),
  );
  return { record, source: result };
}

/** Citation validation on an existing unchanged root; this is never source adoption. */
export async function updateExactSopCitations(
  deps: Deps,
  ctx: RecordContext,
  input: { sop: string; expectedVersion: number; attributes: SopAttributes; reason?: string },
) {
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError(
      'invalid_state',
      'Exact source writes require their caller transaction',
    );
  const service = new RecordService(deps.db, deps.kinds);
  const current = await service.get(ctx, input.sop);
  await service.assertSopEditable(ctx, current.id);
  const before = SopAttributes.parse(current.attributes);
  if (!before.source?.exact || stable(before.source) !== stable(input.attributes.source))
    throw new OperationError(
      'forbidden',
      'Preserve the saved exact source; adoption is a separate decision',
    );
  const { attributes, result } = await canonicalizeSopExactSource(deps, ctx, input.attributes);
  // No other value or question change is authorized by this private citation scope.
  const withoutCitations = (a: SopAttributes) => {
    const copy = structuredClone(a);
    for (const item of [
      ...copy.materials,
      ...(copy.solutions ?? []),
      ...copy.variables,
      ...copy.steps,
      ...(copy.layout ?? []),
      ...(copy.timing ?? []),
    ])
      delete item.cite;
    for (const question of copy.questions ?? []) delete question.passages;
    return copy;
  };
  if (stable(withoutCitations(before)) !== stable(withoutCitations(attributes)))
    throw new OperationError(
      'forbidden',
      'Citation validation cannot change scientific values or questions',
    );
  const record = await withWrite(deps, ctx, current.id, before, attributes, (scoped) =>
    service.update(scoped, current.id, {
      expectedVersion: input.expectedVersion,
      attributes,
      ...(input.reason ? { reason: input.reason } : {}),
    }),
  );
  return { record, source: result };
}

/** Owning review/question writes validate all citations while preserving the established source. */
export async function updateSourceCheckedSop(
  deps: Deps,
  ctx: RecordContext,
  input: {
    sop: string;
    expectedVersion: number;
    attributes: SopAttributes;
    evidence?: Record<string, EvidenceInput>;
    reason?: string;
  },
) {
  if (!['sops.review', 'sops.ask_question'].includes(ctx.via ?? ''))
    throw new OperationError(
      'forbidden',
      'Source-checked changes belong to SOP review/question operations',
    );
  const transactionBound: boolean = deps.db instanceof PgTransaction;
  if (!transactionBound)
    throw new OperationError(
      'invalid_state',
      'Source-checked writes require their caller transaction',
    );
  const service = new RecordService(deps.db, deps.kinds);
  const current = await service.get(ctx, input.sop);
  await service.assertSopEditable(ctx, current.id);
  const before = SopAttributes.parse(current.attributes);
  if (stable(before.source) !== stable(input.attributes.source))
    throw new OperationError(
      'forbidden',
      'Preserve the saved instructions; source adoption is a separate decision',
    );
  const { attributes } = await canonicalizeSopExactSource(deps, ctx, input.attributes);
  if (!before.source?.exact && stable(citationsOf(before)) !== stable(citationsOf(attributes)))
    throw new OperationError(
      'invalid_input',
      'Edition not established; new source claims cannot be checked',
    );
  // An AI source review is never a section confirmation, including ordinary approved proposals.
  const { approvedBy: _approval, ...unconfirmed } = ctx;
  const write = (scoped: RecordContext) =>
    service.update(scoped, current.id, {
      expectedVersion: input.expectedVersion,
      attributes,
      ...(input.evidence ? { evidence: input.evidence } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
  return before.source?.exact
    ? withWrite(deps, unconfirmed, current.id, before, attributes, write)
    : write(unconfirmed);
}

/** Existing generic operation delegates exact citation validation, never root/question authority. */
export async function updateExactSopRecord(
  deps: Deps,
  ctx: RecordContext,
  current: Awaited<ReturnType<RecordService['get']>>,
  input: UpdateRecordInput,
) {
  if (ctx.via !== 'records.update')
    throw new OperationError('forbidden', 'Exact edited citations belong to records.update');
  const before = SopAttributes.parse(current.attributes);
  const parsed = SopAttributes.safeParse(input.attributes);
  if (!parsed.success)
    throw new RecordError(
      'invalid_attributes',
      `Invalid sop attributes:\n${z.prettifyError(parsed.error)}`,
      parsed.error.issues,
    );
  const candidate = parsed.data;
  if (!before.source?.exact || stable(before.source) !== stable(candidate.source))
    throw new OperationError(
      'forbidden',
      'Preserve the saved exact instructions; source adoption is a separate decision',
    );
  if (stable(citationsOf(before)) === stable(citationsOf(candidate)))
    return new RecordService(deps.db, deps.kinds).update(ctx, current.id, input);
  // This witness grants no question-write scope. Existing question guards still own all history.
  const { attributes } = await canonicalizeSopExactSource(deps, ctx, candidate);
  return withWrite(deps, ctx, current.id, before, attributes, (scoped) =>
    new RecordService(deps.db, deps.kinds).update(scoped, current.id, { ...input, attributes }),
  );
}

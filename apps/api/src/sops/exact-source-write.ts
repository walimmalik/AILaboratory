import { SopAttributes } from '@ailab/schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { OperationError } from '../operations/errors.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
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
  const prior = before as SopAttributes | undefined;
  const next = after as SopAttributes;
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
  if (stable(citationsOf(prior as SopAttributes)) !== stable(citationsOf(next)))
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

/** Private stage1 producer. No operation registration until the producer checkpoint clears. */
export async function createExactSopDraft(
  deps: Deps,
  ctx: RecordContext,
  input: { label: string; attributes: SopAttributes; reason?: string },
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

/** Until paired integration, existing current-source consumers must not read private exact SOPs. */
export function refuseUnintegratedExactSource(a: SopAttributes) {
  if (a.source?.exact)
    throw new OperationError(
      'invalid_input',
      'Exact SOP source checking is not yet available through this operation',
    );
}

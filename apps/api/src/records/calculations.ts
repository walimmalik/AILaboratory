import { createHash } from 'node:crypto';
import { sameValue } from '@ailab/domain';
import type { CalculationId } from '@ailab/schema';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { calculations } from '../db/schema.ts';
import { RecordError } from './errors.ts';
import type { RecordContext } from './service.ts';

/**
 * Calculation handles (plan 004e R12, ADR 0049). Every lab calculator's result is kept under a handle;
 * `calculated` evidence names one, and the record service checks the value against what it returned.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** JSON with sorted keys, so equal values hash the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)),
        )
      : v,
  );
}

export function calculationId(
  labId: string,
  operationId: string,
  input: unknown,
  output: unknown,
): CalculationId {
  const digest = createHash('sha256')
    .update(canonical([labId, operationId, input, output]))
    .digest();
  let bits = 0;
  let acc = 0;
  let id = '';
  for (const byte of digest) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && id.length < 26) {
      bits -= 5;
      id += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
    if (id.length === 26) break;
  }
  return `calc_${id}`;
}

/** Keeps a calculator's result and returns its handle. */
export async function saveCalculation(
  db: Db,
  ctx: RecordContext,
  operationId: string,
  input: unknown,
  output: unknown,
): Promise<CalculationId> {
  const id = calculationId(ctx.labId, operationId, input, output);
  await db
    .insert(calculations)
    .values({
      id,
      orgId: ctx.orgId,
      labId: ctx.labId,
      operationId,
      input: input ?? {},
      output: output ?? null,
      createdBy: ctx.actor,
    })
    .onConflictDoNothing();
  return id;
}

/** The value at a JSON pointer, or undefined. */
export function atPointer(value: unknown, pointer: string): unknown {
  let at = value;
  for (const raw of pointer.split('/').slice(1)) {
    const part = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** Whether `value` equals the output or, without a pointer, any part of it. */
function foundIn(output: unknown, value: unknown): boolean {
  if (sameValue(output, value)) return true;
  if (output && typeof output === 'object')
    return Object.values(output).some((v) => foundIn(v, value));
  return false;
}

/**
 * Refuses a value marked calculated that the named calculation did not return: at `at` in its output
 * when given, else anywhere in it.
 */
export async function checkCalculated(
  db: Db,
  ctx: RecordContext,
  where: string,
  value: unknown,
  calculation: CalculationId,
  at: string | undefined,
): Promise<void> {
  const [row] = await db
    .select({ output: calculations.output, operationId: calculations.operationId })
    .from(calculations)
    .where(and(eq(calculations.id, calculation), eq(calculations.labId, ctx.labId)));
  if (!row) {
    throw new RecordError(
      'invalid_input',
      `${where} is marked calculated, but there is no calculation ${calculation} in this lab`,
    );
  }
  const ok =
    at === undefined ? foundIn(row.output, value) : sameValue(atPointer(row.output, at), value);
  if (!ok) {
    throw new RecordError(
      'invalid_input',
      `${where} is marked calculated by ${row.operationId}, but that calculation did not give this value${at ? ` at ${at}` : ''}`,
    );
  }
}

import { changesApply } from '@ailab/schema';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { RecordContext } from '../records/service.ts';
import { OperationError, toErrorBody } from './errors.ts';
import { implement, type OperationDeps } from './registry.ts';

type Input = z.infer<typeof changesApply.input>;
type Result = z.infer<typeof changesApply.output>['results'][number];

const reference = /^\$(\d+)((?:\.[A-Za-z0-9_]+)*)$/;

/** Replaces every string "$N.path" in a step's input with that value from step N's output. */
export function resolveReferences(value: unknown, outputs: unknown[], step: number): unknown {
  if (typeof value === 'string') {
    const match = reference.exec(value);
    if (!match) return value;
    const from = Number(match[1]);
    if (from < 1 || from >= step) {
      throw new OperationError(
        'invalid_input',
        `Step ${step} refers to ${value}, but a step can only use the steps before it`,
      );
    }
    let found: unknown = outputs[from - 1];
    for (const key of (match[2] ?? '').split('.').filter(Boolean)) {
      found =
        found && typeof found === 'object' ? (found as Record<string, unknown>)[key] : undefined;
    }
    if (found === undefined) {
      throw new OperationError(
        'invalid_input',
        `Step ${step} refers to ${value}, which step ${from}'s output does not have`,
      );
    }
    return found;
  }
  if (Array.isArray(value)) return value.map((v) => resolveReferences(v, outputs, step));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveReferences(v, outputs, step)]),
    );
  }
  return value;
}

/** Runs the steps in order on one transaction; `each` sees every step's filled-in input first. */
async function runSteps(
  ctx: RecordContext,
  input: Input,
  deps: OperationDeps,
  db: Db,
  each?: (operation: string, input: unknown) => Promise<void>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (const [index, step] of input.steps.entries()) {
    const number = index + 1;
    try {
      const filled = resolveReferences(
        step.input,
        results.map((r) => r.output),
        number,
      );
      await each?.(step.operation, filled);
      const ran = await deps.registry.runStep(ctx, step.operation, filled, db);
      results.push({ operation: step.operation, ...ran });
    } catch (error) {
      const body = toErrorBody(error);
      if (body.code === 'internal') throw error;
      throw new OperationError(
        body.code,
        `Step ${number} (${step.operation}): ${body.message}. Nothing in the set was changed.`,
        body.details,
      );
    }
  }
  return results;
}

class Rollback extends Error {}

export const changeSetOperations = [
  implement(changesApply, {
    // One proposal for the whole set when any step would need a person (R2). The steps are tried
    // in a transaction that is rolled back, so later steps are judged with earlier ones applied.
    agentPolicy: async (ctx, input, deps) => {
      let policy: 'direct' | 'propose' = 'direct';
      try {
        await deps.db.transaction(async (tx) => {
          await runSteps(ctx, input, deps, tx, async (operation, filled) => {
            if ((await deps.registry.policyFor(ctx, operation, filled, tx)) === 'propose') {
              policy = 'propose';
            }
          });
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
      return policy;
    },
    touches: (_input, output, registry) =>
      (output?.results ?? []).flatMap((r) => registry.touchedBy(r.operation, r.input, r.output)),
    run: async (ctx, input, deps) => ({ results: await runSteps(ctx, input, deps, deps.db) }),
    after: (ctx, _input, output, deps) => {
      for (const r of output.results) deps.registry.afterStep(ctx, r.operation, r.input, r.output);
    },
  }),
];

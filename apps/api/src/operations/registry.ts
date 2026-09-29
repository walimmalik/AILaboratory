import type {
  ActivityEntry,
  OperationContract,
  OperationResult,
  RecordId as RecordIdType,
} from '@ailab/schema';
import { RecordId } from '@ailab/schema';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { type ActivityBus, recordActivity } from './activity.ts';
import { OperationError, toErrorBody } from './errors.ts';
import { createProposal } from './proposal-store.ts';

export interface OperationDeps {
  db: Db;
  kinds: KindRegistry;
  registry: OperationRegistry;
  bus: ActivityBus;
}

type Policy = 'direct' | 'propose';

/** Whether an agent's call runs now or becomes a proposal for a person. People always run directly. */
export type AgentPolicy<I> =
  | Policy
  | ((ctx: RecordContext, input: I, deps: OperationDeps) => Policy | Promise<Policy>);

export interface OperationImplementation<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  contract: OperationContract<I, O>;
  /** "people" refuses agent callers outright (e.g. approving proposals). */
  actors?: 'any' | 'people';
  agentPolicy?: AgentPolicy<z.infer<I>>;
  run(ctx: RecordContext, input: z.infer<I>, deps: OperationDeps): Promise<z.infer<O>>;
  /** Records this call touched, for the ledger. Defaults to `input.id` and `output.id`. */
  touches?(input: z.infer<I>, output: z.infer<O> | undefined): string[];
  /** Ledger outcome for a successful call. Defaults to "succeeded". */
  outcome?(output: z.infer<O>): ActivityEntry['outcome'];
}

export function implement<I extends z.ZodType, O extends z.ZodType>(
  contract: OperationContract<I, O>,
  implementation: Omit<OperationImplementation<I, O>, 'contract'>,
): OperationImplementation<I, O> {
  return { contract, ...implementation };
}

export interface ExecuteOptions {
  preview?: boolean;
  /** Set when a person approved a proposal: run the change as the proposing agent without re-proposing. */
  approvedProposalId?: string;
}

class PreviewRollback extends Error {
  constructor(readonly output: unknown) {
    super('preview rollback');
  }
}

/**
 * Every capability, declared once. The REST routes, the MCP tools and the typed client all call `execute`,
 * so people and agents go through the same validation, policy, transaction and ledger.
 */
export class OperationRegistry {
  readonly #operations = new Map<string, OperationImplementation>();
  readonly deps: OperationDeps;

  constructor(deps: Omit<OperationDeps, 'registry'>) {
    this.deps = { ...deps, registry: this };
  }

  register(...operations: OperationImplementation[]): this {
    for (const operation of operations) {
      const { id } = operation.contract;
      if (this.#operations.has(id)) throw new Error(`Operation "${id}" is already registered`);
      if (operation.contract.effect === 'write' && operation.agentPolicy === undefined) {
        throw new Error(`Write operation "${id}" must declare an agent policy`);
      }
      this.#operations.set(id, operation);
    }
    return this;
  }

  list(): OperationContract[] {
    return [...this.#operations.values()]
      .map((operation) => operation.contract)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): OperationImplementation {
    const operation = this.#operations.get(id);
    if (!operation) {
      throw new OperationError(
        'unknown_operation',
        `There is no operation "${id}". Call describe_operations to list them.`,
      );
    }
    return operation;
  }

  async execute(
    ctx: RecordContext,
    id: string,
    rawInput: unknown,
    options: ExecuteOptions = {},
    db: Db = this.deps.db,
  ): Promise<OperationResult<unknown>> {
    const operation = this.get(id);
    const parsed = operation.contract.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new OperationError(
        'invalid_input',
        `Invalid input for ${id}:\n${z.prettifyError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const input = parsed.data;
    if (operation.actors === 'people' && ctx.actor.type === 'agent') {
      throw new OperationError('forbidden', `Only a person can call ${id}`);
    }
    const deps = { ...this.deps, db };

    if (operation.contract.effect === 'read') {
      const output = await this.#run(operation, ctx, input, deps);
      return { status: options.preview ? 'preview' : 'done', output };
    }

    if (options.preview) {
      return { status: 'preview', output: await this.#dryRun(operation, ctx, input, deps) };
    }

    if (ctx.actor.type === 'agent' && !options.approvedProposalId) {
      const policy =
        typeof operation.agentPolicy === 'function'
          ? await operation.agentPolicy(ctx, input, deps)
          : operation.agentPolicy;
      if (policy === 'propose') {
        const started = Date.now();
        const preview = await this.#dryRun(operation, ctx, input, deps);
        const reason = (input as { reason?: string }).reason;
        const proposal = await createProposal(db, ctx, { operationId: id, input, preview, reason });
        await recordActivity(db, this.deps.bus, ctx, {
          operationId: id,
          outcome: 'proposed',
          recordIds: touched(operation, input, preview),
          nameHints: nameHints(preview),
          proposalId: proposal.id,
          input,
          durationMs: Date.now() - started,
        });
        return { status: 'proposed', proposal };
      }
    }

    const started = Date.now();
    try {
      const output = await db.transaction((tx) =>
        this.#run(operation, ctx, input, { ...deps, db: tx }),
      );
      await recordActivity(db, this.deps.bus, ctx, {
        operationId: id,
        outcome: operation.outcome?.(output) ?? 'succeeded',
        recordIds: touched(operation, input, output),
        nameHints: nameHints(output),
        ...(options.approvedProposalId ? { proposalId: options.approvedProposalId } : {}),
        input,
        durationMs: Date.now() - started,
      });
      return { status: 'done', output };
    } catch (error) {
      await recordActivity(db, this.deps.bus, ctx, {
        operationId: id,
        outcome: 'failed',
        recordIds: touched(operation, input, undefined),
        ...(options.approvedProposalId ? { proposalId: options.approvedProposalId } : {}),
        input,
        error: toErrorBody(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }

  async #run(
    operation: OperationImplementation,
    ctx: RecordContext,
    input: unknown,
    deps: OperationDeps,
  ): Promise<unknown> {
    const output = await operation.run(ctx, input, deps);
    const checked = operation.contract.output.safeParse(output);
    if (!checked.success) {
      throw new Error(
        `${operation.contract.id} returned output that breaks its contract: ${checked.error.message}`,
      );
    }
    return checked.data;
  }

  /** Runs the change in a transaction and rolls it back, returning what would have happened. */
  async #dryRun(
    operation: OperationImplementation,
    ctx: RecordContext,
    input: unknown,
    deps: OperationDeps,
  ): Promise<unknown> {
    try {
      await deps.db.transaction(async (tx) => {
        const output = await this.#run(operation, ctx, input, { ...deps, db: tx });
        throw new PreviewRollback(output);
      });
    } catch (error) {
      if (error instanceof PreviewRollback) return error.output;
      throw error;
    }
    throw new Error('unreachable');
  }
}

function touched(
  operation: OperationImplementation,
  input: unknown,
  output: unknown,
): RecordIdType[] {
  const ids = operation.touches
    ? operation.touches(input, output)
    : [(input as { id?: unknown })?.id, (output as { id?: unknown } | undefined)?.id];
  return [...new Set(ids.filter((id): id is string => RecordId.safeParse(id).success))];
}

/** A record envelope's readable name, so the ledger can name records that no longer (or don't yet) exist. */
function nameHints(output: unknown): Record<string, string> {
  const { id, name } = (output ?? {}) as { id?: unknown; name?: unknown };
  return typeof id === 'string' && typeof name === 'string' ? { [id]: name } : {};
}

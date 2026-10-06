import type {
  ActivityEntry,
  OperationContract,
  OperationResult,
  RecordId as RecordIdType,
} from '@ailab/schema';
import { Proposal, RecordId } from '@ailab/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Assistant } from '../assistant/assistant.ts';
import type { Db } from '../db/client.ts';
import { records } from '../db/schema.ts';
import type { FileStore } from '../files/store.ts';
import type { Converter } from '../library/convert.ts';
import { saveCalculation } from '../records/calculations.ts';
import type { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import type { ProtocolWriter } from '../transfers/simulator.ts';
import { type ActivityBus, recordActivity } from './activity.ts';
import { OperationError, toErrorBody } from './errors.ts';
import { createProposal } from './proposal-store.ts';

export interface OperationDeps {
  db: Db;
  kinds: KindRegistry;
  registry: OperationRegistry;
  bus: ActivityBus;
  assistant: Assistant;
  /** Where file bytes live (plan 011a). */
  files: FileStore;
  /** Turns library files into text (plan 011b): the science service. */
  converter: Converter;
  /** Writes and simulates Opentrons protocols (plan 016b-3): the science service. */
  protocols: ProtocolWriter;
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
  touches?(
    input: z.infer<I>,
    output: z.infer<O> | undefined,
    registry: OperationRegistry,
  ): string[];
  /** Ledger outcome for a successful call. Defaults to "succeeded". */
  outcome?(output: z.infer<O>): ActivityEntry['outcome'];
  /** False for writes that change nothing in the lab (a person's seen marker): no ledger entry. */
  ledger?: false;
  /** A stored result replay changes nothing: no repeated activity or after-commit work. */
  replayed?(ctx: RecordContext, input: z.infer<I>, deps: OperationDeps): Promise<boolean>;
  /** Runs after a write is committed and logged, e.g. to start background work. Never on previews or proposals. */
  after?(ctx: RecordContext, input: z.infer<I>, output: z.infer<O>, deps: OperationDeps): void;
}

export function implement<I extends z.ZodType, O extends z.ZodType>(
  contract: OperationContract<I, O>,
  implementation: Omit<OperationImplementation<I, O>, 'contract'>,
): OperationImplementation<I, O> {
  return { contract, ...implementation };
}

/** Called after a person's write is committed, with the records it touched. */
export type WriteListener = (
  ctx: RecordContext,
  recordIds: string[],
  deps: OperationDeps,
) => Promise<void>;

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
  readonly #listeners: WriteListener[] = [];
  readonly #committed = new WeakMap<Db, (() => void | Promise<void>)[]>();
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

  /**
   * Listens to every write a person makes, after it is committed: the records it touched. Lab
   * memory detectors use it (plan 005c-1b). A listener's failure never fails the write.
   */
  onWrite(listener: WriteListener): this {
    this.#listeners.push(listener);
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

  /** Owns the outer commit boundary; nested operation transactions merge their delivery work here. */
  async transaction<T>(db: Db, run: (tx: Db) => Promise<T>): Promise<T> {
    if (db !== this.deps.db && !this.#committed.has(db)) {
      throw new Error('Nested operations must use the registry transaction boundary');
    }
    const parent = this.#committed.get(db);
    const effects: (() => void | Promise<void>)[] = [];
    const result = await db.transaction(async (tx) => {
      this.#committed.set(tx, effects);
      try {
        return await run(tx);
      } finally {
        this.#committed.delete(tx);
      }
    });
    if (parent) parent.push(...effects);
    else
      for (const effect of effects) {
        try {
          await effect();
        } catch (error) {
          // Mutation and ledger already committed. Delivery failure cannot become mutation failure.
          console.error('Operation delivery failed after commit:', error);
        }
      }
    return result;
  }

  async #activity(
    db: Db,
    ctx: RecordContext,
    entry: Parameters<typeof recordActivity>[2],
  ): Promise<void> {
    const full = await recordActivity(db, ctx, entry);
    const publish = () => this.deps.bus.publish(ctx.labId, full);
    const effects = this.#committed.get(db);
    if (effects) effects.push(publish);
    else {
      try {
        publish();
      } catch (error) {
        console.error('Activity delivery failed after commit:', error);
      }
    }
  }

  async execute(
    ctx: RecordContext,
    id: string,
    rawInput: unknown,
    options: ExecuteOptions = {},
    db: Db = this.deps.db,
  ): Promise<OperationResult<unknown>> {
    const operation = this.get(id);
    const input = this.#accept(operation, ctx, rawInput);
    const deps = { ...this.deps, db };

    if (operation.contract.effect === 'read') {
      const output = await this.#run(operation, ctx, input, deps);
      const status = options.preview ? 'preview' : 'done';
      // Lab calculators keep what they returned under a handle (ADR 0049).
      if (operation.contract.calculator) {
        const calculation = await saveCalculation(db, ctx, id, input, output);
        return { status, output, calculation };
      }
      return { status, output };
    }

    if (db !== this.deps.db && !this.#committed.has(db)) {
      throw new Error('Nested operations must use the registry transaction boundary');
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
        const proposal = await this.transaction(db, async (tx) => {
          const proposal = await createProposal(tx, ctx, {
            operationId: id,
            input,
            preview,
            reason,
          });
          // A preview's new records were rolled back, so a proposal names only records that exist.
          await this.#activity(tx, ctx, {
            operationId: id,
            outcome: 'proposed',
            recordIds: await existing(tx, ctx, touched(operation, input, preview, this)),
            proposalId: proposal.id,
            input,
            durationMs: Date.now() - started,
          });
          return proposal;
        });
        return { status: 'proposed', proposal };
      }
    }

    const started = Date.now();
    try {
      const output = await this.transaction(db, async (tx) => {
        const txDeps = { ...deps, db: tx };
        // Under the same row lock as the implementation, so concurrent retries cannot both apply.
        const replayed = await operation.replayed?.(ctx, input, txDeps);
        const output = await this.#run(operation, ctx, input, txDeps);
        if (operation.ledger === false || replayed) return output;
        const recordIds = touched(operation, input, output, this);
        await this.#activity(tx, ctx, {
          operationId: id,
          outcome: operation.outcome?.(output) ?? 'succeeded',
          recordIds,
          nameHints: nameHints(output),
          ...(options.approvedProposalId ? { proposalId: options.approvedProposalId } : {}),
          ...(id === 'review.prepare_decision' ? { proposalId: Proposal.parse(output).id } : {}),
          input,
          durationMs: Date.now() - started,
        });
        const effects = this.#committed.get(tx);
        effects?.push(() => operation.after?.(ctx, input, output, { ...deps, db: this.deps.db }));
        // Only a person's top-level write; nested calls arrive with their outer write.
        if (ctx.actor.type === 'user' && db === this.deps.db && id !== 'review.prepare_decision')
          for (const listener of this.#listeners)
            effects?.push(() => listener(ctx, recordIds, { ...deps, db: this.deps.db }));
        return output;
      });
      // This known producer stores its own authoritative preview. Both people and agents must
      // receive the existing proposed result so the assistant pauses subsequent tool calls.
      if (id === 'review.prepare_decision')
        return { status: 'proposed', proposal: Proposal.parse(output) };
      return { status: 'done', output };
    } catch (error) {
      if (operation.ledger === false) throw error;
      await this.#activity(db, ctx, {
        operationId: id,
        outcome: 'failed',
        recordIds: touched(operation, input, undefined, this),
        ...(options.approvedProposalId ? { proposalId: options.approvedProposalId } : {}),
        input,
        error: toErrorBody(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }

  /**
   * One step of a change set (ADR 0051): runs inside the caller's transaction, with no ledger entry
   * or proposal of its own. The change set decides the policy and logs the whole.
   */
  async runStep(
    ctx: RecordContext,
    id: string,
    rawInput: unknown,
    db: Db,
  ): Promise<{ input: unknown; output: unknown; calculation?: string }> {
    const operation = this.get(id);
    if (id === 'changes.apply') {
      throw new OperationError('invalid_input', 'A change set cannot hold another change set');
    }
    if (id === 'review.prepare_decision')
      throw new OperationError(
        'invalid_input',
        'Prepare a decision as its own operation so the pending proposal pauses subsequent work',
      );
    const input = this.#accept(operation, ctx, rawInput);
    const output = await this.#run(operation, ctx, input, { ...this.deps, db });
    // A calculator inside a set keeps its result under a handle too, so a later step can mark a
    // value calculated from it ("$1.calculation"); a rolled-back set takes the handle with it.
    if (operation.contract.calculator) {
      return { input, output, calculation: await saveCalculation(db, ctx, id, input, output) };
    }
    return { input, output };
  }

  /** Whether an agent's call of this operation would run now or be proposed. */
  async policyFor(ctx: RecordContext, id: string, rawInput: unknown, db: Db): Promise<Policy> {
    const operation = this.get(id);
    if (operation.contract.effect === 'read' || ctx.actor.type !== 'agent') return 'direct';
    const input = this.#accept(operation, ctx, rawInput);
    return typeof operation.agentPolicy === 'function'
      ? operation.agentPolicy(ctx, input, { ...this.deps, db })
      : (operation.agentPolicy ?? 'propose');
  }

  /** The records a call touched, as its ledger entry names them. */
  touchedBy(id: string, input: unknown, output: unknown): RecordIdType[] {
    return touched(this.get(id), input, output, this);
  }

  /** Runs an operation's after-commit work for a step that was committed as part of a change set. */
  afterStep(ctx: RecordContext, id: string, input: unknown, output: unknown): void {
    this.get(id).after?.(ctx, input, output, this.deps);
  }

  /** Validates the input and who may call; returns the parsed input. */
  #accept(operation: OperationImplementation, ctx: RecordContext, rawInput: unknown): unknown {
    const { id } = operation.contract;
    const parsed = operation.contract.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new OperationError(
        'invalid_input',
        `Invalid input for ${id}:\n${z.prettifyError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    if (operation.actors === 'people' && ctx.actor.type === 'agent') {
      throw new OperationError('forbidden', `Only a person can call ${id}`);
    }
    return parsed.data;
  }

  async #run(
    operation: OperationImplementation,
    ctx: RecordContext,
    input: unknown,
    deps: OperationDeps,
  ): Promise<unknown> {
    // Versions the call writes name it (ADR 0053); an operation run inside another keeps its own name.
    const output = await operation.run({ ...ctx, via: operation.contract.id }, input, deps);
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
      await this.transaction(deps.db, async (tx) => {
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
  registry: OperationRegistry,
): RecordIdType[] {
  const ids = operation.touches
    ? operation.touches(input, output, registry)
    : [(input as { id?: unknown })?.id, (output as { id?: unknown } | undefined)?.id];
  return [...new Set(ids.filter((id): id is string => RecordId.safeParse(id).success))];
}

/** The ones of these records that exist in the lab. */
async function existing(db: Db, ctx: RecordContext, ids: RecordIdType[]): Promise<RecordIdType[]> {
  if (!ids.length) return [];
  const found = await db
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.id, ids), eq(records.labId, ctx.labId)));
  const there = new Set(found.map((r) => r.id));
  return ids.filter((id) => there.has(id));
}

/** A record envelope's readable name, so the ledger can name records that no longer (or don't yet) exist. */
function nameHints(output: unknown): Record<string, string> {
  const { id, name } = (output ?? {}) as { id?: unknown; name?: unknown };
  return typeof id === 'string' && typeof name === 'string' ? { [id]: name } : {};
}

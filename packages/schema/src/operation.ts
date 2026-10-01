import { z } from 'zod';
import { Actor } from './actor.ts';
import { CalculationId } from './design.ts';
import { RecordId } from './ids.ts';

/** Reads change nothing and are never logged; writes run in one transaction and are logged in the activity ledger. */
export const OperationEffect = z.enum(['read', 'write']);
export type OperationEffect = z.infer<typeof OperationEffect>;

/**
 * The public half of an operation, shared by the server (which implements it) and clients (which call it).
 * The same contract produces the REST route, the MCP tool description and the typed client call.
 */
/** How the Calculators page groups calculators, in this order. */
export const CALCULATOR_GROUPS = {
  dilutions: 'Dilutions and transfers',
  plates: 'Plates',
  protocols: 'SOPs, recipes and experiments',
} as const;
export type CalculatorGroup = keyof typeof CALCULATOR_GROUPS;

export interface OperationContract<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  /** Stable, namespaced ID, e.g. "records.update". */
  id: string;
  /** One line, written for a person or an agent choosing what to call. */
  summary: string;
  /**
   * What it does in plain lab words (UI rule 9), so no screen shows the ID: `done` reads after who
   * did it ("Claude drafted a plate map"), `intent` after "wants to".
   */
  verbs: { done: string; intent: string };
  effect: OperationEffect;
  /**
   * A lab calculator (ADR 0024): a read that computes numbers agents rely on (volumes,
   * concentrations, amounts) from `@ailab/domain`, listed in the calculators skill. `title` names it
   * on the Calculators page ("Dilution options"), which groups calculators by `group`.
   */
  calculator?: { title: string; group: CalculatorGroup };
  input: I;
  output: O;
  /**
   * When the output is a file a person saves (a definition, a worklist): its name and text. Clients
   * offer it as a download instead of showing it, and agents don't repeat it in their replies.
   */
  file?: (output: z.output<O>) => OutputFile;
}

export interface OutputFile {
  name: string;
  /** e.g. application/json, text/csv. */
  mediaType: string;
  text: string;
}

export function defineContract<I extends z.ZodType, O extends z.ZodType>(
  contract: OperationContract<I, O>,
): OperationContract<I, O> {
  if (!/^[a-z]+(\.[a-z_]+)+$/.test(contract.id)) {
    throw new Error(`Invalid operation ID "${contract.id}"`);
  }
  for (const words of [contract.verbs.done, contract.verbs.intent]) {
    if (!/^[a-z][^._]*$/.test(words)) {
      throw new Error(`${contract.id}: verbs must be plain words, not "${words}"`);
    }
  }
  return contract;
}

export const OperationErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'unknown_operation',
  'invalid_input',
  'not_found',
  'unknown_kind',
  'invalid_attributes',
  'invalid_state',
  'version_conflict',
  'invalid_link',
  'linked',
  'not_ready',
  'unavailable',
  'internal',
]);
export type OperationErrorCode = z.infer<typeof OperationErrorCode>;

export const OperationErrorBody = z.object({
  code: OperationErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});
export type OperationErrorBody = z.infer<typeof OperationErrorBody>;

export const ProposalStatus = z.enum(['pending', 'approved', 'rejected', 'failed']);

/** A change an agent asked for that waits for a person. */
export const Proposal = z.object({
  id: z.string().regex(/^prp_[0-9A-HJKMNP-TV-Z]{26}$/),
  operationId: z.string(),
  input: z.unknown(),
  /** What the operation returned when it was previewed at proposal time. */
  preview: z.unknown(),
  status: ProposalStatus,
  proposedBy: Actor,
  proposedAt: z.iso.datetime(),
  reason: z.string().optional(),
  decidedBy: Actor.optional(),
  decidedAt: z.iso.datetime().optional(),
  decisionReason: z.string().optional(),
  error: OperationErrorBody.optional(),
});
export type Proposal = z.infer<typeof Proposal>;

/** What calling an operation produced. Agents may get "proposed" instead of "done". */
export function operationResult<O extends z.ZodType>(output: O) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('done'), output, calculation: CalculationId.optional() }),
    z.object({ status: z.literal('preview'), output, calculation: CalculationId.optional() }),
    z.object({ status: z.literal('proposed'), proposal: Proposal }),
  ]);
}
/**
 * A calculator's result also carries its calculation handle (ADR 0049), which `calculated` evidence
 * names so the record service can check the value against it.
 */
export type OperationResult<O> =
  | { status: 'done'; output: O; calculation?: CalculationId }
  | { status: 'preview'; output: O; calculation?: CalculationId }
  | { status: 'proposed'; proposal: Proposal };

export const ActivityOutcome = z.enum(['succeeded', 'failed', 'proposed', 'approved', 'rejected']);

/** One line in the lab's activity ledger. Only changes are logged. */
export const ActivityEntry = z.object({
  id: z.string().regex(/^act_[0-9A-HJKMNP-TV-Z]{26}$/),
  at: z.iso.datetime(),
  actor: Actor,
  operationId: z.string(),
  outcome: ActivityOutcome,
  recordIds: z.array(RecordId),
  /** Readable names of the touched records when the entry was written, e.g. { "wdg_…": "WDG-0001" }. */
  recordNames: z.record(z.string(), z.string()),
  proposalId: z.string().optional(),
  input: z.unknown(),
  error: OperationErrorBody.optional(),
  durationMs: z.number().int().nonnegative(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

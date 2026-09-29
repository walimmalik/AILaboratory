import { z } from 'zod';
import { Actor } from './actor.ts';
import { RecordId } from './ids.ts';

/** Reads change nothing and are never logged; writes run in one transaction and are logged in the activity ledger. */
export const OperationEffect = z.enum(['read', 'write']);
export type OperationEffect = z.infer<typeof OperationEffect>;

/**
 * The public half of an operation, shared by the server (which implements it) and clients (which call it).
 * The same contract produces the REST route, the MCP tool description and the typed client call.
 */
export interface OperationContract<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  /** Stable, namespaced ID, e.g. "records.update". */
  id: string;
  /** One line, written for a person or an agent choosing what to call. */
  summary: string;
  effect: OperationEffect;
  input: I;
  output: O;
}

export function defineContract<I extends z.ZodType, O extends z.ZodType>(
  contract: OperationContract<I, O>,
): OperationContract<I, O> {
  if (!/^[a-z]+(\.[a-z_]+)+$/.test(contract.id)) {
    throw new Error(`Invalid operation ID "${contract.id}"`);
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
    z.object({ status: z.literal('done'), output }),
    z.object({ status: z.literal('preview'), output }),
    z.object({ status: z.literal('proposed'), proposal: Proposal }),
  ]);
}
export type OperationResult<O> =
  | { status: 'done'; output: O }
  | { status: 'preview'; output: O }
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

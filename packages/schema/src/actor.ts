import { z } from 'zod';

export const UserId = z.string().regex(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a usr_ ID');

/** A person acting directly. */
export const UserActor = z.object({
  type: z.literal('user'),
  userId: UserId,
});

/** An agent acting on behalf of a person. */
export const AgentActor = z.object({
  type: z.literal('agent'),
  agentName: z.string().min(1),
  onBehalfOf: UserId,
  /** Optional pointer to the agent session or tool call that made the change. */
  sessionRef: z.string().min(1).optional(),
});

/**
 * The agent that loads the seed lab (`pnpm seed`, ADR 0044). Screens fold its bulk work into one
 * line so an agent's work for a person stands out (UX review 2026-10-02, item 4).
 */
export const SEED_AGENT = 'Seed loader';

/** Who made a change. Every write records one. */
export const Actor = z.discriminatedUnion('type', [UserActor, AgentActor]);
export type Actor = z.infer<typeof Actor>;

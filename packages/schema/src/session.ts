import { z } from 'zod';
import { Actor } from './actor.ts';

/** Who the caller is, as returned by GET /me. */
export const Me = z.object({
  actor: Actor,
  orgId: z.string(),
  labId: z.string(),
  user: z.object({ id: z.string(), displayName: z.string(), email: z.string().nullable() }),
  lab: z.object({ id: z.string(), name: z.string() }),
});
export type Me = z.infer<typeof Me>;

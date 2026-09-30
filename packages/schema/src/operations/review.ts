import { z } from 'zod';
import { Actor } from '../actor.ts';
import { RecordId, RecordName } from '../ids.ts';
import { defineContract, Proposal } from '../operation.ts';
import { RecordStatus } from '../record.ts';

/** A draft waiting for a person to review and confirm it. */
export const ReviewDraft = z.object({
  type: z.literal('draft'),
  at: z.iso.datetime().describe('When the draft last changed'),
  record: z.object({
    id: RecordId,
    kind: z.string(),
    name: RecordName,
    label: z.string(),
    status: RecordStatus,
    version: z.number().int().positive(),
    updatedBy: Actor,
  }),
  /** Titles of the sections still to confirm. */
  sectionsToConfirm: z.array(z.string()),
  /** What stands in the way, in plain words. */
  missing: z.array(z.string()),
  ready: z.boolean(),
  /** How many values are an agent's unconfirmed estimate. */
  assumed: z.number().int().nonnegative(),
});

/** A proposed change to an active record, waiting for a person to confirm or reject it. */
export const ReviewChange = z.object({
  type: z.literal('change'),
  at: z.iso.datetime().describe('When the change was proposed'),
  proposal: Proposal,
});

export const ReviewItem = z.discriminatedUnion('type', [ReviewDraft, ReviewChange]);
export type ReviewItem = z.infer<typeof ReviewItem>;

export const reviewList = defineContract({
  id: 'review.list',
  verbs: { done: 'looked at what is waiting for you', intent: 'look at what is waiting for you' },
  summary:
    'Everything waiting for a person: drafts to review and confirm, and proposed changes to confirm or reject, newest first',
  effect: 'read',
  input: z.strictObject({
    kind: z.string().optional().describe('Only drafts of this kind; proposed changes are left out'),
  }),
  output: z.object({
    items: z
      .array(ReviewItem)
      .describe(
        'Newest first; at most 200 drafts, so compare with counts to see what was left out',
      ),
    counts: z
      .object({
        total: z.number().int().nonnegative().describe('Everything waiting, drafts and changes'),
        changes: z.number().int().nonnegative(),
        drafts: z
          .record(z.string(), z.number().int().positive())
          .describe('Drafts waiting per kind, all of them, not only those listed'),
      })
      .describe('Counts over everything waiting, whatever the filter and limit'),
  }),
});

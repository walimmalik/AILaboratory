import { z } from 'zod';
import { Actor } from '../actor.ts';
import { RecordId, RecordName } from '../ids.ts';
import { defineContract, Proposal } from '../operation.ts';
import { RecordStatus } from '../record.ts';

/**
 * How urgent an item is (plan 004e R1, ADR 0050): "needs_you" blocks someone (an agent waiting on a
 * proposed change); "to_confirm" has no deadline (drafts); "fyi" needs nothing (reserved for re-plans
 * and drift notes). Only "needs_you" counts in the nav.
 */
export const ReviewTier = z.enum(['needs_you', 'to_confirm', 'fyi']);
export type ReviewTier = z.infer<typeof ReviewTier>;

const addressed = {
  tier: ReviewTier,
  for: z
    .string()
    .optional()
    .describe('The user the item is for: the person the agent worked for, or who made the draft'),
};

/** A draft waiting for a person to review and confirm it. */
export const ReviewDraft = z.object({
  type: z.literal('draft'),
  ...addressed,
  at: z.iso.datetime().describe('When the draft last changed'),
  record: z.object({
    id: RecordId,
    kind: z.string(),
    name: RecordName,
    label: z.string(),
    status: RecordStatus,
    version: z.number().int().positive(),
    updatedBy: Actor,
    summary: z.string().optional(),
  }),
  /** Made by an agent, so a person may discard it from Review. */
  byAgent: z.boolean(),
  /**
   * Nothing in it is a guess, no blocker fails and no confirmed value changed, so it may be
   * confirmed with others in one step (R3, `records.confirm_many`); warnings are counted, not
   * refused.
   */
  batchable: z.boolean(),
  /** How many warning checks fail: shown with a batch confirm, which lets them pass. */
  warnings: z.number().int().nonnegative(),
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
  ...addressed,
  at: z.iso.datetime().describe('When the change was proposed'),
  proposal: Proposal,
});

/**
 * A document whose library mentions wait for a person to check (plan 004e, ADR 0052). They are
 * checked on the document's page, in bulk, with `library.review_mentions`.
 */
export const ReviewMentions = z.object({
  type: z.literal('mentions'),
  ...addressed,
  at: z.iso.datetime().describe('When the newest mention was proposed'),
  document: z.object({ id: RecordId, name: RecordName, label: z.string() }),
  proposed: z.number().int().positive().describe('Mentions waiting in this document'),
});

export const ReviewItem = z.discriminatedUnion('type', [ReviewDraft, ReviewChange, ReviewMentions]);
export type ReviewItem = z.infer<typeof ReviewItem>;

export const reviewList = defineContract({
  id: 'review.list',
  verbs: { done: 'looked at what is waiting for you', intent: 'look at what is waiting for you' },
  summary:
    'Everything waiting for a person: drafts to review and confirm, proposed changes to confirm or reject, and documents whose library mentions need checking, newest first',
  effect: 'read',
  input: z.strictObject({
    kind: z
      .string()
      .optional()
      .describe('Only drafts of this kind; proposed changes and mentions are left out'),
    mine: z.boolean().optional().describe('Only items addressed to you'),
  }),
  output: z.object({
    items: z
      .array(ReviewItem)
      .describe(
        'Newest first; at most 200 drafts, so compare with counts to see what was left out',
      ),
    counts: z
      .object({
        total: z
          .number()
          .int()
          .nonnegative()
          .describe('Everything waiting: drafts, changes and documents with mentions'),
        changes: z.number().int().nonnegative(),
        mentions: z
          .number()
          .int()
          .nonnegative()
          .describe('Library mentions waiting, across all documents'),
        needsYou: z
          .number()
          .int()
          .nonnegative()
          .describe('Items addressed to you that block something: the one number the nav shows'),
        drafts: z
          .record(z.string(), z.number().int().positive())
          .describe('Drafts waiting per kind, all of them, not only those listed'),
      })
      .describe('Counts over everything waiting, whatever the filter and limit'),
  }),
});

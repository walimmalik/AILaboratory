import { z } from 'zod';
import { Actor } from '../actor.ts';
import { RecordId, RecordName } from '../ids.ts';
import { defineContract, Proposal } from '../operation.ts';
import { RecordStatus } from '../record.ts';
import { ScientificDecisionMetadata } from '../scientific-decisions.ts';
import { SopDefaultDecisionPreview, SopDefaultEdit } from '../sop-default-decision.ts';
import { SopDilutionDecision, SopDilutionDecisionPreview } from '../sop-dilution-decision.ts';
import { SopInputDecision, SopInputDecisionPreview } from '../sop-input-decision.ts';
import { SopMaterialDecisionPreview } from '../sop-material-decision.ts';

export const reviewPrepareDecision = defineContract({
  id: 'review.prepare_decision',
  verbs: { done: 'prepared a draft SOP decision', intent: 'prepare a draft SOP decision' },
  summary:
    'Prepare one bounded decision on a never-confirmed draft SOP: an existing uncited positive same-unit scalar volume default; acceptance of one open experiment input/material-role obligation; OR dilution_final_volume to complete one missing unbounded final-volume default from the identical persisted exact quotation on its method question and serial dilution step. The server derives associations, literal source-number agreement and calculator arithmetic; dilution acceptance is a human field-relationship decision, not full assay validation. Do not mix selectors or supply operation/path/actor/source authority. Returns a pending proposal and pauses assistant work. Apply only through proposals.approve with the shown digest; the preview discloses whole Values review when changed, the SOP remains draft and final confirmation is separate. Experiment obligations still require explicit downstream choices',
  effect: 'write',
  input: z.union([SopDefaultEdit, SopInputDecision, SopDilutionDecision]),
  output: Proposal.extend({
    preview: z.discriminatedUnion('type', [
      SopDefaultDecisionPreview,
      SopInputDecisionPreview,
      SopMaterialDecisionPreview,
      SopDilutionDecisionPreview,
    ]),
    decision: ScientificDecisionMetadata,
  }),
});

/**
 * How urgent an item is (plan 004e R1, ADR 0050): "needs_you" blocks someone (an agent waiting on a
 * proposed change); "to_confirm" waits for a person (drafts, library mentions); "fyi" needs nothing
 * but a look (a memory due for a check; later re-plans and drift notes). Only "needs_you" counts in
 * the nav.
 */
export const ReviewTier = z.enum(['needs_you', 'to_confirm', 'fyi']);
export type ReviewTier = z.infer<typeof ReviewTier>;

/** A record named in an item, as people read it. */
const RecordRef = z.object({ id: RecordId, kind: z.string(), name: RecordName, label: z.string() });

const addressed = {
  tier: ReviewTier,
  for: z
    .string()
    .optional()
    .describe(
      'The user the item is for: the person the agent worked for, or who made the draft. Left out: the whole lab',
    ),
  group: z
    .object({ id: z.string(), title: z.string() })
    .optional()
    .describe(
      'Drafts with the same saved user-message origin, including a single draft: title is the scoped request excerpt or says its text is unavailable. Unknown draft origins stay individual. Proposed changes retain conversation grouping when two or more items share a session. Grouping grants no confirmation authority',
    ),
  due: z.iso.date().optional().describe('The date it has to be decided by'),
  blocking: z
    .array(RecordRef)
    .optional()
    .describe('Records that wait on it: they point to this draft, which is not confirmed yet'),
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
   * Nothing in it is a guess or an unchecked source, no blocker fails and no
   * confirmed value changed, so it may be confirmed with others in one step (R3,
   * `records.confirm_many`); warnings are counted, not refused.
   */
  batchable: z.boolean(),
  /** How many warning checks fail: shown with a batch confirm, which lets them pass. */
  warnings: z.number().int().nonnegative(),
  /** Titles of the sections still to confirm. */
  sectionsToConfirm: z.array(z.string()),
  /** What stands in the way, in plain words: the sections left, then the failing blockers. */
  missing: z.array(z.string()),
  /** The failing blocker checks alone, in plain words, including checks that read other records. */
  blockers: z.array(z.string()),
  ready: z.boolean(),
  /** How many values are an agent's unconfirmed estimate. */
  assumed: z.number().int().nonnegative(),
  /** How many values an agent sourced to a datasheet, measurement or import that nothing checked. */
  unchecked: z.number().int().nonnegative(),
  /**
   * For a proposed lab memory (plan 005c-1b, M16): where it came from, to group proposals by
   * source, and its evidence line. A rule is never confirmed in a batch.
   */
  memory: z
    .object({
      group: z
        .string()
        .describe('e.g. "Lab memory detector (runs.recurring_deviation)" or "From a conversation"'),
      strength: z.enum(['rule', 'default', 'note']),
      evidence: z.string().optional().describe('e.g. "seen in 3 runs on 2 days since 2026-10-01"'),
    })
    .optional(),
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

/** Something to know about a confirmed record, with nothing to confirm (the "fyi" tier). */
export const ReviewNotice = z.object({
  type: z.literal('notice'),
  ...addressed,
  at: z.iso.datetime().describe('When the record last changed'),
  about: RecordRef,
  message: z.string().describe('What to know, in plain words'),
});

export const ReviewItem = z.discriminatedUnion('type', [
  ReviewDraft,
  ReviewChange,
  ReviewMentions,
  ReviewNotice,
]);
export type ReviewItem = z.infer<typeof ReviewItem>;

export const reviewList = defineContract({
  id: 'review.list',
  verbs: { done: 'looked at what is waiting for you', intent: 'look at what is waiting for you' },
  summary:
    'Everything waiting for a person: proposed changes to confirm or reject, drafts to review and confirm, documents whose library mentions need checking, and notices to know about. Most urgent first: by tier, then the earliest due date, then items that block other records, then the newest',
  effect: 'read',
  input: z.strictObject({
    kind: z
      .string()
      .optional()
      .describe('Only drafts of this kind; proposed changes and mentions are left out'),
    mine: z.boolean().optional().describe('Only items addressed to you'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('List at most this many items; counts still cover everything'),
  }),
  output: z.object({
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
        notices: z.number().int().nonnegative().describe('Notices for your information'),
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
    items: z
      .array(ReviewItem)
      .describe(
        'Most urgent first; at most 200 drafts and at most limit items, so compare with counts to see what was left out',
      ),
  }),
});

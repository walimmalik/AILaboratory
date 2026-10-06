import { z } from 'zod';
import { Actor } from './actor.ts';
import { FieldEvidence, ReadinessSummary, SectionReview } from './design.ts';
import { RecordId, RecordName } from './ids.ts';
import { OriginatingIntent } from './scientific-decisions.ts';

export const RecordStatus = z.enum(['draft', 'active', 'archived']);
export type RecordStatus = z.infer<typeof RecordStatus>;

export const TenantId = z.string().regex(/^(org|lab)_[0-9A-HJKMNP-TV-Z]{26}$/);

/** The envelope every record shares. `attributes` holds the kind-specific fields. */
export function recordEnvelope<A extends z.ZodType>(attributes: A) {
  return z.object({
    id: RecordId,
    kind: z.string().min(1),
    name: RecordName,
    label: z.string(),
    orgId: TenantId,
    labId: TenantId,
    status: RecordStatus,
    version: z.number().int().positive(),
    attributes,
    /** Where each attribute's value came from (plan 004c). */
    evidence: z.record(z.string(), FieldEvidence),
    /** Section confirmations by people, keyed by section ID (plan 004c). */
    reviews: z.record(z.string(), SectionReview),
    createdAt: z.iso.datetime(),
    createdBy: Actor,
    /** Immutable creation provenance. Absence on older records means unknown, never inferred. */
    origin: OriginatingIntent.optional().describe(
      'Server-owned originating request at creation; immutable, not approval authority. Absent historical origin is unknown',
    ),
    updatedAt: z.iso.datetime(),
    updatedBy: Actor,
    /** The kind's one-line summary of the record, stored at write time (ADR 0050). */
    summary: z.string().optional(),
    /** Readiness in one line, stored at write time (ADR 0050). */
    readiness: ReadinessSummary.optional(),
  });
}

export const RecordEnvelope = recordEnvelope(z.record(z.string(), z.unknown()));
export type RecordEnvelope<A = Record<string, unknown>> = Omit<
  z.infer<typeof RecordEnvelope>,
  'attributes'
> & { attributes: A };

/** What a version entry says happened. */
export const RecordOperation = z.enum([
  'create',
  'update',
  'activate',
  'archive',
  'unarchive',
  'restore',
  'confirm_section',
]);
export type RecordOperation = z.infer<typeof RecordOperation>;

/** One entry in a record's history: the full record as it was after the change. */
export const RecordVersion = z.object({
  recordId: RecordId,
  version: z.number().int().positive(),
  operation: RecordOperation,
  actor: Actor,
  reason: z.string().optional(),
  at: z.iso.datetime(),
  /** The operation that made this version, e.g. "sops.draft", so history can say what was done (ADR 0053). */
  via: z.string().optional(),
  snapshot: RecordEnvelope,
});
export type RecordVersion = z.infer<typeof RecordVersion>;

/** A typed reference from one record to another. */
export const RecordLink = z.object({
  fromId: RecordId,
  toId: RecordId,
  relation: z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case'),
});
export type RecordLink = z.infer<typeof RecordLink>;

/**
 * A link as a person reads it (plan 004f N6): the relation in words from this record's end and
 * the record at the other end, named, with its state and when it last changed.
 */
export const Connection = RecordLink.extend({
  words: z.string().describe('The relation in words from this end ("sold by", "lots")'),
  other: z.object({
    id: RecordId,
    kind: z.string(),
    name: RecordName,
    label: z.string(),
    status: RecordStatus,
    updatedAt: z.iso.datetime(),
  }),
});
export type Connection = z.infer<typeof Connection>;

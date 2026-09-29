import { z } from 'zod';
import { Actor } from './actor.ts';

/**
 * Draft and confirm (plan 004c, ADRs 0021-0022). A kind splits its attributes into sections a person
 * confirms one by one; every value carries where it came from; readiness checks say what is missing.
 */

/**
 * Where a value came from. "assumed" is an agent's estimate. "stated" is a value the person the agent
 * works for told it (e.g. in a conversation). "person" is a value a person entered themselves.
 */
export const EvidenceSource = z.enum([
  'assumed',
  'stated',
  'person',
  'datasheet',
  'imported',
  'measured',
  'calculated',
]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/** What a caller says about a value it sets. */
export const EvidenceInput = z.object({
  source: EvidenceSource.exclude(['person']),
  note: z.string().min(1).optional().describe('e.g. "Corning 3590 datasheet, p. 2"'),
  reference: z.string().min(1).optional().describe('A URL or document the value came from'),
});
export type EvidenceInput = z.infer<typeof EvidenceInput>;

/** Where one attribute's current value came from, and who set it. */
export const FieldEvidence = z.object({
  source: EvidenceSource,
  by: Actor,
  at: z.iso.datetime(),
  note: z.string().optional(),
  reference: z.string().optional(),
});
export type FieldEvidence = z.infer<typeof FieldEvidence>;

/** A person's confirmation of one section: the values they saw. */
export const SectionReview = z.object({
  confirmedBy: Actor,
  confirmedAt: z.iso.datetime(),
  /** The record version the person confirmed. */
  version: z.number().int().positive(),
  /** The section's values at confirmation; a section is confirmed while its values still equal these. */
  values: z.record(z.string(), z.unknown()),
});
export type SectionReview = z.infer<typeof SectionReview>;

/** A group of attributes confirmed together, e.g. "Geometry" or "Volumes". */
export const KindSection = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  /** Top-level attribute names in this section. */
  fields: z.array(z.string().min(1)).min(1),
});
export type KindSection = z.infer<typeof KindSection>;

export const CheckSeverity = z.enum(['blocker', 'warning']);

/**
 * A readiness check a kind declares. `test` returns true when the check passes, or a message that says
 * what is wrong in plain words.
 */
export interface KindCheck<A = Record<string, unknown>> {
  id: string;
  /** What is checked, e.g. "Volume is more than zero". */
  label: string;
  /** "blocker" stops the final confirm; "warning" only shows. */
  severity: z.infer<typeof CheckSeverity>;
  /** Where the rule comes from, e.g. "Echo 650 source plate spec" (product rule 7). */
  source: string;
  section?: string;
  /** What to do when it fails. */
  fix?: string;
  /** Whether the check means anything for these values, e.g. well positions for a single tube. Default yes. */
  applies?: (attributes: A) => boolean;
  test: (attributes: A) => true | string;
}

export const FieldState = z.enum(['confirmed', 'changed', 'unconfirmed']);

/** One attribute as the review screen shows it. */
export const ReadinessField = z.object({
  field: z.string(),
  /** Absent when the field has no value. */
  value: z.unknown().optional(),
  /** confirmed: equals what a person confirmed. changed: differs from it. unconfirmed: never confirmed. */
  state: FieldState,
  /** An agent's estimate that no person has confirmed yet. */
  assumed: z.boolean(),
  /** The value a person confirmed, when it has changed since. */
  confirmedValue: z.unknown().optional(),
  evidence: FieldEvidence.optional(),
});

export const ReadinessSection = z.object({
  id: z.string(),
  title: z.string(),
  state: z.enum(['confirmed', 'needs_review']),
  review: SectionReview.optional(),
  fields: z.array(ReadinessField),
});
export type ReadinessSection = z.infer<typeof ReadinessSection>;

export const CheckResult = z.object({
  id: z.string(),
  label: z.string(),
  severity: CheckSeverity,
  source: z.string(),
  section: z.string().optional(),
  passed: z.boolean(),
  message: z.string().optional(),
  fix: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;

/** Everything the review screen needs: sections, checks, and whether the final confirm can go ahead. */
export const Readiness = z.object({
  recordId: z.string(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'archived']),
  sections: z.array(ReadinessSection),
  checks: z.array(CheckResult),
  /** True when every section is confirmed and no blocker fails. */
  ready: z.boolean(),
  /** What still stands in the way, in plain words. */
  missing: z.array(z.string()),
  /** Fields holding an agent's unconfirmed estimate. */
  assumed: z.array(z.string()),
  /**
   * Attributes that don't apply to this record as it stands, as dotted paths (e.g. "wells.a1" on a
   * tube). Forms leave them out unless they hold a value.
   */
  notApplicable: z.array(z.string()),
});
export type Readiness = z.infer<typeof Readiness>;

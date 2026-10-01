import { z } from 'zod';
import { Actor } from './actor.ts';
import { RecordId } from './ids.ts';

/**
 * Draft and confirm (plan 004c, ADRs 0021-0022). A kind splits its attributes into sections a person
 * confirms one by one; every value carries where it came from; readiness checks say what is missing.
 */

/**
 * Where a value came from. "assumed" is an agent's estimate. "stated" is a value the person the agent
 * works for told it (e.g. in a conversation). "person" is a value a person entered themselves.
 * "calculated" is a calculator's output, named by its calculation handle (ADR 0049). "record",
 * "template" and "memory" are copied from a confirmed record, a confirmed template's default and a
 * confirmed lab memory, each named in `from`. Only "assumed" and "stated" are shown in agent ink.
 */
export const EvidenceSource = z.enum([
  'assumed',
  'stated',
  'person',
  'datasheet',
  'imported',
  'measured',
  'calculated',
  'record',
  'template',
  'memory',
]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/** A calculation handle (ADR 0049): what a calculator returned, kept so a value can be checked against it. */
export const CalculationId = z
  .string()
  .regex(/^calc_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a calculation handle like calc_01J9…');
export type CalculationId = z.infer<typeof CalculationId>;

/** The confirmed record a value was copied from, at a version, and where in it. */
export const EvidenceFrom = z.strictObject({
  id: RecordId,
  version: z.number().int().positive(),
  path: z.string().startsWith('/').optional().describe('e.g. /steps/coat/parameters/0'),
});
export type EvidenceFrom = z.infer<typeof EvidenceFrom>;

const needsFrom = new Set(['record', 'template', 'memory']);

/** What a caller says about a value it sets. */
export const EvidenceInput = z
  .object({
    source: EvidenceSource.exclude(['person']),
    note: z.string().min(1).optional().describe('e.g. "Corning 3590 datasheet, p. 2"'),
    reference: z.string().min(1).optional().describe('A URL or document the value came from'),
    from: EvidenceFrom.optional().describe(
      'For record, template and memory: where it was copied from',
    ),
    calculation: CalculationId.optional().describe(
      'For calculated: the handle a calculator returned with its result',
    ),
    output: z
      .string()
      .startsWith('/')
      .optional()
      .describe(
        'For calculated: where in the calculator output the value is, e.g. /steps/0/volume',
      ),
  })
  .superRefine((e, ctx) => {
    if (needsFrom.has(e.source) && !e.from)
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `${e.source} evidence names the record it came from`,
      });
    if (e.source === 'calculated' && !e.calculation)
      ctx.addIssue({
        code: 'custom',
        path: ['calculation'],
        message: 'calculated evidence names the calculation handle the calculator returned',
      });
  });
export type EvidenceInput = z.infer<typeof EvidenceInput>;

/** Where one attribute's (or one list item's) current value came from, and who set it. */
export const FieldEvidence = z.object({
  source: EvidenceSource,
  by: Actor,
  at: z.iso.datetime(),
  note: z.string().optional(),
  reference: z.string().optional(),
  from: EvidenceFrom.optional(),
  calculation: CalculationId.optional(),
  output: z.string().optional().describe('Where in the calculation output the value is'),
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
  /**
   * An operation that fixes the failure in one step, when it can for these values. It takes
   * `{id, expectedVersion}` of the record, like `labware.use_standard_positions`.
   */
  quickFix?: { operation: string; label: string; applies?: (attributes: A) => boolean };
  /** Whether the check means anything for these values, e.g. well positions for a single tube. Default yes. */
  applies?: (attributes: A) => boolean;
  test: (attributes: A) => true | string;
}

export const FieldState = z.enum(['confirmed', 'changed', 'unconfirmed']);

/**
 * One item of a list a kind keys by id (R4, ADR 0049): an SOP step by its id, a variable by its name.
 * Its evidence and confirmation are its own, so one changed step leaves the others confirmed.
 */
export const ReadinessItem = z.object({
  key: z.string(),
  /** `/<list>/<key>`, the evidence key. */
  path: z.string(),
  value: z.unknown(),
  /** added: not in the confirmed list. The others as for a field. */
  state: z.enum(['confirmed', 'changed', 'added', 'unconfirmed']),
  assumed: z.boolean(),
  confirmedValue: z.unknown().optional(),
  evidence: FieldEvidence.optional(),
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;

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
  /** For a keyed list: each item's own state, in the list's order. */
  items: z.array(ReadinessItem).optional(),
  /** For a keyed list: confirmed items no longer in it. */
  removed: z.array(z.object({ key: z.string(), value: z.unknown() })).optional(),
  /** For a keyed list: the same items as confirmed, in another order. */
  reordered: z.boolean().optional(),
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
  /** Another record the check waits on (a draft entity kind); the fix is made there, not here. */
  record: z.string().optional(),
  /** Offered only while the check fails: an operation taking `{id, expectedVersion}` that fixes it. */
  quickFix: z.object({ operation: z.string(), label: z.string() }).optional(),
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
   * Unconfirmed values an agent says came from a datasheet, a measurement or an import: nothing on
   * the server checked them, so a person confirms them one record at a time, never in a batch.
   */
  unchecked: z.array(z.string()),
  /**
   * Attributes that don't apply to this record as it stands, as dotted paths (e.g. "wells.a1" on a
   * tube). Forms leave them out unless they hold a value.
   */
  notApplicable: z.array(z.string()),
});
export type Readiness = z.infer<typeof Readiness>;

/**
 * A record's readiness in one line (plan 004e R9, ADR 0050), stored with it at every write so lists,
 * Review and batch confirm agree with the record page. It includes checks that read other records.
 */
export const ReadinessSummary = z.object({
  ready: z.boolean(),
  /** Failing blocker checks. */
  blockers: z.number().int().nonnegative(),
  /** Failing warnings. */
  warnings: z.number().int().nonnegative(),
  /** Values (or list items) that are an agent's unconfirmed estimate. */
  assumed: z.number().int().nonnegative(),
  /** Sections not confirmed as they stand, by title. */
  sectionsLeft: z.array(z.string()),
  /** Sections holding values changed since a person confirmed them, by title. */
  changed: z.array(z.string()),
});
export type ReadinessSummary = z.infer<typeof ReadinessSummary>;

/**
 * A design's input pinned to the version it was built on (ADR 0039): a confirmed SOP, labware type,
 * product or lot at that version. A newer confirmed version is adopted explicitly, never followed
 * silently. Physical state (volumes, instrument availability) is not pinned; it is checked live.
 */
export function pinOf<I extends z.ZodType<string>>(id: I) {
  return z.strictObject({
    id,
    version: z.number().int().positive().describe('The confirmed version the design uses'),
  });
}

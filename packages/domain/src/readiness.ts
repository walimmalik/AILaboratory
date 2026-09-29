import type {
  CheckResult,
  KindCheck,
  KindSection,
  Readiness,
  ReadinessSection,
  RecordEnvelope,
} from '@ailab/schema';

/**
 * Draft and confirm (plan 004c). Whether a record's values are confirmed is derived, never stored: a
 * field is confirmed while it still equals the value a person saw when they confirmed its section.
 */

/** Deep equality for JSON values, ignoring key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)),
        )
      : v,
  );
}

/** The current values of a section's fields, as a person confirms them. */
export function sectionValues(
  section: KindSection,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(section.fields.map((field) => [field, attributes[field]]));
}

/** Runs a kind's checks. A check that throws fails with the error as its message. */
export function runChecks(
  checks: readonly KindCheck<never>[],
  attributes: Record<string, unknown>,
): CheckResult[] {
  return checks.flatMap((check) => {
    let outcome: true | string;
    let quickFix: CheckResult['quickFix'];
    try {
      const applies = (check as unknown as KindCheck).applies;
      if (applies && !applies(attributes)) return [];
      outcome = (check as unknown as KindCheck).test(attributes);
      const offered = (check as unknown as KindCheck).quickFix;
      if (outcome !== true && offered && (!offered.applies || offered.applies(attributes))) {
        quickFix = { operation: offered.operation, label: offered.label };
      }
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    }
    return [
      {
        id: check.id,
        label: check.label,
        severity: check.severity,
        source: check.source,
        ...(check.section ? { section: check.section } : {}),
        passed: outcome === true,
        ...(outcome === true ? {} : { message: outcome }),
        ...(check.fix ? { fix: check.fix } : {}),
        ...(quickFix ? { quickFix } : {}),
      },
    ];
  });
}

/** The parts of a kind definition readiness uses. */
export interface KindRules {
  sections?: readonly KindSection[] | undefined;
  checks?: readonly KindCheck<never>[] | undefined;
  notApplicable?: ((attributes: never) => string[]) | undefined;
}

export function readiness(record: RecordEnvelope, kind: KindRules): Readiness {
  const attributes = record.attributes;
  const sections = kind.sections ?? [];
  const checks = kind.checks ?? [];
  const sectionStates: ReadinessSection[] = sections.map((section) => {
    const review = record.reviews[section.id];
    const fields = section.fields.map((field) => {
      const value = attributes[field];
      const evidence = record.evidence[field];
      const state = !review
        ? ('unconfirmed' as const)
        : sameValue(review.values[field], value)
          ? ('confirmed' as const)
          : ('changed' as const);
      return {
        field,
        value,
        state,
        assumed: state !== 'confirmed' && evidence?.source === 'assumed',
        ...(state === 'changed' ? { confirmedValue: review?.values[field] } : {}),
        ...(evidence ? { evidence } : {}),
      };
    });
    return {
      id: section.id,
      title: section.title,
      state: fields.every((f) => f.state === 'confirmed') ? 'confirmed' : 'needs_review',
      ...(review ? { review } : {}),
      fields,
    };
  });

  const results = runChecks(checks, attributes);
  const missing = [
    ...sectionStates
      .filter((s) => s.state === 'needs_review')
      .map((s) =>
        s.review ? `${s.title} changed since it was confirmed` : `${s.title} is not confirmed`,
      ),
    ...results
      .filter((c) => c.severity === 'blocker' && !c.passed)
      .map((c) => c.message ?? c.label),
  ];
  return {
    recordId: record.id,
    version: record.version,
    status: record.status,
    sections: sectionStates,
    checks: results,
    ready: missing.length === 0,
    missing,
    assumed: sectionStates.flatMap((s) => s.fields.filter((f) => f.assumed).map((f) => f.field)),
    notApplicable: notApplicable(kind, attributes),
  };
}

/** The kind's not-applicable paths for these values; values that don't parse have none. */
function notApplicable(kind: KindRules, attributes: Record<string, unknown>): string[] {
  if (!kind.notApplicable) return [];
  try {
    return kind.notApplicable(attributes as never);
  } catch {
    return [];
  }
}

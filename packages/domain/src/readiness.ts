import type {
  CheckResult,
  KindCheck,
  KindSection,
  Readiness,
  ReadinessItem,
  ReadinessSection,
  ReadinessSummary,
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
  /** Keyed lists: attribute → the field that keys each item (ADR 0049). */
  items?: Readonly<Record<string, string>> | undefined;
}

/** A keyed list's items by key, in order; items without a string key are left out. */
export function keyedItems(list: unknown, keyField: string): Map<string, unknown> {
  const items = new Map<string, unknown>();
  if (!Array.isArray(list)) return items;
  for (const item of list) {
    const key = (item as Record<string, unknown> | null)?.[keyField];
    if (typeof key === 'string' && !items.has(key)) items.set(key, item);
  }
  return items;
}

/** The evidence key of one item of a keyed list. */
export const itemPath = (field: string, key: string) => `/${field}/${key}`;

/**
 * `related` are checks that needed other records (an entity against its kind), worked out by the
 * record service and merged with the kind's own.
 */
export function readiness(
  record: RecordEnvelope,
  kind: KindRules,
  related: CheckResult[] = [],
): Readiness {
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
      const keyField = kind.items?.[field];
      if (keyField) {
        const now = keyedItems(value, keyField);
        const was = keyedItems(review?.values[field], keyField);
        const items: ReadinessItem[] = [...now].map(([key, item]) => {
          const path = itemPath(field, key);
          const own = record.evidence[path] ?? evidence;
          const itemState = !review
            ? ('unconfirmed' as const)
            : !was.has(key)
              ? ('added' as const)
              : sameValue(was.get(key), item)
                ? ('confirmed' as const)
                : ('changed' as const);
          return {
            key,
            path,
            value: item,
            state: itemState,
            assumed: itemState !== 'confirmed' && own?.source === 'assumed',
            ...(itemState === 'changed' ? { confirmedValue: was.get(key) } : {}),
            ...(own ? { evidence: own } : {}),
          };
        });
        const removed = [...was].filter(([key]) => !now.has(key));
        const sameKeys = removed.length === 0 && now.size === was.size;
        const reordered =
          !!review && sameKeys && [...now.keys()].join('\u0000') !== [...was.keys()].join('\u0000');
        return {
          field,
          value,
          state,
          assumed: items.some((i) => i.assumed),
          ...(state === 'changed' ? { confirmedValue: review?.values[field] } : {}),
          ...(evidence ? { evidence } : {}),
          items,
          ...(removed.length ? { removed: removed.map(([key, v]) => ({ key, value: v })) } : {}),
          ...(reordered ? { reordered } : {}),
        };
      }
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

  const results = [...runChecks(checks, attributes), ...related];
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
    // A keyed list names the items that are guesses, so "3 assumed" counts steps, not the list.
    assumed: sectionStates.flatMap((s) =>
      s.fields.flatMap((f) =>
        f.items ? f.items.filter((i) => i.assumed).map((i) => i.path) : f.assumed ? [f.field] : [],
      ),
    ),
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

/** Readiness in one line (ADR 0050): what Review, lists and batch confirm read. */
export function summarizeReadiness(state: Readiness): ReadinessSummary {
  const failing = state.checks.filter((c) => !c.passed);
  return {
    ready: state.ready,
    blockers: failing.filter((c) => c.severity === 'blocker').length,
    warnings: failing.filter((c) => c.severity === 'warning').length,
    assumed: state.assumed.length,
    sectionsLeft: state.sections.filter((s) => s.state === 'needs_review').map((s) => s.title),
    changed: state.sections
      .filter((s) => s.state === 'needs_review' && s.review)
      .map((s) => s.title),
  };
}

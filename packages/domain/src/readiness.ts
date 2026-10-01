import type {
  CheckResult,
  FieldEvidence,
  KindCheck,
  KindSection,
  Readiness,
  ReadinessItem,
  ReadinessSection,
  ReadinessSummary,
  RecordEnvelope,
} from '@ailab/schema';
import { keyedEntries } from './keyed.ts';

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
    let options: CheckResult['options'];
    try {
      const applies = (check as unknown as KindCheck).applies;
      if (applies && !applies(attributes)) return [];
      outcome = (check as unknown as KindCheck).test(attributes);
      const offer = (check as unknown as KindCheck).options;
      const offered = outcome !== true && offer ? offer(attributes) : [];
      if (offered.length) options = offered.map((o) => ({ ...o, input: o.input ?? {} }));
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
        ...(options ? { options } : {}),
      },
    ];
  });
}

/** The parts of a kind definition readiness uses. */
export interface KindRules {
  sections?: readonly KindSection[] | undefined;
  checks?: readonly KindCheck<never>[] | undefined;
  notApplicable?: ((attributes: never) => string[]) | undefined;
  /** Keyed lists: list → the field or fields that key each item (ADR 0049, ADR 0065). */
  items?: Readonly<Record<string, string>> | undefined;
}

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
      if (kind.items?.[field]) {
        const keys = kind.items;
        const now = keyedEntries(value, field, keys);
        const was = new Map(
          keyedEntries(review?.values[field], field, keys).map((e) => [e.path, e]),
        );
        const nowPaths = new Set(now.map((e) => e.path));
        const items: ReadinessItem[] = now.map((entry) => {
          const { path, key } = entry;
          const before = was.get(path);
          const own = record.evidence[path] ?? evidence;
          const itemState = !review
            ? ('unconfirmed' as const)
            : !before
              ? ('added' as const)
              : sameValue(before.own, entry.own)
                ? ('confirmed' as const)
                : ('changed' as const);
          return {
            key,
            path,
            value: entry.value,
            state: itemState,
            assumed: itemState !== 'confirmed' && own?.source === 'assumed',
            ...(itemState === 'changed' ? { confirmedValue: before?.value } : {}),
            ...(own ? { evidence: own } : {}),
          };
        });
        const removed = [...was.values()].filter((e) => !nowPaths.has(e.path));
        const sameKeys = removed.length === 0 && now.length === was.size;
        const reordered =
          !!review &&
          sameKeys &&
          now.map((e) => e.path).join('\u0000') !== [...was.keys()].join('\u0000');
        return {
          field,
          value,
          state,
          assumed: items.some((i) => i.assumed),
          ...(state === 'changed' ? { confirmedValue: review?.values[field] } : {}),
          ...(evidence ? { evidence } : {}),
          items,
          ...(removed.length
            ? { removed: removed.map((e) => ({ key: e.key, value: e.value })) }
            : {}),
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

  // Options act on this record as it stands, so each carries its id and version.
  const results = [...runChecks(checks, attributes), ...related].map((c) =>
    c.options && !c.passed
      ? {
          ...c,
          options: c.options.map((o) => ({
            ...o,
            input: { id: record.id, expectedVersion: record.version, ...o.input },
          })),
        }
      : (({ options: _, ...rest }) => rest)(c),
  );
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
    assumed: sections.length
      ? sectionStates.flatMap((s) =>
          s.fields.flatMap((f) =>
            f.items
              ? f.items.filter((i) => i.assumed).map((i) => i.path)
              : f.assumed
                ? [f.field]
                : [],
          ),
        )
      : sectionlessAssumed(record),
    unchecked: sections.length
      ? sectionStates.flatMap((s) =>
          s.fields.flatMap((f) =>
            f.items
              ? f.items
                  .filter((i) => i.state !== 'confirmed' && agentClaim(i.evidence))
                  .map((i) => i.path)
              : f.state !== 'confirmed' && agentClaim(f.evidence)
                ? [f.field]
                : [],
          ),
        )
      : record.status === 'draft'
        ? Object.entries(record.evidence)
            .filter(([, e]) => agentClaim(e))
            .map(([key]) => key)
        : [],
    notApplicable: notApplicable(kind, attributes),
  };
}

/**
 * A kind without sections is confirmed whole, when its draft becomes active: until then every value
 * an agent guessed is an estimate, and once active none is.
 */
/**
 * A source an agent named that the server can't check (ADR 0049 checks calculations and copies;
 * "stated" is the person's own word). Such a value is confirmed only by a person looking at it.
 */
const UNCHECKED_SOURCES: readonly string[] = ['datasheet', 'imported', 'measured'];
const agentClaim = (e: FieldEvidence | undefined) =>
  e?.by.type === 'agent' && UNCHECKED_SOURCES.includes(e.source);

function sectionlessAssumed(record: RecordEnvelope): string[] {
  if (record.status !== 'draft') return [];
  const guessed = Object.entries(record.evidence)
    .filter(([, e]) => e.source === 'assumed')
    .map(([key]) => key);
  // A keyed list counts its guessed items, not the list as well.
  return guessed.filter(
    (key) => key.startsWith('/') || !guessed.some((k) => k.startsWith(`/${key}/`)),
  );
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

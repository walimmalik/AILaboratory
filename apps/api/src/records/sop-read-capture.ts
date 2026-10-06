import type { Readiness, RecordEnvelope } from '@ailab/schema';

/** Internal evidence from one SOP readiness phase, never a persisted dependency graph. */
export type SopReadFact = { id: string; version: number };
export type SopCaptureIssue =
  | { code: 'unavailable_record'; id: string }
  | { code: 'conflicting_version'; id: string; versions: number[] }
  | { code: 'unsupported_access'; mode: 'getVersion' | 'list' }
  | { code: 'unsupported_target'; id: string }
  | { code: 'transaction_required' };

export type SopReadinessCapture =
  | { status: 'complete'; target: SopReadFact; reads: SopReadFact[]; readiness: Readiness }
  | {
      status: 'incomplete';
      target?: SopReadFact;
      reads: SopReadFact[];
      readiness?: Readiness;
      issues: SopCaptureIssue[];
    };

export class UnsupportedSopRead extends Error {}

/** Only the existing scoped current-record getter is supported. One instance per invocation. */
export class SopReadCapture {
  readonly #versions = new Map<string, Set<number>>();
  readonly #unavailable = new Set<string>();
  readonly #unsupported = new Set<'getVersion' | 'list'>();

  observe(id: string, record: RecordEnvelope | undefined): void {
    if (!record) {
      this.#unavailable.add(id);
      return;
    }
    const versions = this.#versions.get(record.id) ?? new Set<number>();
    versions.add(record.version);
    this.#versions.set(record.id, versions);
  }

  unsupported(mode: 'getVersion' | 'list'): never {
    this.#unsupported.add(mode);
    throw new UnsupportedSopRead(`SOP read capture does not support ${mode}`);
  }

  result(target: SopReadFact, state?: Readiness): SopReadinessCapture {
    const observed = [...this.#versions].sort(([a], [b]) => a.localeCompare(b));
    const reads = observed.flatMap(([id, versions]) =>
      [...versions].sort((a, b) => a - b).map((version) => ({ id, version })),
    );
    const issues: SopCaptureIssue[] = [
      ...[...this.#unavailable].sort().map((id) => ({ code: 'unavailable_record' as const, id })),
      ...observed.flatMap(([id, versions]) =>
        versions.size > 1
          ? [
              {
                code: 'conflicting_version' as const,
                id,
                versions: [...versions].sort((a, b) => a - b),
              },
            ]
          : [],
      ),
      ...[...this.#unsupported]
        .sort()
        .map((mode) => ({ code: 'unsupported_access' as const, mode })),
    ];
    if (issues.length || !state)
      return {
        status: 'incomplete',
        target,
        reads,
        ...(state ? { readiness: state } : {}),
        issues,
      };
    return { status: 'complete', target, reads, readiness: state };
  }
}

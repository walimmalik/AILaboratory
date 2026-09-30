import type { RecordEnvelope, RelatedContext } from '@ailab/schema';

/**
 * Pinned design inputs (ADR 0039). A design stores `{id, version}` for each confirmed record it is
 * built on. The pin must name a version a person confirmed (the record was active at it). A newer
 * confirmed version with different values is reported, and adopted only when someone chooses to.
 */
export interface PinReport {
  /** The pinned record now, when it exists and is of the kind. */
  record?: RecordEnvelope;
  /** Refuses the write: the record is missing, of another kind, or has no such version. */
  invalid?: string;
  /** The pinned version was never confirmed. */
  unconfirmed?: string;
  /** The version a design should move to, when a newer confirmed one differs. */
  newer?: number;
}

export async function checkPin(
  context: Pick<RelatedContext, 'get' | 'getVersion'>,
  pin: { id: string; version: number },
  kind: string,
  noun: string,
): Promise<PinReport> {
  const record = await context.get(pin.id);
  if (record?.kind !== kind) return { invalid: `${pin.id} is not ${noun} in this lab` };
  const pinned = await context.getVersion(pin.id, pin.version);
  if (!pinned) return { record, invalid: `${record.name} has no version ${pin.version}` };
  const report: PinReport = { record };
  if (pinned.status !== 'active') {
    report.unconfirmed = `${record.name} v${pin.version} was not confirmed`;
  }
  if (
    record.status === 'active' &&
    record.version > pin.version &&
    stable(record.attributes) !== stable(pinned.attributes)
  ) {
    report.newer = record.version;
  }
  return report;
}

/** JSON with object keys sorted, so equal values compare equal whatever order they were stored in. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

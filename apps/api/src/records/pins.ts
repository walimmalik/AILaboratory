import { type RecordEnvelope, type RelatedContext, SopAttributes } from '@ailab/schema';

/**
 * Pinned design inputs (ADR 0039). A design stores `{id, version}` for each confirmed record it is
 * built on. The pin must name a version a person confirmed (the record was active at it). A newer
 * confirmed version with different values is reported, and adopted only when someone chooses to.
 */
export interface PinReport {
  /** The pinned record now, when it exists and is of the kind. */
  record?: RecordEnvelope;
  /** The record as it was at the pinned version. */
  pinned?: RecordEnvelope;
  /** Refuses the write: the record is missing, of another kind, or has no such version. */
  invalid?: string;
  /** The pinned version was never confirmed. */
  unconfirmed?: string;
  /** The pinned record when it is still a draft: the fix is to confirm it, on its own page. */
  draft?: string;
  /** The version a design should move to, when a newer confirmed one differs. */
  newer?: number;
}

export async function checkPin(
  context: Pick<RelatedContext, 'get' | 'getVersion'>,
  pin: { id: string; version: number },
  kind: string | readonly string[],
  noun: string,
): Promise<PinReport> {
  const record = await context.get(pin.id);
  if (!record || ![kind].flat().includes(record.kind))
    return { invalid: `${pin.id} is not ${noun} in this lab` };
  const pinned = await context.getVersion(pin.id, pin.version);
  if (!pinned) return { record, invalid: `${record.name} has no version ${pin.version}` };
  if (pinned.kind === 'sop' && !SopAttributes.safeParse(pinned.attributes).success)
    return {
      record,
      invalid: `${record.name} v${pin.version} uses an unsupported question contract; reconcile its history before scientific use`,
    };
  const report: PinReport = { record, pinned };
  if (pinned.status !== 'active') {
    report.unconfirmed = `${record.label} (${record.name}) v${pin.version} was not confirmed`;
    if (record.status === 'draft') report.draft = record.id;
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

/**
 * Points a failing check at the first pinned record still in draft (`CheckResult.record`), so the
 * page links to where the fix is made instead of a section of the design.
 */
export function waitingOn(...reports: (PinReport | undefined)[]): { record?: string } {
  const draft = reports.find((r) => r?.draft)?.draft;
  return draft ? { record: draft } : {};
}

/** JSON with object keys sorted, so equal values compare equal whatever order they were stored in. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

import { describe, expect, it } from 'vitest';
import { proposalsApprove } from './operations/proposals.ts';
import { reviewPrepareDecision } from './operations/review.ts';
import { SopDefaultEdit } from './sop-default-decision.ts';

describe('staged SOP default input', () => {
  const input = {
    sop: 'sop_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
    expectedVersion: 2,
    variable: 'well_volume',
    value: { value: '80', unit: 'uL' },
    reason: 'Use this planning default',
  };
  it('accepts only the typed single-default selector, never injected operation/provenance/check authority', () => {
    expect(SopDefaultEdit.parse(input)).toEqual(input);
    expect(reviewPrepareDecision.input.parse(input)).toEqual(input);
    for (const extra of [
      { operationId: 'records.update' },
      { attributes: {} },
      { origin: { type: 'unknown' } },
      { reads: [] },
      { checks: [] },
      { path: '/variables/x' },
    ])
      expect(SopDefaultEdit.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(
      SopDefaultEdit.safeParse({ ...input, value: { ...input.value, evidence: 'validated' } })
        .success,
    ).toBe(false);
    expect(SopDefaultEdit.safeParse({ ...input, expectedVersion: 0 }).success).toBe(false);
    expect(
      SopDefaultEdit.safeParse({ ...input, value: [{ value: '80', unit: 'uL' }] }).success,
    ).toBe(false);
  });
  it('keeps ordinary approval input while validating the exact scientific preview token and refusing injected authority', () => {
    const id = 'prp_01J9Z3K8Q4ABCDEFGHJKMNPQRS';
    expect(proposalsApprove.input.parse({ id })).toEqual({ id });
    expect(proposalsApprove.input.parse({ id, expectedPreview: 'a'.repeat(64) })).toEqual({
      id,
      expectedPreview: 'a'.repeat(64),
    });
    for (const expectedPreview of ['a'.repeat(63), 'A'.repeat(64), 'not-a-digest'])
      expect(proposalsApprove.input.safeParse({ id, expectedPreview }).success).toBe(false);
    expect(proposalsApprove.input.safeParse({ id, origin: { type: 'unknown' } }).success).toBe(
      false,
    );
  });
});

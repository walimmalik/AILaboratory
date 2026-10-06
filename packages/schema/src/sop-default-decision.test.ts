import { describe, expect, it } from 'vitest';
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
});

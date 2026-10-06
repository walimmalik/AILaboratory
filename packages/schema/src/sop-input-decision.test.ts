import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reviewPrepareDecision } from './operations/review.ts';
import { SopInputDecision } from './sop-input-decision.ts';

describe('existing experiment input decision selector', () => {
  const input = {
    sop: 'sop_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    expectedVersion: 2,
    question: 'count',
    reason: 'Each experiment must choose its count',
  };
  it('accepts only the selected question/version and reason, never caller scope or identity', () => {
    expect(SopInputDecision.parse(input)).toEqual(input);
    for (const extra of [
      { value: '24' },
      { variable: 'count' },
      { approvedBy: 'Sam' },
      { condition: 'Optional' },
      { stage: 'method' },
      { operationId: 'records.update' },
    ])
      expect(SopInputDecision.safeParse({ ...input, ...extra }).success).toBe(false);
    for (const changed of [{ expectedVersion: 0 }, { reason: '  ' }, { question: '' }])
      expect(SopInputDecision.safeParse({ ...input, ...changed }).success).toBe(false);
  });
  it('advertises and enforces two strict nonoverlapping preparation selectors', () => {
    const volume = {
      sop: input.sop,
      expectedVersion: input.expectedVersion,
      variable: 'well_volume',
      value: { value: '80', unit: 'uL' },
      reason: 'Choose default',
    };
    expect(reviewPrepareDecision.input.parse(input)).toEqual(input);
    expect(reviewPrepareDecision.input.parse(volume)).toEqual(volume);
    expect(reviewPrepareDecision.input.safeParse({ ...input, ...volume }).success).toBe(false);
    expect(
      reviewPrepareDecision.input.safeParse({
        sop: input.sop,
        expectedVersion: 2,
        reason: 'No selector',
      }).success,
    ).toBe(false);
    const schema = z.toJSONSchema(reviewPrepareDecision.input) as {
      anyOf: { required: string[]; additionalProperties: boolean }[];
    };
    expect(schema.anyOf).toHaveLength(2);
    expect(schema.anyOf.map((s) => s.required)).toEqual([
      ['sop', 'expectedVersion', 'variable', 'value', 'reason'],
      ['sop', 'expectedVersion', 'question', 'reason'],
    ]);
    expect(schema.anyOf.every((s) => s.additionalProperties === false)).toBe(true);
  });
});

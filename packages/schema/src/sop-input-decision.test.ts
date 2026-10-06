import { describe, expect, it } from 'vitest';
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
});

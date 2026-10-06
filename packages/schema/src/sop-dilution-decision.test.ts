import { describe, expect, it } from 'vitest';
import { reviewPrepareDecision } from './operations/review.ts';
import { SopDilutionDecision } from './sop-dilution-decision.ts';

const selector = {
  type: 'dilution_final_volume',
  sop: 'sop_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  expectedVersion: 1,
  question: 'volume',
  value: { value: '5', unit: 'mL' },
  passage: 'retained-step-seven',
  reason: 'Complete retained transcription',
};
describe('bounded dilution selector contract', () => {
  it('accepts the same strict selector in public preparation without mixed or caller-owned fields', () => {
    expect(SopDilutionDecision.parse(selector)).toEqual(selector);
    expect(reviewPrepareDecision.input.parse(selector)).toEqual(selector);
    for (const extra of [
      { variable: 'selected_by_server' },
      { affected: ['/variables/x'] },
      { basis: {} },
      { approvedBy: {} },
    ]) {
      expect(SopDilutionDecision.safeParse({ ...selector, ...extra }).success).toBe(false);
      expect(reviewPrepareDecision.input.safeParse({ ...selector, ...extra }).success).toBe(false);
    }
    for (const value of [
      { value: '5e0', unit: 'mL' },
      { value: 5, unit: 'mL' },
      { value: '5', unit: 'mL', label: 'Forged' },
    ])
      expect(SopDilutionDecision.safeParse({ ...selector, value }).success).toBe(false);
  });
});

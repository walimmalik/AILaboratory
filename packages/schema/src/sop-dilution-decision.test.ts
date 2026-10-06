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
describe('private dilution selector contract', () => {
  it('accepts only its bounded fields while the current public prepare still refuses it', () => {
    expect(SopDilutionDecision.parse(selector)).toEqual(selector);
    expect(reviewPrepareDecision.input.safeParse(selector).success).toBe(false);
    for (const extra of [
      { variable: 'selected_by_server' },
      { affected: ['/variables/x'] },
      { basis: {} },
      { approvedBy: {} },
    ])
      expect(SopDilutionDecision.safeParse({ ...selector, ...extra }).success).toBe(false);
    for (const value of [
      { value: '5e0', unit: 'mL' },
      { value: 5, unit: 'mL' },
      { value: '5', unit: 'mL', label: 'Forged' },
    ])
      expect(SopDilutionDecision.safeParse({ ...selector, value }).success).toBe(false);
  });
});

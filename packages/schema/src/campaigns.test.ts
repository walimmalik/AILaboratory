import { describe, expect, it } from 'vitest';
import { RunStep } from './campaigns.ts';

describe('captured run step instructions', () => {
  it('permits an older uncaptured step, preserves instructions, and rejects empty captured text', () => {
    const step = { part: 'coating', step: 'coat', title: 'Coat', planned: [], status: 'pending' };
    expect(RunStep.safeParse(step).success).toBe(true);
    expect(RunStep.parse({ ...step, text: 'Add coating solution. Seal the plate.' }).text).toBe(
      'Add coating solution. Seal the plate.',
    );
    expect(RunStep.safeParse({ ...step, text: '' }).success).toBe(false);
  });
});

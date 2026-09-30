import { describe, expect, it } from 'vitest';
import { nextActions, plannedText, runProgress } from './experiments.ts';

describe('experiments', () => {
  it('counts ticked steps and deviations', () => {
    expect(
      runProgress({
        steps: [
          { part: 'a', step: 'coat', title: 'Coat', planned: [], status: 'done' },
          {
            part: 'a',
            step: 'wash',
            title: 'Wash',
            planned: [],
            status: 'skipped',
            deviation: { what: 'Skipped Wash', why: 'Washer down' },
          },
          { part: 'a', step: 'read', title: 'Read', planned: [], status: 'pending' },
        ],
        deviations: [
          {
            what: 'Late',
            why: 'Drill',
            at: '2026-09-30T10:00:00Z',
            by: { type: 'user', userId: 'usr_1' },
          },
        ],
      }),
    ).toEqual({ ticked: 2, total: 3, deviations: 2 });
  });

  it('writes planned values in one line', () => {
    expect(
      plannedText({
        planned: [
          { name: 'volume', value: { value: '100', unit: 'uL' } },
          { name: 'times', value: '3' },
        ],
      }),
    ).toBe('volume 100 µL · times 3');
  });

  it('offers only what the stage allows, and nothing on a draft', () => {
    expect(nextActions('designing', 'draft')).toEqual([]);
    expect(nextActions('designing', 'active')).toEqual(['plan']);
    expect(nextActions('running', 'active')).toEqual(['start_run', 'analyse', 'conclude']);
    expect(nextActions('concluded', 'active')).toEqual([]);
  });
});

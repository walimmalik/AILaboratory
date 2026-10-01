import { describe, expect, it } from 'vitest';
import { addMonths, checkAgainFor, isDue } from './memory.ts';

describe('lab memory dates', () => {
  it('adds months, keeping to the end of shorter months', () => {
    expect(addMonths('2026-09-30', 6)).toBe('2027-03-30');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
  });

  it('sets the check-again date by kind, never for preferences', () => {
    expect(checkAgainFor('quirk', '2026-10-01')).toBe('2027-04-01');
    expect(checkAgainFor('lesson', '2026-10-01')).toBe('2027-04-01');
    expect(checkAgainFor('convention', '2026-10-01')).toBe('2027-10-01');
    expect(checkAgainFor('fact', '2026-10-01')).toBe('2027-10-01');
    expect(checkAgainFor('preference', '2026-10-01')).toBeUndefined();
  });

  it('is due on and after its date', () => {
    expect(isDue('2026-10-01', '2026-09-30')).toBe(false);
    expect(isDue('2026-10-01', '2026-10-01')).toBe(true);
    expect(isDue(undefined, '2030-01-01')).toBe(false);
  });
});

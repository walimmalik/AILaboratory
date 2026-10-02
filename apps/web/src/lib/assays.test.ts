import { describe, expect, it } from 'vitest';
import { readAnswer } from './assays.ts';

describe('readAnswer', () => {
  it('reads a number with a unit as a quantity and keeps the rest as typed', () => {
    expect(readAnswer(' 50 µL ')).toEqual({ value: '50', unit: 'uL' });
    expect(readAnswer('2.5mM')).toEqual({ value: '2.5', unit: 'mM' });
    expect(readAnswer('10')).toBe('10');
    expect(readAnswer('10 folds')).toBe('10 folds');
  });
});

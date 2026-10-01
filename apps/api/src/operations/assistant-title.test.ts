import { describe, expect, it } from 'vitest';
import { titleFrom } from './assistant-operations.ts';

describe('conversation titles', () => {
  it('names a conversation by its ask, without the polite lead-in', () => {
    expect(titleFrom('can you register NEB as a vendor? thanks')).toBe('Register NEB as a vendor');
    expect(titleFrom('Please draft an ELISA plate map.\nUse 96 wells')).toBe(
      'Draft an ELISA plate map',
    );
    const long = titleFrom(
      'Work out the dilution series for the compound screen from the 10 mM DMSO stocks',
    );
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith('…')).toBe(true);
    expect(titleFrom('')).toBe('');
  });
});

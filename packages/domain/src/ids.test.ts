import { RecordId } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { formatName, newId } from './ids.ts';

describe('ids', () => {
  it('creates valid, unique record IDs', () => {
    const a = newId('lw');
    const b = newId('lw');
    expect(RecordId.parse(a)).toBe(a);
    expect(a).not.toBe(b);
    expect(() => newId('LW')).toThrow();
  });

  it('formats readable names and grows past the width', () => {
    expect(formatName('PLT', 345, 6)).toBe('PLT-000345');
    expect(formatName('PLS', 10000, 4)).toBe('PLS-10000');
    expect(() => formatName('PLT', 0, 6)).toThrow();
    expect(() => formatName('plt', 1, 6)).toThrow();
  });
});

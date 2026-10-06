import { describe, expect, it } from 'vitest';
import { dilutionQuoteFacts } from './dilution-completion.ts';

describe('bounded quote assertions', () => {
  it.each(['1:10 ratio and final volume of 5.0mL', '1:10.0 ratio and final volume of 5000 uL'])(
    'recognizes positive complete assertions %s',
    (quote) => {
      expect(dilutionQuoteFacts(quote).factor).toMatch(/^10/);
    },
  );
  it.each(['-1:10', '1:-10', '1:1', '1:0', '1:0.5', '1:10e3', '1:10.5.2', '1:10foo', '1:10:2'])(
    'refuses unsupported ratio %s',
    (ratio) => {
      expect(() => dilutionQuoteFacts(`${ratio} ratio and final volume of 5.0mL`)).toThrow();
    },
  );
  it.each([
    '-5mL',
    '0mL',
    '.5mL',
    '05mL',
    '5e0mL',
    '5.0.2mL',
    '5ML',
    '5ml',
    '5mL/min',
    '5mLfoo',
    '5mL.e3',
    '5mL^2',
    '5mL:2',
  ])('refuses malformed or unsupported quantity %s', (volume) => {
    expect(() => dilutionQuoteFacts(`1:10 ratio and final volume of ${volume}`)).toThrow();
  });
  it('refuses duplicate assertions', () => {
    expect(() => dilutionQuoteFacts('1:10 ratio and 1:20 ratio and final volume of 5mL')).toThrow();
    expect(() =>
      dilutionQuoteFacts('1:10 ratio and final volume of 5mL and final volume of 6mL'),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { checkStock, StockError } from './stock.ts';

const mL = (value: string) => ({ value, unit: 'mL' });
const uL = (value: string) => ({ value, unit: 'uL' });

describe('checkStock', () => {
  it('adds what the wells hold in the unit needed, less what is reserved', () => {
    expect(
      checkStock(mL('1.5'), [{ volume: uL('1000') }, { volume: mL('1'), reserved: uL('200') }]),
    ).toEqual({
      verdict: 'enough',
      holds: mL('2'),
      reserved: mL('0.2'),
      available: mL('1.8'),
      unknownWells: 0,
    });
  });

  it('says how much is missing when short', () => {
    expect(checkStock(mL('2'), [{ volume: mL('1'), reserved: mL('0.5') }])).toMatchObject({
      verdict: 'short',
      available: mL('0.5'),
      short: mL('1.5'),
    });
    expect(checkStock(uL('10'), [])).toMatchObject({ verdict: 'short', short: uL('10') });
  });

  it('never counts less than nothing, and is unknown when a well has no volume', () => {
    expect(checkStock(mL('1'), [{ volume: mL('1'), reserved: mL('3') }])).toMatchObject({
      verdict: 'short',
      available: mL('0'),
    });
    expect(checkStock(mL('1'), [{ volume: 'unknown' }, { volume: uL('5') }])).toMatchObject({
      verdict: 'unknown',
      unknownWells: 1,
    });
    expect(checkStock(mL('1'), [{ volume: 'unknown' }, { volume: mL('2') }]).verdict).toBe(
      'enough',
    );
  });

  it('refuses an amount that is not a volume', () => {
    expect(() => checkStock({ value: '5', unit: 'mg' }, [])).toThrow(StockError);
  });
});

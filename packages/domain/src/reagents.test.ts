import { describe, expect, it } from 'vitest';
import {
  addDays,
  lotInDate,
  lotSummary,
  sameDimension,
  scaleRecipe,
  storageBand,
} from './reagents.ts';

const prd = (n: number) => `prd_01J9Z3K8Q4ABCDEFGHJKMNPQR${n}`;
const diluent = {
  yields: { value: '500', unit: 'mL' },
  components: [
    { product: prd(1), amount: { value: '5', unit: 'g' } },
    { product: prd(2), amount: { value: '500', unit: 'mL' } },
  ],
};

describe('scaleRecipe', () => {
  it('scales every component by target over yield, in the target’s own dimension', () => {
    expect(scaleRecipe(diluent, { value: '250', unit: 'mL' })).toEqual({
      factor: '0.5',
      components: [
        { product: prd(1), amount: { value: '2.5', unit: 'g' } },
        { product: prd(2), amount: { value: '250', unit: 'mL' } },
      ],
    });
    expect(scaleRecipe(diluent, { value: '2', unit: 'L' }).factor).toBe('4');
  });

  it('refuses a target that measures something else', () => {
    expect(() => scaleRecipe(diluent, { value: '1', unit: 'g' })).toThrow(/yields volume/);
  });
});

describe('sameDimension', () => {
  it('compares what units measure', () => {
    expect(sameDimension('ug/mL', 'ng/mL')).toBe(true);
    expect(sameDimension('ug/mL', 'nM')).toBe(false);
    expect(sameDimension('mPa.s', 'Pa.s')).toBe(true);
  });
});

describe('storageBand', () => {
  const c = (value: string) => ({ value, unit: 'degC' });
  it('reads the upper end of the range', () => {
    expect(storageBand({ min: c('2'), max: c('8') })).toBe('fridge');
    expect(storageBand({ min: c('15'), max: c('25') })).toBe('room');
    expect(storageBand({ max: c('-20') })).toBe('freezer');
    expect(storageBand({ max: c('-65') })).toBe('deep_freezer');
    expect(storageBand({ max: c('-150') })).toBe('cryo');
    expect(storageBand({ min: c('-80') })).toBe('deep_freezer');
  });
});

describe('lotSummary', () => {
  it('counts lots in date and finds the next expiry', () => {
    const today = '2026-09-30';
    expect(
      lotSummary(
        [
          { status: 'unopened', expiry: '2027-01-01' },
          { status: 'opened', expiry: '2026-10-15' },
          { status: 'unopened', expiry: '2026-09-29' },
          { status: 'quarantined', expiry: '2026-10-01' },
          { status: 'opened' },
        ],
        today,
      ),
    ).toEqual({ count: 5, inDate: 3, nextExpiry: '2026-10-15' });
    expect(lotSummary([], today)).toEqual({ count: 0, inDate: 0 });
    expect(lotInDate({ status: 'unopened', expiry: today }, today)).toBe(true);
  });

  it('adds days across months', () => {
    expect(addDays('2026-09-30', 30)).toBe('2026-10-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

import { describe, expect, it } from 'vitest';
import { sameDimension, scaleRecipe } from './reagents.ts';

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

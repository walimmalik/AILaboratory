import { describe, expect, it } from 'vitest';
import { quantitiesIn, type ScoredDraft, type SopExpectation, scoreSop } from './sop-benchmark.ts';

const q = (value: string, unit: string) => ({ value, unit });

const expectation: SopExpectation = {
  materials: [
    { label: 'DH5 alpha competent cells', aliases: ['DH5α'] },
    { label: 'LB broth chloramphenicol' },
    { label: 'Plate reader' },
  ],
  steps: [
    { action: 'incubate', quantities: [q('16', 'h'), q('37', 'degC')] },
    { action: ['transfer', 'add'], quantities: [q('200', 'uL')] },
    { action: 'read', quantities: [q('600', 'nm')] },
  ],
  values: [{ quantity: q('34', 'ug/mL'), about: 'chloramphenicol' }, { quantity: q('12', 'mL') }],
  questions: [{ about: 'How long to thaw the cells', words: ['thaw'] }],
};

const draft: ScoredDraft = {
  materials: [
    { label: 'E. coli DH5 alpha competent cells' },
    { label: 'LB broth + chloramphenicol (34 µg/mL)' },
    { label: 'Ice' },
  ],
  solutions: [{ label: 'Chloramphenicol stock', text: '34 ug/mL in LB' }],
  variables: [{ name: 'well_volume', value: q('0.2', 'mL') }],
  steps: [
    {
      action: 'transfer',
      text: 'Transfer each culture to plate 1.',
      parameters: [{ variable: 'well_volume' }],
    },
    { action: 'incubate', text: 'Grow overnight (16 hours) at 37.0°C and 220 rpm.' },
    { action: 'read', text: 'Measure absorbance at 500 nm.' },
  ],
  questions: [{ question: 'Thaw the competent cells on ice for how long?' }],
};

describe('scoreSop', () => {
  it('scores each section, matching values across units and through variables', () => {
    const score = scoreSop(draft, expectation);
    expect(score.materials).toMatchObject({ expected: 3, found: 2, missing: ['Plate reader'] });
    // Ice and the stock solution match nothing expected.
    expect(score.materials?.precision).toBe(0.5);
    // 200 uL is the variable's 0.2 mL; 16 hours and 37.0°C are read from the words; 600 nm is wrong.
    expect(score.steps).toMatchObject({ expected: 3, found: 2, missing: ['read 600 nm'] });
    expect(score.steps?.order).toBe(0.5);
    expect(score.values).toMatchObject({ found: 1, missing: ['12 mL'] });
    expect(score.questions).toMatchObject({ found: 1, recall: 1 });
    expect(score.overall).toBeCloseTo((2 / 3 + 2 / 3 + 1 / 2 + 1) / 4);
  });

  it('scores an empty draft as zero and only the sections expected', () => {
    const score = scoreSop(
      { materials: [], variables: [], steps: [] },
      { steps: expectation.steps ?? [] },
    );
    expect(score).toEqual({
      steps: expect.objectContaining({ found: 0, recall: 0, precision: 0, order: 0 }),
      overall: 0,
    });
  });

  it('reads quantities from running text', () => {
    expect(quantitiesIn('Add 200uL, spin 5 min at 1500 rpm, then 37 °C for 2 hours')).toEqual([
      q('200', 'uL'),
      q('5', 'min'),
      q('1500', 'rpm'),
      q('37', 'degC'),
      q('2', 'h'),
    ]);
  });
});

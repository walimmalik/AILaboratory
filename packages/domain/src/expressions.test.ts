import { describe, expect, it } from 'vitest';
import {
  type ExpressionInput,
  evaluateExpression,
  evaluateVariables,
  parseExpression,
  variablesOf,
} from './expressions.ts';

const values: Record<string, ExpressionInput> = {
  n_samples: '40',
  replicates: '2',
  well_volume: { value: '100', unit: 'uL' },
  dead_volume: { value: '5', unit: 'mL' },
  stock_conc: { value: '10', unit: 'mg/mL' },
  final_conc: { value: '2', unit: 'ug/mL' },
  final_volume: { value: '12', unit: 'mL' },
  incubator: { value: '37', unit: 'degC' },
  standards: [
    { value: '100', unit: 'uL' },
    { value: '50', unit: 'uL' },
    { value: '25', unit: 'uL' },
  ],
  'plate.dead_volume': { value: '20', unit: 'uL' },
};
const run = (expression: string, unit?: string) =>
  evaluateExpression(expression, (name) => values[name], unit ? { unit } : {});

describe('evaluateExpression', () => {
  it('scales a volume with the run and adds the dead volume, in exact decimals', () => {
    expect(run('n_samples * replicates * well_volume + dead_volume')).toEqual({
      type: 'quantity',
      quantity: { value: '13000', unit: 'uL' },
    });
    expect(run('n_samples * replicates * well_volume + dead_volume', 'mL')).toEqual({
      type: 'quantity',
      quantity: { value: '13', unit: 'mL' },
    });
    expect(run('0.1 + 0.2')).toEqual({ type: 'number', value: '0.3' });
  });

  it('works out a stock volume from concentrations (C1V1 = C2V2)', () => {
    expect(run('final_conc * final_volume / stock_conc', 'uL')).toEqual({
      type: 'quantity',
      quantity: { value: '2.4', unit: 'uL' },
    });
    expect(run('final_volume * (final_conc / stock_conc)')).toEqual({
      type: 'quantity',
      quantity: { value: '0.0024', unit: 'mL' },
    });
  });

  it('reads units on numbers, as codes or symbols', () => {
    expect(run('50 µL + 0.05 mL')).toEqual({
      type: 'quantity',
      quantity: { value: '100', unit: 'uL' },
    });
    expect(run('1.5 mg/mL * 2', 'ug/mL')).toEqual({
      type: 'quantity',
      quantity: { value: '3000', unit: 'ug/mL' },
    });
    expect(run('2 h + 30 min', 'min')).toEqual({
      type: 'quantity',
      quantity: { value: '150', unit: 'min' },
    });
    expect(run('0.5 OD600 * 2')).toEqual({
      type: 'quantity',
      quantity: { value: '1', unit: 'OD600' },
    });
  });

  it('rounds to a step and a whole number', () => {
    expect(run('roundup(n_samples * replicates * well_volume * 1.1, 0.5 mL)', 'mL')).toEqual({
      type: 'quantity',
      quantity: { value: '9', unit: 'mL' },
    });
    expect(run('rounddown(well_volume * 1.37, 10 uL)')).toEqual({
      type: 'quantity',
      quantity: { value: '130', unit: 'uL' },
    });
    expect(run('ceil(n_samples / 12)')).toEqual({ type: 'number', value: '4' });
    expect(run('floor(n_samples / 12)')).toEqual({ type: 'number', value: '3' });
    expect(run('round(2.5)')).toEqual({ type: 'number', value: '3' });
  });

  it('sums, counts and compares lists and values', () => {
    expect(run('sum(standards)')).toEqual({
      type: 'quantity',
      quantity: { value: '175', unit: 'uL' },
    });
    expect(run('count(standards) * replicates')).toEqual({ type: 'number', value: '6' });
    expect(run('max(standards, plate.dead_volume)')).toEqual({
      type: 'quantity',
      quantity: { value: '100', unit: 'uL' },
    });
    expect(run('min(1 mL, 900 uL)')).toEqual({
      type: 'quantity',
      quantity: { value: '900', unit: 'uL' },
    });
    expect(run('-well_volume + 1 mL', 'uL')).toEqual({
      type: 'quantity',
      quantity: { value: '900', unit: 'uL' },
    });
  });

  it('keeps a temperature as it is but refuses arithmetic on °C', () => {
    expect(run('incubator')).toEqual({
      type: 'quantity',
      quantity: { value: '37', unit: 'degC' },
    });
    expect(run('max(incubator, 25 °C)')).toEqual({
      type: 'quantity',
      quantity: { value: '37', unit: 'degC' },
    });
    expect(() => run('incubator + 2 degC')).toThrow(/°C can't be used/);
  });

  it('refuses mixing kinds of quantity and says what is wrong', () => {
    expect(() => run('well_volume + 5 min')).toThrow("Can't add time to volume");
    expect(() => run('well_volume * dead_volume')).toThrow(/volume\^2, which has no unit/);
    expect(() => run('well_volume', 'min')).toThrow('The result is volume, not time (min)');
    expect(() => run('ceil(well_volume)')).toThrow(/use roundup/);
    expect(() => run('standards * 2')).toThrow(/is a list/);
    expect(() => run('unknown_thing * 2')).toThrow('unknown_thing has no value');
    expect(() => run('well_volume / (2 - 2)')).toThrow('Division by zero');
    expect(() => run('average(standards)')).toThrow(/no function "average"/);
  });

  it('reports syntax errors with their place', () => {
    expect(() => parseExpression('')).toThrow('The expression is empty');
    expect(() => parseExpression('2 +')).toThrow('The expression ends too early');
    expect(() => parseExpression('(2 + 3')).toThrow('Expected ")" at the end');
    expect(() => parseExpression('2 minutes')).toThrow(/"minutes" is not a unit/);
    expect(() => parseExpression('2 $ 3')).toThrow('"$" is not part of an expression');
    try {
      parseExpression('n * * 2');
    } catch (error) {
      expect((error as { at?: number }).at).toBe(4);
    }
  });
});

describe('variablesOf', () => {
  it('lists the variables a formula reads, once each, dotted names whole', () => {
    expect(variablesOf('max(a, plate.dead_volume) + a * 2 uL + sum(list)')).toEqual([
      'a',
      'plate.dead_volume',
      'list',
    ]);
  });
});

describe('evaluateVariables', () => {
  it('evaluates formulas in dependency order, whatever order they are written in', () => {
    const out = evaluateVariables([
      { name: 'total', expression: 'per_plate * plates + dead_volume', unit: 'mL' },
      { name: 'per_plate', expression: 'wells * well_volume' },
      { name: 'wells', value: '96' },
      { name: 'well_volume', value: { value: '100', unit: 'uL' } },
      { name: 'plates', value: '3' },
      { name: 'dead_volume', value: { value: '5', unit: 'mL' } },
    ]);
    expect(out.get('per_plate')).toMatchObject({
      ok: true,
      result: { type: 'quantity', quantity: { value: '9600', unit: 'uL' } },
    });
    expect(out.get('total')).toMatchObject({
      ok: true,
      result: { type: 'quantity', quantity: { value: '33.8', unit: 'mL' } },
    });
  });

  it('names what a formula waits for and finds circles', () => {
    const out = evaluateVariables([
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: 'a + 1' },
      { name: 'c', expression: 'lot_conc * 2' },
      { name: 'lot_conc' },
      { name: 'd', expression: '2 +' },
      { name: 'e', value: '3' },
    ]);
    expect(out.get('a')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/circle: a → b → a/),
    });
    expect(out.get('c')).toMatchObject({
      ok: false,
      error: 'Waits for lot_conc',
      waitsOn: ['lot_conc'],
    });
    expect(out.get('lot_conc')).toMatchObject({ ok: false, error: 'lot_conc has no value yet' });
    expect(out.get('d')).toMatchObject({ ok: false, error: 'The expression ends too early' });
    expect(out.get('e')).toMatchObject({ ok: true, result: { type: 'number', value: '3' } });
  });

  it("treats a name that isn't a variable as a mistake, not an input still to come", () => {
    const out = evaluateVariables([
      { name: 'volume', expression: 'missing_typo * 100 uL' },
      { name: 'total', expression: 'volume * 2' },
    ]);
    expect(out.get('volume')).toEqual({
      name: 'volume',
      ok: false,
      error: "Uses missing_typo, which isn't a declared variable",
    });
    expect(out.get('total')).toMatchObject({ ok: false, waitsOn: ['volume'] });
  });
});

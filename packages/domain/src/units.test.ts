import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  convert,
  formatQuantity,
  getUnit,
  listUnits,
  massToMolar,
  molarToMass,
  multiply,
  quantity,
  subtract,
  UnitError,
} from './units.ts';

const q = quantity;

describe('conversions within each family', () => {
  it.each([
    [q('1', 'mL'), 'uL', '1000'],
    [q('250', 'nL'), 'uL', '0.25'],
    [q('2.5', 'pL'), 'nL', '0.0025'],
    [q('1', 'mg'), 'ug', '1000'],
    [q('10', 'nmol'), 'umol', '0.01'],
    [q('50', 'uM'), 'nM', '50000'],
    [q('1', 'mg/mL'), 'g/L', '1'],
    [q('1', 'ng/uL'), 'ug/mL', '1'],
    [q('500', 'pg/mL'), 'ng/mL', '0.5'],
    [q('66.5', 'kDa'), 'g/mol', '66500'],
    [q('90', 'min'), 'h', '1.5'],
    [q('2', 'd'), 'h', '48'],
    [q('37', 'degC'), 'K', '310.15'],
    [q('4', 'K'), 'degC', '-269.15'],
    [q('1000000', 'cells/mL'), 'cells/uL', '1000'],
    [q('10', 'U/uL'), 'U/mL', '10000'],
    [q('1', 'kU'), 'U', '1000'],
    [q('2000', 'CFU/mL'), 'CFU/uL', '2'],
    [q('0.6', 'OD600'), 'OD600', '0.6'],
    [q('5', '%v/v'), '%v/v', '5'],
  ])('%o → %s', (from, unit, expected) => {
    expect(convert(from, unit)).toEqual({ value: expected, unit });
  });

  it('round-trips without drift', () => {
    const start = q('12.345', 'uL');
    expect(convert(convert(convert(start, 'pL'), 'L'), 'uL')).toEqual(start);
  });
});

describe('refused conversions', () => {
  it.each([
    [q('1', 'uL'), 'ug'],
    [q('1', 'mg/mL'), 'mM'],
    [q('1', 'OD600'), 'OD450'],
    [q('1', '%v/v'), '%w/v'],
    [q('1', 'cells'), 'cells/mL'],
    [q('1', 'CFU'), 'cells'],
  ])('%o → %s', (from, unit) => {
    expect(() => convert(from, unit)).toThrow(UnitError);
  });

  it('rejects unknown units and non-decimal values', () => {
    expect(() => getUnit('ul')).toThrow(/Unknown unit "ul"/);
    expect(() => quantity('1e3', 'uL')).toThrow(UnitError);
    expect(() => quantity('5', 'µL')).toThrow(UnitError);
  });
});

describe('exact arithmetic', () => {
  it('50 µL minus ten 5 µL dispenses is exactly 0', () => {
    let remaining = q('50', 'uL');
    for (let i = 0; i < 10; i++) remaining = subtract(remaining, q('5', 'uL'));
    expect(remaining).toEqual({ value: '0', unit: 'uL' });
  });

  it('0.1 + 0.2 is 0.3', () => {
    expect(add(q('0.1', 'uL'), q('0.2', 'uL'))).toEqual({ value: '0.3', unit: 'uL' });
  });

  it('adds across units in the first unit', () => {
    expect(add(q('1', 'mL'), q('250', 'uL'))).toEqual({ value: '1.25', unit: 'mL' });
    expect(subtract(q('1', 'h'), q('15', 'min'))).toEqual({ value: '0.75', unit: 'h' });
  });

  it('refuses adding temperatures', () => {
    expect(() => add(q('20', 'degC'), q('5', 'degC'))).toThrow(UnitError);
  });

  it('multiplies by a decimal factor', () => {
    expect(multiply(q('12.5', 'uL'), '96')).toEqual({ value: '1200', unit: 'uL' });
  });

  it('compares across units', () => {
    expect(compare(q('1', 'mL'), q('999', 'uL'))).toBe(1);
    expect(compare(q('1', 'mL'), q('1000', 'uL'))).toBe(0);
    expect(compare(q('30', 'min'), q('1', 'h'))).toBe(-1);
  });
});

describe('mass and molar concentration', () => {
  it('converts with a molar mass', () => {
    // BSA ~66.5 kDa at 1 mg/mL ≈ 15.04 µM
    const molar = massToMolar(q('1', 'mg/mL'), q('66.5', 'kDa'), 'uM');
    expect(Number(molar.value)).toBeCloseTo(15.0376, 4);
    expect(molarToMass(q('10', 'mM'), q('58.44', 'g/mol'), 'mg/mL')).toEqual({
      value: '0.5844',
      unit: 'mg/mL',
    });
  });

  it('requires the right dimensions', () => {
    expect(() => massToMolar(q('1', 'uL'), q('1', 'g/mol'))).toThrow(UnitError);
    expect(() => molarToMass(q('1', 'mM'), q('1', 'g'))).toThrow(UnitError);
  });
});

describe('registry', () => {
  it('has unique codes and display symbols', () => {
    const codes = listUnits().map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(formatQuantity(q('5', 'uL'))).toBe('5 µL');
    expect(formatQuantity(q('37', 'degC'))).toBe('37 °C');
  });
});

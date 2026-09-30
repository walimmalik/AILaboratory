import { describe, expect, it } from 'vitest';
import {
  closest,
  nameFor,
  readSetting,
  suggest,
  toReadable,
  toStored,
  typingAt,
  wordsToReadable,
  wordsToStored,
} from './formulas.ts';

const values = [
  { name: 'well_volume', label: 'Well volume' },
  { name: 'wells', label: 'Number of wells' },
  { name: 'stock_conc', label: 'Stock concentration' },
  { name: 'mL', label: 'Odd name' },
];

describe('formulas in lab words', () => {
  it('shows names as lab names, keeping units and functions', () => {
    expect(toReadable('roundup(wells * well_volume * 1.1, 0.5 mL) / 2', values)).toBe(
      'roundup([Number of wells] × [Well volume] × 1.1, 0.5 mL) ÷ 2',
    );
  });

  it('stores lab names as names, and reads back the same', () => {
    const readable = '[Number of wells] × [well volume] × 1.1 − 10 uL';
    expect(toStored(readable, values)).toEqual({
      ok: true,
      expression: 'wells * well_volume * 1.1 - 10 uL',
    });
    const stored = 'roundup(wells * well_volume, 0.5 mL)';
    const back = toStored(toReadable(stored, values), values);
    expect(back).toEqual({ ok: true, expression: stored });
  });

  it('accepts names as agents write them', () => {
    expect(toStored('wells * well_volume', values)).toEqual({
      ok: true,
      expression: 'wells * well_volume',
    });
  });

  it('says which value it means for a mistyped one', () => {
    expect(toStored('[Well vol] × 2', values)).toMatchObject({
      ok: false,
      problem: 'There is no value "Well vol". Did you mean [Well volume]?',
      wrong: '[Well vol]',
    });
    expect(toStored('well_volme * 2', values)).toMatchObject({
      ok: false,
      suggestion: { name: 'well_volume' },
    });
    expect(toStored('[number of plates] × 2', values)).toMatchObject({ ok: false });
  });

  it('explains formulas the calculator cannot read', () => {
    expect(toStored('[Well volume] ×', values)).toMatchObject({ ok: false });
    expect(toStored('[Well volume', values)).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/bracket/),
    });
  });

  it('suggests values as they are typed', () => {
    expect(suggest('well vol', values).map((v) => v.name)).toEqual(['well_volume']);
    expect(suggest('wells', values)[0]?.name).toBe('wells');
    expect(closest('stok concentration', values)?.name).toBe('stock_conc');
    expect(closest('temperature', values)).toBeUndefined();
  });

  it('finds what is being typed at the caret', () => {
    expect(typingAt('[Well vo', 8)).toEqual({ from: 0, typed: 'Well vo' });
    expect(typingAt('2 × wel', 7)).toEqual({ from: 4, typed: 'wel' });
    expect(typingAt('0.5 mL', 6)).toBeUndefined();
    expect(typingAt('[Well volume] × 2', 17)).toBeUndefined();
  });

  it('makes names from lab names', () => {
    expect(nameFor('Well volume (µL)')).toBe('well_volume_ul');
    expect(nameFor('Well volume', new Set(['well_volume']))).toBe('well_volume_2');
    expect(nameFor('96 wells')).toBe('v_96_wells');
  });

  it('shows the names in the words of a step as lab names, and stores them back', () => {
    const stored = 'Add `well_volume` per well to `plate`, then `other`. [optional]';
    const named = [...values, { name: 'plate', label: 'Coating plate' }];
    const readable = wordsToReadable(stored, named);
    expect(readable).toBe(
      'Add [Well volume] per well to [Coating plate], then `other`. [optional]',
    );
    expect(wordsToStored(readable, named)).toBe(stored);
  });

  it('reads a step setting as a value, a number, a quantity or words', () => {
    expect(readSetting('[Well volume]', values)).toEqual({
      ok: true,
      value: { variable: 'well_volume' },
    });
    expect(readSetting('well volume', values)).toEqual({
      ok: true,
      value: { variable: 'well_volume' },
    });
    expect(readSetting('3', values)).toEqual({ ok: true, value: { number: '3' } });
    expect(readSetting('50 µL', values)).toEqual({
      ok: true,
      value: { quantity: { value: '50', unit: 'uL' } },
    });
    expect(readSetting('room temperature', values)).toEqual({
      ok: true,
      value: { text: 'room temperature' },
    });
    expect(readSetting('3 times', values)).toEqual({ ok: true, value: { text: '3 times' } });
    expect(readSetting('[Plate count]', values)).toMatchObject({ ok: false });
    expect(readSetting('', values)).toEqual({ ok: true, value: undefined });
  });
});

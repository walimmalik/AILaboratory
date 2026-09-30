import { describe, expect, it } from 'vitest';
import { closest, nameFor, readSetting, suggest } from './formulas.ts';

const values = [
  { name: 'well_volume', label: 'Well volume' },
  { name: 'wells', label: 'Number of wells' },
  { name: 'stock_conc', label: 'Stock concentration' },
  { name: 'mL', label: 'Odd name' },
];

describe('values in lab words', () => {
  it('suggests values as they are typed', () => {
    expect(suggest('well vol', values).map((v) => v.name)).toEqual(['well_volume']);
    expect(suggest('wells', values)[0]?.name).toBe('wells');
    expect(closest('stok concentration', values)?.name).toBe('stock_conc');
    expect(closest('temperature', values)).toBeUndefined();
  });

  it('makes names from lab names', () => {
    expect(nameFor('Well volume (µL)')).toBe('well_volume_ul');
    expect(nameFor('Well volume', new Set(['well_volume']))).toBe('well_volume_2');
    expect(nameFor('96 wells')).toBe('v_96_wells');
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

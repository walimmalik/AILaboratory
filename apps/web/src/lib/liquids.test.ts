import type { LiquidClassAttributes, RecordEnvelope } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { cellWords, classMatrix, type MatrixClass, volumeWords } from './liquids.ts';

const cls = (
  label: string,
  status: 'draft' | 'active',
  attributes: Partial<LiquidClassAttributes>,
  verified = false,
): MatrixClass => ({
  record: { id: `lqc_${label}`, label, status } as RecordEnvelope,
  attributes: {
    instrumentKind: 'ink_star',
    liquidTypes: ['lqt_water'],
    labDefault: true,
    origin: 'vendor_default',
    settings: { platform: 'echo', calibration: 'x' },
    ...attributes,
  } as LiquidClassAttributes,
  verified,
});

const names: Record<string, string> = {
  ink_star: 'STAR',
  ink_echo: 'Echo 650',
  eqk_1ml: '1 mL channel',
  lwt_pp: '384PP',
};

describe('classMatrix', () => {
  it('puts classes on device rows and liquid type columns', () => {
    const rows = classMatrix(
      [
        cls('Water jet', 'active', { device: 'eqk_1ml' }, true),
        cls('Water surface', 'draft', { device: 'eqk_1ml' }),
        cls('Glycerol', 'draft', { device: 'eqk_1ml', liquidTypes: ['lqt_glycerol'] }),
        cls('DMSO', 'active', {
          instrumentKind: 'ink_echo',
          sourceLabware: 'lwt_pp',
          liquidTypes: ['lqt_dmso'],
          labDefault: false,
        }),
        cls('Unknown type', 'active', { device: 'eqk_1ml', liquidTypes: ['lqt_other'] }),
      ],
      ['lqt_water', 'lqt_glycerol', 'lqt_dmso'],
      (id) => names[id] ?? id,
    );
    expect(rows.map((r) => r.label)).toEqual(['Echo 650 · 384PP', 'STAR · 1 mL channel']);
    const star = rows[1];
    expect(star?.cells.get('lqt_water')).toMatchObject({
      confirmed: 1,
      verified: 1,
      hasDefault: true,
    });
    expect(star?.cells.get('lqt_water')?.classes.map((c) => c.record.label)).toEqual([
      'Water jet',
      'Water surface',
    ]);
    expect(cellWords(star?.cells.get('lqt_water'))).toEqual({ text: '2 classes, 1 verified' });
    expect(cellWords(star?.cells.get('lqt_glycerol'))).toEqual({ text: '1 draft', tone: 'agent' });
    expect(cellWords(star?.cells.get('lqt_dmso'))).toEqual({ text: '—', tone: 'muted' });
    expect(cellWords(rows[0]?.cells.get('lqt_dmso'))).toEqual({
      text: '1 class, no default',
      tone: 'agent',
    });
  });
});

describe('volumeWords', () => {
  it('says the range', () => {
    expect(volumeWords({ min: { value: '5', unit: 'uL' }, max: { value: '50', unit: 'uL' } })).toBe(
      '5 µL to 50 µL',
    );
    expect(volumeWords({ min: { value: '2.5', unit: 'nL' } })).toBe('from 2.5 nL');
    expect(volumeWords(undefined)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import {
  fieldPath,
  fieldWords,
  formulaOf,
  formulaText,
  kindWords,
  picksAt,
  plainValue,
  readValue,
  readWords,
  sopTerms,
  tokenize,
  valueText,
  withWords,
  wordsStored,
  wordsText,
} from './sop-text.ts';

const doc = {
  variables: [
    { name: 'wells', label: 'Wells', kind: 'default' as const, value: '96' },
    {
      name: 'well_volume',
      label: 'Well volume',
      kind: 'default' as const,
      value: { value: '100', unit: 'uL' },
    },
    { name: 'wells_per_plate', label: 'Wells per plate', kind: 'default' as const, value: '96' },
    {
      name: 'coating',
      label: 'Coating solution',
      kind: 'computed' as const,
      expression: 'wells * well_volume * 1.1',
      unit: 'mL',
    },
    {
      name: 'capture_conc',
      label: 'Capture antibody conc',
      kind: 'record' as const,
      readFrom: { role: 'capture_ab', field: 'workingConcentration' },
    },
  ],
  materials: [
    { role: 'plate', label: 'Coating plate', type: 'labware' as const },
    { role: 'capture_ab', label: 'Capture antibody', type: 'reagent' as const },
  ],
  solutions: [{ role: 'wash_buffer', label: 'Wash buffer' }],
};
const terms = sopTerms(doc);
const types = (text: string, mode: 'formula' | 'words' = 'formula') =>
  tokenize(text, terms, mode)
    .filter((t) => t.type !== 'space')
    .map((t) => `${t.type}:${t.text}`);

describe('reading names out of text', () => {
  it('finds values and materials by lab name without brackets, longest first', () => {
    expect(types('Wells per plate × wells × Well volume')).toEqual([
      'value:Wells per plate',
      'op:×',
      'value:wells',
      'op:×',
      'value:Well volume',
    ]);
    expect(types('roundup([Well volume] * 1.1, 0.5 mL)')).toEqual([
      'fn:roundup',
      'op:(',
      'value:[Well volume]',
      'op:*',
      'number:1.1',
      'op:,',
      'number:0.5 mL',
      'op:)',
    ]);
  });

  it("reads a material's field and marks what names nothing", () => {
    expect(types('Capture antibody.working concentration')).toEqual([
      'material:Capture antibody.working concentration',
    ]);
    const [unknown] = tokenize('Well vol × 2', terms, 'formula');
    expect(unknown).toMatchObject({
      type: 'unknown',
      text: 'Well vol',
      suggestion: { name: 'well_volume' },
    });
  });

  it('reads technical names as agents write them', () => {
    expect(types('wells_per_plate * well_volume')).toEqual([
      'value:wells_per_plate',
      'op:*',
      'value:well_volume',
    ]);
  });

  it('in step words, matches names as written and leaves a sentence alone', () => {
    expect(
      types('Add Well volume to all wells of the Coating plate. Wash 3 times.', 'words'),
    ).toEqual([
      'text:Add',
      'value:Well volume',
      'text:to',
      'text:all',
      'text:wells',
      'text:of',
      'text:the',
      'material:Coating plate',
      'text:.',
      'text:Wash',
      'number:3',
      'text:times.',
    ]);
  });
});

describe('formulas', () => {
  it('stores lab names as technical names and shows them back', () => {
    expect(formulaOf('Wells × Well volume × 1.1 − 10 µL', terms)).toEqual({
      ok: true,
      value: 'wells * well_volume * 1.1 - 10 uL',
    });
    const stored = 'roundup(wells * well_volume / 2, 0.5 mL)';
    expect(formulaText(stored, terms)).toBe('roundup(Wells × Well volume ÷ 2, 0.5 mL)');
    expect(formulaOf(formulaText(stored, terms), terms)).toEqual({ ok: true, value: stored });
    expect(formulaText('conc * 2 ug/mL', terms)).toBe('conc × 2 µg/mL');
  });

  it('says what is wrong, with a fix for a mistyped name', () => {
    expect(formulaOf('Wells × Well vol', terms)).toEqual({
      ok: false,
      problem: 'There is no value or material "Well vol". Did you mean Well volume?',
      fix: { from: 8, to: 16, text: 'Well volume' },
    });
    expect(formulaOf('Wells ×', terms)).toMatchObject({ ok: false });
    expect(formulaOf('Wells × Coating plate.dead volume', terms)).toMatchObject({
      ok: false,
      problem: expect.stringContaining('as a value of its own'),
    });
  });
});

describe("a value's kind comes from its text", () => {
  it('reads numbers, formulas and material fields', () => {
    expect(readValue('100 µL', terms, false)).toEqual({
      ok: true,
      value: { kind: 'default', value: { value: '100', unit: 'uL' } },
    });
    expect(readValue('8', terms, true)).toEqual({ ok: true, value: { kind: 'input', value: '8' } });
    expect(readValue('1, 2, 4', terms, false)).toEqual({
      ok: true,
      value: { kind: 'default', value: ['1', '2', '4'] },
    });
    expect(readValue('Wells × 2', terms, false)).toEqual({
      ok: true,
      value: { kind: 'computed', expression: 'wells * 2' },
    });
    expect(readValue('Coating plate.dead volume', terms, false)).toEqual({
      ok: true,
      value: { kind: 'record', readFrom: { role: 'plate', field: 'deadVolume' } },
    });
    expect(readValue('', terms, false)).toEqual({ ok: true, value: { kind: 'default' } });
  });

  it('shows each kind back as text and in words', () => {
    const [wells, volume, , coating, capture] = doc.variables;
    expect(valueText(volume ?? {}, terms)).toBe('100 µL');
    expect(valueText(coating ?? {}, terms)).toBe('Wells × Well volume × 1.1');
    expect(valueText(capture ?? {}, terms)).toBe('Capture antibody.working concentration');
    expect(kindWords(wells ?? {}, terms)).toBe('usual value');
    expect(kindWords(capture ?? {}, terms)).toBe('read from Capture antibody');
    expect(plainValue('50 minutes')).toBeUndefined();
  });

  it('turns field paths into words and back', () => {
    expect(fieldWords('workingVolume.max')).toBe('working volume.max');
    expect(fieldPath('working volume.max')).toBe('workingVolume.max');
  });
});

describe('step words', () => {
  it('stores names and shows lab names', () => {
    const stored = wordsStored('Add Well volume to the Coating plate.', terms);
    expect(stored).toBe('Add `well_volume` to the `plate`.');
    expect(wordsText(stored, terms)).toBe('Add Well volume to the Coating plate.');
    expect(wordsText('Add `nothing` here', terms)).toBe('Add `nothing` here');
  });

  it('reads what a step uses and the settings it states', () => {
    const read = readWords(
      'Add Well volume of Wash buffer to the Coating plate. Incubate 2 h at room temperature.',
      terms,
    );
    expect(read.uses).toEqual(['wash_buffer', 'plate']);
    expect(Object.fromEntries(read.settings)).toEqual({
      volume: { variable: 'well_volume' },
      duration: { quantity: { value: '2', unit: 'h' } },
      temperature: { text: 'room temperature' },
    });
    expect(readWords('Add 100 µL, then 50 µL.', terms).settings.has('volume')).toBe(false);
  });

  it('keeps what the words never stated when they change', () => {
    const step = {
      text: 'Add `well_volume` to the `plate`.',
      uses: ['plate', 'capture_ab'],
      parameters: [
        { name: 'volume', variable: 'well_volume' },
        { name: 'speed', quantity: { value: '300', unit: 'rpm' } },
      ],
    };
    expect(withWords(step, 'Add 50 µL of Wash buffer.', terms)).toEqual({
      text: 'Add 50 µL of `wash_buffer`.',
      uses: ['wash_buffer', 'capture_ab'],
      parameters: [
        { name: 'speed', quantity: { value: '300', unit: 'rpm' } },
        { name: 'volume', quantity: { value: '50', unit: 'uL' } },
      ],
    });
  });
});

describe('picks as you type', () => {
  it('offers values, materials and functions for the words before the caret', () => {
    const text = 'Wells × well v';
    expect(picksAt(text, text.length, terms, 'formula')).toEqual({
      from: 8,
      picks: [{ label: 'Well volume', what: 'value', insert: 'Well volume' }],
    });
    expect(picksAt('rou', 3, terms, 'formula')?.picks.map((p) => p.insert)).toEqual([
      'roundup(',
      'rounddown(',
      'round(',
    ]);
    expect(picksAt('Coat', 4, terms, 'formula')?.picks).toEqual([
      { label: 'Coating solution', what: 'value', insert: 'Coating solution' },
      { label: 'Coating plate', what: 'material', insert: 'Coating plate.' },
    ]);
  });

  it("offers a material's fields after its name and a dot", () => {
    const text = 'Coating plate.de';
    expect(picksAt(text, text.length, terms, 'formula')).toEqual({
      from: 14,
      picks: [{ label: 'dead volume', what: 'field', insert: 'dead volume' }],
    });
  });

  it('in step words, waits for a few letters', () => {
    expect(picksAt('Add We', 6, terms, 'words')).toBeUndefined();
    expect(picksAt('Add Wel', 7, terms, 'words')?.picks.map((p) => p.label)).toEqual([
      'Wells',
      'Well volume',
      'Wells per plate',
    ]);
  });
});

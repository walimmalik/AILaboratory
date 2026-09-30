import type { MountDefinition } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { deckView, limitWords } from './instruments.ts';

describe('limitWords', () => {
  it('says limits in plain words', () => {
    expect(
      limitWords({
        volume: { min: { value: '5', unit: 'uL' }, max: { value: '1000', unit: 'uL' } },
        channels: [1, 8],
      }),
    ).toBe('5 µL to 1000 µL · 1 or 8 channels');
    expect(limitWords({ channels: [1] })).toBe('1 channel');
    expect(
      limitWords({
        temperature: {
          minAboveAmbient: { value: '1.5', unit: 'degC' },
          max: { value: '95', unit: 'degC' },
        },
      }),
    ).toBe('1.5 °C above room temperature to 95 °C');
    expect(
      limitWords({
        wavelengths: {
          fixed: [
            { value: '450', unit: 'nm' },
            { value: '600', unit: 'nm' },
          ],
        },
        wellCounts: [96],
      }),
    ).toBe('at 450 nm or 600 nm · 96-well plates');
    expect(limitWords(undefined)).toBe('');
  });
});

describe('deckView', () => {
  it('lays slots like A1 to D3 out as a grid with what is on them', () => {
    const deck: MountDefinition = {
      id: 'deck',
      label: 'deck',
      layout: { layout: 'slots', slots: ['A1', 'A2', 'B1', 'B2'] },
      accepts: ['m'],
      changedBy: 'operator',
    };
    const view = deckView(deck, [
      { node: 'tc', parent: 'instrument', mount: 'deck', slots: ['B1', 'A1'] },
    ]);
    expect([view.rows, view.columns]).toEqual([2, 2]);
    expect(view.cells.map((c) => [c.place, c.row, c.column, c.node])).toEqual([
      ['A1', 0, 0, 'tc'],
      ['A2', 0, 1, undefined],
      ['B1', 1, 0, 'tc'],
      ['B2', 1, 1, undefined],
    ]);
  });

  it('draws a rail as runs of tracks', () => {
    const rail: MountDefinition = {
      id: 'tracks',
      label: 'deck tracks',
      layout: { layout: 'rail', tracks: 20 },
      accepts: ['t'],
      changedBy: 'operator',
    };
    const view = deckView(rail, [
      { node: 'c2', parent: 'instrument', mount: 'tracks', tracks: { from: 7, to: 12 } },
      { node: 'c1', parent: 'instrument', mount: 'tracks', tracks: { from: 1, to: 6 } },
    ]);
    expect(view.cells.map((c) => [c.place, c.column, c.span, c.node])).toEqual([
      ['1–6', 0, 6, 'c1'],
      ['7–12', 6, 6, 'c2'],
      ['13–20', 12, 8, undefined],
    ]);
  });
});

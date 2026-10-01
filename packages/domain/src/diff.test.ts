import { describe, expect, it } from 'vitest';
import { diffValues } from './diff.ts';

describe('diffValues', () => {
  it('names each changed value by its path, quantities as one value', () => {
    expect(
      diffValues(
        { color: 'teal', volume: { value: '50', unit: 'uL' }, same: 1 },
        { color: 'red', volume: { value: '60', unit: 'uL' }, same: 1, note: 'new' },
      ),
    ).toEqual([
      { path: '/color', change: 'changed', before: 'teal', after: 'red' },
      {
        path: '/volume',
        change: 'changed',
        before: { value: '50', unit: 'uL' },
        after: { value: '60', unit: 'uL' },
      },
      { path: '/note', change: 'added', after: 'new' },
    ]);
  });

  it('follows keyed list items by key, so reordering changes nothing', () => {
    const coat = { id: 'coat', text: 'Coat', minutes: 60 };
    const wash = { id: 'wash', text: 'Wash', minutes: 5 };
    expect(diffValues({ steps: [coat, wash] }, { steps: [wash, coat] }, { steps: 'id' })).toEqual(
      [],
    );
    expect(
      diffValues(
        { steps: [coat, wash] },
        {
          steps: [
            { ...coat, minutes: 90 },
            { id: 'block', text: 'Block' },
          ],
        },
        { steps: 'id' },
      ),
    ).toEqual([
      { path: '/steps/coat/minutes', change: 'changed', before: 60, after: 90 },
      { path: '/steps/wash', change: 'removed', before: wash },
      { path: '/steps/block', change: 'added', after: { id: 'block', text: 'Block' } },
    ]);
  });

  it('treats other lists as one value', () => {
    expect(diffValues({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual([
      { path: '/tags', change: 'changed', before: ['a'], after: ['a', 'b'] },
    ]);
  });
});

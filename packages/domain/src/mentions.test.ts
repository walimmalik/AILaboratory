import { describe, expect, it } from 'vitest';
import { matchMentions } from './mentions.ts';

const candidates = [
  {
    recordId: 'prd_duoset',
    terms: [
      { text: 'Human IL-6 DuoSet ELISA', how: 'name' as const },
      { text: 'DY206', how: 'catalog_number' as const },
    ],
  },
  { recordId: 'lwt_3570', terms: [{ text: 'Corning 3570', how: 'name' as const }] },
  {
    recordId: 'ent_hek',
    terms: [
      { text: 'HEK293', how: 'name' as const },
      { text: 'HEK-293', how: 'synonym' as const },
    ],
  },
  { recordId: 'prd_pbs', terms: [{ text: 'PBS', how: 'name' as const }] },
];

describe('matchMentions', () => {
  it('finds catalog numbers and names at word boundaries, case-insensitively', () => {
    const found = matchMentions(
      [
        { id: 'p1', text: 'Use the human il-6 duoset elisa (DY206-05) on a corning  3570 plate.' },
        { id: 'p2', text: 'DY2060 is another kit; seed HEK 293 cells.' },
      ],
      candidates,
    );
    expect(found.map((m) => [m.passageId, m.recordId, m.how, m.text])).toEqual([
      ['p1', 'prd_duoset', 'catalog_number', 'DY206'],
      ['p1', 'lwt_3570', 'name', 'corning  3570'],
      ['p2', 'ent_hek', 'synonym', 'HEK 293'],
    ]);
  });

  it('ignores names too short to be telling', () => {
    expect(matchMentions([{ id: 'p', text: 'Wash in PBS.' }], candidates)).toEqual([]);
  });

  it('reads regular expression characters in a name literally', () => {
    const found = matchMentions(
      [{ id: 'p', text: 'Add Tween (0.05%) wash buffer, not Tween 0.05 wash buffer.' }],
      [{ recordId: 'prd_tween', terms: [{ text: 'Tween (0.05%) wash buffer', how: 'name' }] }],
    );
    expect(found.map((m) => m.text)).toEqual(['Tween (0.05%) wash buffer']);
  });
});

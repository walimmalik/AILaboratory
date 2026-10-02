import { describe, expect, it } from 'vitest';
import { groupMemories, memoryLine, placeOf, type ShownMemory } from './memory.ts';

const memory = (
  id: string,
  attributes: Record<string, unknown>,
  about: { id: string; kind: string; label: string }[] = [],
  extra: Partial<ShownMemory> = {},
) =>
  ({
    id,
    name: id.toUpperCase(),
    label: String(attributes.statement),
    kind: 'memory',
    status: 'active',
    attributes: { kind: 'quirk', strength: 'note', appliesTo: { to: 'lab' }, ...attributes },
    due: false,
    aboutRecords: about.map((a) => ({ ...a, name: a.id.toUpperCase() })),
    ...extra,
  }) as unknown as ShownMemory;

const star = { id: 'ink_star', kind: 'instrument_kind', label: 'Hamilton STAR' };
const unit = { id: 'ins_1', kind: 'instrument', label: 'STAR 1' };
const elisa = { id: 'sop_1', kind: 'sop', label: 'IL-6 ELISA' };

describe('lab memory groups', () => {
  it('files a memory under its most specific link, by kind', () => {
    expect(placeOf(memory('a', { statement: 'x' }, [elisa, unit, star]))).toEqual({
      group: 'Instruments',
      under: { ...unit, name: 'INS_1' },
    });
    expect(placeOf(memory('b', { statement: 'x' })).group).toBe('Lab-wide');
    expect(
      placeOf(memory('c', { statement: 'x', appliesTo: { to: 'person', user: 'u' } }, [star]))
        .group,
    ).toBe('People');
  });

  it('orders groups as the page does, records by label, rules first, and hides empty groups', () => {
    const groups = groupMemories([
      memory('n', { statement: 'note on STAR' }, [star]),
      memory('r', { statement: 'rule on STAR', strength: 'rule' }, [star]),
      memory('l', { statement: 'lab wide' }),
      memory('s', { statement: 'ELISA' }, [elisa]),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Lab-wide', 'Assays and SOPs', 'Instruments']);
    expect(groups[2]?.records[0]?.memories.map((m) => m.id)).toEqual(['r', 'n']);
  });

  it('says strength, kind, evidence, when and due in one line', () => {
    expect(
      memoryLine(
        memory('a', { statement: 'x', strength: 'rule', when: 'below 5 uL' }, [], {
          due: true,
          seen: { for: 7, against: 1, quiet: 0, weight: 6, line: 'seen in 7 runs, 1 against' },
        }),
      ),
    ).toBe('Rule · quirk · seen in 7 runs, 1 against · when below 5 uL · due for a check');
  });
});

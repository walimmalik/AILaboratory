import type { MemoryAttributes } from '@ailab/schema';
import { day, facts, type OverviewBuilder, parts } from '../records/overview.ts';

/** The same words as the Lab memory page: "Rule", "Default", "Note" (UX review 2026-10-02, #9). */
const STRENGTH = { rule: 'Rule', default: 'Default', note: 'Note' } as const;

/** "A, B and C". */
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * A lab memory reads first as what it is and what it covers. The statement is the page title, so it
 * is not repeated as a fact.
 */
const memory: OverviewBuilder = async (record, read) => {
  const a = record.attributes as MemoryAttributes;
  const about = (await Promise.all((a.about ?? []).map((id) => read.get(id)))).flatMap((r) =>
    r ? [r] : [],
  );
  const replacedBy = await read.get(a.retired?.replacedBy);
  return {
    identity: parts('Lab memory', STRENGTH[a.strength], a.kind),
    facts: facts(
      {
        label: 'applies to',
        value: a.appliesTo.to === 'lab' ? 'the whole lab' : 'one person (their own preference)',
        field: 'appliesTo',
      },
      about.length === 1 && about[0]
        ? { label: 'about', value: about[0].label, record: about[0].id, field: 'about' }
        : {
            label: 'about',
            value: about.length ? list(about.map((r) => r.label)) : 'nothing in particular',
            field: 'about',
          },
      a.when && { label: 'when', value: a.when, field: 'when' },
      a.checkAgain && !a.retired && { label: 'check again', value: day(a.checkAgain) },
      a.retired && {
        label: 'retired',
        value: a.retired.why,
        ...(replacedBy ? { detail: `replaced by ${replacedBy.label}`, record: replacedBy.id } : {}),
      },
    ),
  };
};

export const memoryOverviews: Record<string, OverviewBuilder> = { memory };

import { memoryConflicts } from '@ailab/domain';
import {
  defineKind,
  type MemoryAttributes,
  MemoryAttributes as MemorySchema,
  type RelatedContext,
} from '@ailab/schema';

/**
 * A lab memory (plan 005a): a convention, preference, quirk, lesson or fact in plain words, with
 * what it is about and when it applies. An agent's memory is a draft a person confirms; a
 * person's own is active at once (memory.remember). Retired memories are archived with why.
 */

/** Every record a memory names: about, conditions, effect, evidence and its replacement. */
function named(a: MemoryAttributes): { id: string; relation: string }[] {
  const c = a.conditions ?? {};
  const conditions = [
    c.instrumentKind,
    c.instrument,
    c.device,
    c.tip,
    c.labware,
    c.liquidType,
    c.sop,
    c.layout,
  ].flatMap((id) => (id ? [id] : []));
  return [
    ...(a.about ?? []).map((id) => ({ id, relation: 'about' })),
    ...conditions.map((id) => ({ id, relation: 'applies_with' })),
    ...(a.effect && a.effect.effect !== 'set'
      ? [{ id: a.effect.record, relation: a.effect.effect }]
      : []),
    ...(a.effect?.effect === 'set' &&
    typeof a.effect.value === 'string' &&
    /^[a-z]{2,5}_[0-9A-HJKMNP-TV-Z]{26}$/.test(a.effect.value)
      ? [{ id: a.effect.value, relation: 'sets' }]
      : []),
    ...(a.source.evidence ?? []).map((id) => ({ id, relation: 'learned_from' })),
    ...(a.retired?.replacedBy ? [{ id: a.retired.replacedBy, relation: 'replaced_by' }] : []),
  ];
}

export const memory = defineKind({
  kind: 'memory',
  idPrefix: 'mem',
  namePrefix: 'MEM',
  nameWidth: 4,
  attributes: MemorySchema,
  links: (a: MemoryAttributes) => named(a).map(({ id, relation }) => ({ toId: id, relation })),
  sections: [
    {
      id: 'statement',
      title: 'Statement',
      fields: ['statement', 'kind', 'strength', 'appliesTo', 'source', 'checkAgain', 'retired'],
    },
    { id: 'scope', title: 'What and when', fields: ['about', 'when', 'conditions', 'effect'] },
  ],
  // Every named record must exist in the lab (the links check that); a replacement is a memory.
  // Effects that clash with an active memory's at equal specificity block confirming (change 2).
  related: async (a, { get, list, current }: Pick<RelatedContext, 'get' | 'list' | 'current'>) => {
    if (a.retired?.replacedBy && (await get(a.retired.replacedBy))?.kind !== 'memory')
      return { invalid: [`${a.retired.replacedBy} is not a lab memory`] };
    if (!a.effect || a.retired) return {};
    const others = (await list('memory'))
      .filter((r) => r.status === 'active' && r.id !== current?.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        attributes: r.attributes as MemoryAttributes,
        updatedAt: r.updatedAt,
      }));
    const clashes = memoryConflicts(a, others);
    return {
      checks: [
        {
          id: 'no_clashing_memory',
          label: 'No confirmed memory says the opposite for the same work',
          severity: 'blocker',
          source: 'Plan 005, change 2: one effect for the same work',
          section: 'scope',
          passed: clashes.length === 0,
          ...(clashes.length
            ? {
                message: clashes.map((c) => `${c.memory.name}: ${c.why}`).join('; '),
                fix: 'Narrow the conditions, or replace the other memory with this one (memory.replace)',
              }
            : {}),
        },
      ],
    };
  },
});

export const memoryKinds = [memory];

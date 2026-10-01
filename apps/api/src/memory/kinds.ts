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
  related: async (a, { get }: Pick<RelatedContext, 'get'>) =>
    a.retired?.replacedBy && (await get(a.retired.replacedBy))?.kind !== 'memory'
      ? { invalid: [`${a.retired.replacedBy} is not a lab memory`] }
      : {},
});

export const memoryKinds = [memory];

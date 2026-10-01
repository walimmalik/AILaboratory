import {
  checkEntityFields,
  fieldDefinitionProblems,
  sequenceKey,
  sequenceProblems,
} from '@ailab/domain';
import {
  type CheckResult,
  defineKind,
  EntityAttributes,
  EntityKindAttributes,
  type RecordEnvelope,
  recordIdPattern,
} from '@ailab/schema';

import { memoryLinks } from '../memory/links.ts';

const PLAN = '(plan 010 V1, inventory)';

const kindWords = (kind: string) => kind.replaceAll('_', ' ');

/** A kind of thing the lab registers (V1): a base class from code plus typed fields. */
export const entityKind = defineKind({
  kind: 'entity_kind',
  idPrefix: 'enk',
  namePrefix: 'ENK',
  nameWidth: 4,
  attributes: EntityKindAttributes,
  links: (a) => [
    ...a.fields.flatMap((f) =>
      f.type.type === 'link'
        ? (f.type.entityKinds ?? []).map((k) => ({ toId: k, relation: 'links_to_kind' }))
        : [],
    ),
    ...memoryLinks(a.handlingRules),
  ],
  sections: [
    {
      id: 'definition',
      title: 'Definition',
      fields: ['base', 'prefix', 'fields', 'description'],
    },
    { id: 'handling', title: 'Handling', fields: ['handlingRules'] },
  ],
  related: async (a, { current, list, get, reservedPrefixes }) => {
    const invalid = fieldDefinitionProblems(a.fields);
    if (reservedPrefixes.includes(a.prefix)) {
      invalid.push(`The prefix ${a.prefix} is taken by another registry; choose another`);
    }
    const others = (await list('entity_kind')).filter((k) => k.id !== current?.id);
    const same = others.find((k) => (k.attributes as EntityKindAttributes).prefix === a.prefix);
    if (same) invalid.push(`The prefix ${a.prefix} is taken by ${same.label} (${same.name})`);
    if (current) {
      const before = current.attributes as EntityKindAttributes;
      const changed = before.prefix !== a.prefix || before.base !== a.base;
      if (changed) {
        const used = (await list('entity')).some(
          (e) => (e.attributes as EntityAttributes).entityKind === current.id,
        );
        if (used) {
          invalid.push(
            'Entities of this kind exist, so its base and prefix stay as they are; make a new kind instead',
          );
        }
      }
    }
    for (const f of a.fields) {
      if (f.type.type !== 'link') continue;
      for (const id of f.type.entityKinds ?? []) {
        const target = await get(id);
        if (target?.kind !== 'entity_kind') {
          invalid.push(`${f.label}: ${id} is not an entity kind in this lab`);
        }
      }
    }
    return { invalid };
  },
});

const check = (
  id: string,
  label: string,
  severity: CheckResult['severity'],
  problem: string | undefined,
  fix?: string,
  section = 'identity',
): CheckResult => ({
  id,
  label,
  severity,
  source: PLAN,
  section,
  passed: problem === undefined,
  ...(problem ? { message: problem } : {}),
  ...(fix ? { fix } : {}),
});

/** A plasmid, cell line, compound…: checked against its entity kind on every write (ADR 0029). */
export const entity = defineKind({
  kind: 'entity',
  idPrefix: 'ent',
  namePrefix: 'ENT',
  nameWidth: 4,
  attributes: EntityAttributes,
  links: (a) => [
    { toId: a.entityKind, relation: 'is_a' },
    ...memoryLinks(a.handlingRules),
    ...[
      ...new Set(
        Object.values(a.fields).filter(
          (v): v is string => typeof v === 'string' && recordIdPattern.test(v),
        ),
      ),
    ].map((v) => ({ toId: v, relation: 'refers_to' })),
  ],
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: ['entityKind', 'fields', 'sequence', 'structure', 'synonyms', 'notes'],
    },
    { id: 'handling', title: 'Handling', fields: ['handlingRules'] },
  ],
  related: async (a, { current, get, list }) => {
    const kindRecord = await get(a.entityKind);
    if (kindRecord?.kind !== 'entity_kind' || kindRecord.status === 'archived') {
      return { invalid: [`${a.entityKind} is not an entity kind in this lab`] };
    }
    const invalid: string[] = [];
    const before = current?.attributes as EntityAttributes | undefined;
    if (before && before.entityKind !== a.entityKind) {
      invalid.push("An entity's kind can't change; register it again as the other kind");
    }
    const kind = kindRecord.attributes as EntityKindAttributes;
    const fields = checkEntityFields(kind.fields, a.fields);
    invalid.push(...fields.invalid);
    for (const { field, id } of fields.links) {
      if (field.type.type !== 'link') continue;
      const target: RecordEnvelope | undefined = await get(id);
      if (!target) {
        invalid.push(`${field.label}: no record ${id} in this lab`);
      } else if (target.kind !== field.type.kind) {
        invalid.push(
          `${field.label}: ${target.name} is a ${kindWords(target.kind)}, not a ${kindWords(field.type.kind)}`,
        );
      } else if (
        field.type.entityKinds &&
        !field.type.entityKinds.includes((target.attributes as EntityAttributes).entityKind)
      ) {
        invalid.push(`${field.label}: ${target.name} is not one of the kinds allowed here`);
      }
    }
    if (a.sequence) invalid.push(...sequenceProblems(a.sequence, kind.base));
    if (a.structure && kind.base !== 'chemical') {
      invalid.push(`A ${kind.base} entity has no chemical structure`);
    }

    const others = (await list('entity')).filter((e) => e.id !== current?.id);
    const same = (match: (o: EntityAttributes) => boolean) =>
      others.filter((o) => match(o.attributes as EntityAttributes)).map((o) => o.name);
    const key = a.sequence ? sequenceKey(a.sequence) : undefined;
    const sameSequence = key
      ? same((o) => o.sequence !== undefined && sequenceKey(o.sequence) === key)
      : [];
    const inchiKey = a.structure?.inchiKey;
    const sameStructure = inchiKey ? same((o) => o.structure?.inchiKey === inchiKey) : [];

    return {
      invalid,
      namePrefix: kind.prefix,
      checks: [
        {
          ...check(
            'kind_confirmed',
            'Its kind is confirmed',
            'blocker',
            kindRecord.status === 'active'
              ? undefined
              : `${kindRecord.label} (${kindRecord.name}) is still a draft`,
            `Confirm ${kindRecord.name} first`,
          ),
          ...(kindRecord.status === 'active' ? {} : { record: kindRecord.id }),
        },
        check(
          'required_fields',
          'Required fields have values',
          'blocker',
          fields.missing.length > 0 ? fields.missing.join('; ') : undefined,
          'Fill them in',
        ),
        check(
          'no_duplicate',
          'Not already registered',
          'warning',
          sameSequence.length > 0
            ? `Same sequence as ${sameSequence.join(', ')}`
            : sameStructure.length > 0
              ? `Same InChIKey as ${sameStructure.join(', ')}`
              : undefined,
          'Use the existing entity, or say how this one differs',
        ),
      ],
    };
  },
});

export const entityKinds = [entityKind, entity];

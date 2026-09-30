import { sequenceContains } from '@ailab/domain';
import {
  type EntityAttributes,
  type EntityKindAttributes,
  entitiesDraft,
  entitiesDraftKind,
  entitiesSearch,
} from '@ailab/schema';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';

export const entityOperations = [
  implement(entitiesDraftKind, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'entity_kind',
        label: input.label,
        attributes: input.attributes,
        ...(input.evidence ? { evidence: input.evidence } : {}),
        reason: input.reason ?? `Drafted the entity kind ${input.label}`,
      }),
  }),
  implement(entitiesDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'entity',
        label,
        attributes: { ...attributes, fields: attributes.fields ?? {} },
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted ${label}`,
      }),
  }),
  implement(entitiesSearch, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const kinds = new Map(
        (await service.list(ctx, { kind: 'entity_kind', limit: 1000 })).map((k) => [
          k.id,
          {
            id: k.id,
            name: k.name,
            label: k.label,
            base: (k.attributes as EntityKindAttributes).base,
          },
        ]),
      );
      const status = input.status ? { status: input.status } : {};
      const text = input.text?.trim().toLowerCase();
      const matches = (
        await service.list(ctx, { kind: 'entity', ...status, limit: 20000 })
      ).flatMap((entity) => {
        const a = entity.attributes as EntityAttributes;
        const kind = kinds.get(a.entityKind);
        if (!kind) return [];
        const texts = [
          entity.label,
          entity.name,
          ...(a.synonyms ?? []),
          ...Object.values(a.fields).filter((v): v is string => typeof v === 'string'),
        ];
        const found =
          (!text || texts.some((t) => t.toLowerCase().includes(text))) &&
          (!input.entityKind || a.entityKind === input.entityKind) &&
          (!input.base || kind.base === input.base) &&
          (!input.field || a.fields[input.field.key] === input.field.value) &&
          (!input.sequence ||
            (a.sequence !== undefined && sequenceContains(a.sequence, input.sequence)));
        return found ? [{ entity, kind }] : [];
      });
      return { entities: matches.slice(0, input.limit ?? 100), total: matches.length };
    },
  }),
];

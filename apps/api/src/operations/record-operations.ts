import {
  recordsActivate,
  recordsArchive,
  recordsConfirmSection,
  recordsCreate,
  recordsDeleteDraft,
  recordsGet,
  recordsHistory,
  recordsKinds,
  recordsLinks,
  recordsList,
  recordsReadiness,
  recordsRestore,
  recordsUnarchive,
  recordsUpdate,
} from '@ailab/schema';
import { z } from 'zod';
import type { RecordContext } from '../records/service.ts';
import { RecordService } from '../records/service.ts';
import { OperationError } from './errors.ts';
import { type AgentPolicy, implement, type OperationDeps } from './registry.ts';

const service = (deps: OperationDeps) => new RecordService(deps.db, deps.kinds);

/** Agents edit drafts freely; changes to active records wait for a person. */
export const proposeIfActive: AgentPolicy<{ id: string }> = async (
  ctx: RecordContext,
  input,
  deps,
) => {
  const record = await service(deps).get(ctx, input.id);
  return record.status === 'active' ? 'propose' : 'direct';
};

export const recordOperations = [
  implement(recordsCreate, {
    agentPolicy: (_ctx, input, deps) => {
      if (input.status === 'active' && deps.kinds.get(input.kind).sections?.length) {
        throw new OperationError(
          'invalid_state',
          `An agent creates a ${input.kind} as a draft; a person confirms each section and then the draft`,
        );
      }
      return input.status === 'active' ? 'propose' : 'direct';
    },
    run: (ctx, input, deps) => {
      const { createdBy } = deps.kinds.get(input.kind);
      if (createdBy) {
        throw new OperationError(
          'invalid_input',
          `A ${input.kind} is created with ${createdBy}, not records.create`,
        );
      }
      return service(deps).create(ctx, {
        kind: input.kind,
        label: input.label,
        attributes: input.attributes,
        ...(input.status ? { status: input.status } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      });
    },
  }),
  implement(recordsKinds, {
    run: async (_ctx, _input, deps) => ({
      kinds: deps.kinds.list().map((definition) => ({
        kind: definition.kind,
        idPrefix: definition.idPrefix,
        namePrefix: definition.namePrefix,
        attributes: z.toJSONSchema(definition.attributes, {
          target: 'draft-2020-12',
          io: 'input',
          unrepresentable: 'any',
        }) as Record<string, unknown>,
        sections: definition.sections ?? [],
        checks: (definition.checks ?? []).map(({ id, label, severity, source, section }) => ({
          id,
          label,
          severity,
          source,
          ...(section ? { section } : {}),
        })),
      })),
    }),
  }),
  implement(recordsGet, {
    run: (ctx, input, deps) => service(deps).get(ctx, input.id),
  }),
  implement(recordsList, {
    run: async (ctx, input, deps) => ({ records: await service(deps).list(ctx, input) }),
  }),
  implement(recordsUpdate, {
    agentPolicy: proposeIfActive,
    run: (ctx, { id, ...input }, deps) =>
      service(deps).update(ctx, id, {
        expectedVersion: input.expectedVersion,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
        ...(input.evidence ? { evidence: input.evidence } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      }),
  }),
  implement(recordsActivate, {
    // An agent may ask for the final confirm, but only once a person has confirmed every section.
    agentPolicy: async (ctx, input, deps) => {
      const state = await service(deps).readiness(ctx, input.id);
      if (state.status === 'draft' && !state.ready) {
        throw new OperationError('not_ready', `Not ready to confirm: ${state.missing.join('; ')}`, {
          missing: state.missing,
        });
      }
      return 'propose' as const;
    },
    run: (ctx, { id, ...input }, deps) => service(deps).activate(ctx, id, transition(input)),
  }),
  implement(recordsConfirmSection, {
    // Confirming is what a person does after reviewing an agent's draft (ADR 0021).
    actors: 'people',
    agentPolicy: 'direct',
    run: (ctx, { id, section, ...input }, deps) =>
      service(deps).confirmSection(ctx, id, { section, ...transition(input) }),
  }),
  implement(recordsReadiness, {
    run: (ctx, input, deps) => service(deps).readiness(ctx, input.id),
  }),
  implement(recordsArchive, {
    agentPolicy: 'propose',
    run: (ctx, { id, ...input }, deps) => service(deps).archive(ctx, id, transition(input)),
  }),
  implement(recordsUnarchive, {
    agentPolicy: 'propose',
    run: (ctx, { id, ...input }, deps) => service(deps).unarchive(ctx, id, transition(input)),
  }),
  implement(recordsRestore, {
    agentPolicy: proposeIfActive,
    run: (ctx, { id, version, ...input }, deps) =>
      service(deps).restore(ctx, id, { version, ...transition(input) }),
  }),
  implement(recordsDeleteDraft, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      await service(deps).deleteDraft(ctx, input.id, { expectedVersion: input.expectedVersion });
      return { deleted: true as const, id: input.id };
    },
  }),
  implement(recordsHistory, {
    run: async (ctx, input, deps) => ({ versions: await service(deps).history(ctx, input.id) }),
  }),
  implement(recordsLinks, {
    run: async (ctx, input, deps) => ({
      links:
        input.direction === 'from'
          ? await service(deps).linksFrom(ctx, input.id)
          : await service(deps).linksTo(ctx, input.id),
    }),
  }),
];

function transition(input: { expectedVersion: number; reason?: string | undefined }) {
  return {
    expectedVersion: input.expectedVersion,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

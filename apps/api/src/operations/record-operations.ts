import {
  recordsActivate,
  recordsArchive,
  recordsCreate,
  recordsDeleteDraft,
  recordsGet,
  recordsHistory,
  recordsLinks,
  recordsRestore,
  recordsUnarchive,
  recordsUpdate,
} from '@ailab/schema';
import type { RecordContext } from '../records/service.ts';
import { RecordService } from '../records/service.ts';
import { type AgentPolicy, implement, type OperationDeps } from './registry.ts';

const service = (deps: OperationDeps) => new RecordService(deps.db, deps.kinds);

/** Agents edit drafts freely; changes to active records wait for a person. */
const proposeIfActive: AgentPolicy<{ id: string }> = async (ctx: RecordContext, input, deps) => {
  const record = await service(deps).get(ctx, input.id);
  return record.status === 'active' ? 'propose' : 'direct';
};

export const recordOperations = [
  implement(recordsCreate, {
    agentPolicy: (_ctx, input) => (input.status === 'active' ? 'propose' : 'direct'),
    run: (ctx, input, deps) =>
      service(deps).create(ctx, {
        kind: input.kind,
        label: input.label,
        attributes: input.attributes,
        ...(input.status ? { status: input.status } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      }),
  }),
  implement(recordsGet, {
    run: (ctx, input, deps) => service(deps).get(ctx, input.id),
  }),
  implement(recordsUpdate, {
    agentPolicy: proposeIfActive,
    run: (ctx, { id, ...input }, deps) =>
      service(deps).update(ctx, id, {
        expectedVersion: input.expectedVersion,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
        ...(input.reason ? { reason: input.reason } : {}),
      }),
  }),
  implement(recordsActivate, {
    agentPolicy: 'propose',
    run: (ctx, { id, ...input }, deps) => service(deps).activate(ctx, id, transition(input)),
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

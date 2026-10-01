import { diffValues } from '@ailab/domain';
import {
  type RecordEnvelope,
  recordsActivate,
  recordsArchive,
  recordsConfirm,
  recordsConfirmMany,
  recordsConfirmSection,
  recordsCreate,
  recordsDeleteDraft,
  recordsDiff,
  recordsGet,
  recordsHistory,
  recordsKinds,
  recordsLinks,
  recordsList,
  recordsMarkSeen,
  recordsReadiness,
  recordsRestore,
  recordsUnarchive,
  recordsUpdate,
} from '@ailab/schema';
import { z } from 'zod';
import { markSeen, seenVersion } from '../records/seen.ts';
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
    run: async (_ctx, input, deps) => {
      // Asking for a kind by name refuses names the lab doesn't have, so a typo isn't an empty list.
      const definitions = input.kinds
        ? input.kinds.map((kind) => deps.kinds.get(kind))
        : deps.kinds.list();
      return {
        kinds: definitions.map((definition) => ({
          kind: definition.kind,
          idPrefix: definition.idPrefix,
          namePrefix: definition.namePrefix,
          sections: definition.sections ?? [],
          ...(definition.items ? { items: definition.items } : {}),
          ...(input.summary
            ? {}
            : {
                attributes: z.toJSONSchema(definition.attributes, {
                  target: 'draft-2020-12',
                  io: 'input',
                  unrepresentable: 'any',
                }) as Record<string, unknown>,
                checks: (definition.checks ?? []).map(
                  ({ id, label, severity, source, section }) => ({
                    id,
                    label,
                    severity,
                    source,
                    ...(section ? { section } : {}),
                  }),
                ),
              }),
        })),
      };
    },
  }),
  implement(recordsGet, {
    run: async (ctx, input, deps) => {
      const record = await service(deps).get(ctx, input.id);
      if (!input.brief) return record;
      // Item evidence is keyed "/list/key"; a field's own evidence has no slash.
      const { reviews: _, ...rest } = record;
      return {
        ...rest,
        evidence: Object.fromEntries(
          Object.entries(record.evidence).filter(([key]) => !key.startsWith('/')),
        ),
      };
    },
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
  implement(recordsConfirm, {
    // One Confirm for everything ready (ADR 0046); still a person's step, like each section's.
    actors: 'people',
    agentPolicy: 'direct',
    run: (ctx, { id, ...input }, deps) => service(deps).confirmAll(ctx, id, transition(input)),
  }),
  implement(recordsConfirmMany, {
    // Batch confirm (plan 004e R3, ADR 0050): only what holds no guess, no failing blocker and no
    // changed confirmed value (a person sees the warnings counted on Review); all or nothing, and
    // each record gets its own confirmation.
    actors: 'people',
    agentPolicy: 'direct',
    touches: (input) => input.records.map((r) => r.id),
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const refused: string[] = [];
      const states = [];
      for (const target of input.records) {
        const record = await records.get(ctx, target.id);
        const state = await records.readiness(ctx, target.id);
        const why = [
          record.version !== target.expectedVersion &&
            `changed since you looked (v${record.version})`,
          state.assumed.length > 0 && `${state.assumed.length} assumed`,
          state.checks.some((c) => !c.passed && c.severity === 'blocker') && 'a failing check',
          state.sections.some((s) => s.state === 'needs_review' && s.review) &&
            'values changed since they were confirmed',
        ].filter(Boolean);
        if (why.length) refused.push(`${record.name} (${why.join(', ')})`);
        states.push(record);
      }
      if (refused.length) {
        throw new OperationError(
          'invalid_state',
          `Nothing was confirmed. Open these one by one: ${refused.join('; ')}`,
          { refused },
        );
      }
      const confirmed = [];
      for (const record of states) {
        const done = await records.confirmAll(ctx, record.id, {
          expectedVersion: record.version,
          ...(input.reason ? { reason: input.reason } : {}),
        });
        confirmed.push({
          id: done.id,
          name: done.name,
          status: done.status,
          version: done.version,
        });
      }
      return { confirmed };
    },
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
    // Deleting takes the history with it, so an agent does it directly only to a draft that agents
    // working for the same person made alone, with nothing confirmed. A person's work is a proposal.
    agentPolicy: async (ctx, input, deps) => {
      const records = service(deps);
      const record = await records.get(ctx, input.id);
      const principal = ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf : undefined;
      const ours = (actor: RecordEnvelope['createdBy']) =>
        actor.type === 'agent' && actor.onBehalfOf === principal;
      if (Object.keys(record.reviews).length > 0) return 'propose';
      const versions = await records.history(ctx, record.id);
      return versions.every((v) => ours(v.actor)) ? 'direct' : 'propose';
    },
    run: async (ctx, input, deps) => {
      await service(deps).deleteDraft(ctx, input.id, { expectedVersion: input.expectedVersion });
      return { deleted: true as const, id: input.id };
    },
  }),
  implement(recordsDiff, {
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const current = await records.get(ctx, input.id);
      const to = input.to ?? current.version;
      const seen =
        input.from === undefined ? await seenVersion(deps.db, ctx, current.id) : undefined;
      const from = input.from ?? Math.min(seen ?? 1, to);
      if (from > to || to > current.version) {
        throw new OperationError(
          'invalid_input',
          `${current.name} has versions 1 to ${current.version}; compare an earlier version with a later one`,
        );
      }
      const history = await records.history(ctx, current.id);
      const at = (v: number) => history.find((h) => h.version === v)?.snapshot;
      const before = at(from);
      const after = at(to);
      const items = deps.kinds.get(current.kind).items ?? {};
      const top = (e: typeof before) => ({ label: e?.label, status: e?.status });
      return {
        from,
        to,
        since:
          input.from !== undefined
            ? ('given' as const)
            : seen === undefined
              ? ('first_drafted' as const)
              : ('seen' as const),
        changes: [
          ...diffValues(top(before), top(after)),
          ...diffValues(before?.attributes, after?.attributes, items),
        ],
        versions: history
          .filter((h) => h.version > from && h.version <= to)
          .map((h) => ({
            version: h.version,
            actor: h.actor,
            at: h.at,
            ...(h.via ? { via: h.via } : {}),
            ...(h.reason ? { reason: h.reason } : {}),
          })),
      };
    },
  }),
  implement(recordsMarkSeen, {
    actors: 'people',
    agentPolicy: 'direct',
    // Looking at a record changes nothing in the lab, so it isn't in the ledger.
    ledger: false,
    run: async (ctx, input, deps) => {
      const record = await service(deps).get(ctx, input.id);
      if (input.version > record.version) {
        throw new OperationError('invalid_input', `${record.name} has no version ${input.version}`);
      }
      const at = await markSeen(deps.db, ctx, record.id, input.version);
      return { id: record.id, version: input.version, at: at.toISOString() };
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

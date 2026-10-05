import { CHECK_AGAIN_MONTHS, checkAgainFor, isDue } from '@ailab/domain';
import {
  type EvidenceInput,
  type MemoryAttributes,
  type MemoryInput,
  memoryFor,
  memoryPropose,
  memoryRemember,
  memoryReplace,
  memoryRetire,
  memorySearch,
  memoryUpdate,
  memoryUsedIn,
  type RecordEnvelope,
} from '@ailab/schema';
import type { z } from 'zod';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { saveCalculation } from '../records/calculations.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { activeMemories, bundle, evidenceByMemory, lookup, nearby } from './match.ts';

/** Lab memory operations (plans 005a and 005b). */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

const today = () => new Date().toISOString().slice(0, 10);

/** One line for a memory's label: its statement, cut at a word near 80 characters. */
export function labelOf(statement: string): string {
  const s = statement.trim();
  if (s.length <= 80) return s;
  const cut = s.slice(0, 80);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:.]$/, '')}…`;
}

/** A new memory's attributes: strength note and the whole lab when left out, the date by kind. */
function attributesOf(input: z.infer<typeof MemoryInput>): MemoryAttributes {
  const checkAgain = input.checkAgain ?? checkAgainFor(input.kind, today());
  return {
    ...input,
    strength: input.strength ?? 'note',
    appliesTo: input.appliesTo ?? { to: 'lab' },
    ...(checkAgain ? { checkAgain } : {}),
  };
}

/**
 * A new memory's attributes, with the default check-again date marked calculated: the date is kept
 * as a calculation, so it reads "calculated" rather than unverified (UX review 2026-10-02, #9).
 */
async function drafted(
  deps: OperationDeps,
  ctx: RecordContext,
  input: z.infer<typeof MemoryInput>,
): Promise<{ attributes: MemoryAttributes; evidence: Record<string, EvidenceInput> }> {
  const attributes = attributesOf(input);
  if (input.checkAgain || !attributes.checkAgain) return { attributes, evidence: {} };
  const from = today();
  const calculation = await saveCalculation(
    deps.db,
    ctx,
    'memory.check_again',
    { kind: input.kind, from },
    { checkAgain: attributes.checkAgain },
  );
  return {
    attributes,
    evidence: {
      checkAgain: {
        source: 'calculated',
        calculation,
        note: `A ${input.kind} is checked again ${CHECK_AGAIN_MONTHS[input.kind]} months after it is written`,
      },
    },
  };
}

async function memoryOf(deps: OperationDeps, ctx: RecordContext, id: string) {
  const record = await service(deps)
    .get(ctx, id)
    .catch(() => undefined);
  if (record?.kind !== 'memory')
    throw new OperationError('not_found', `${id} is not a lab memory in this lab`);
  return { record, a: record.attributes as MemoryAttributes };
}

/** A personal memory is the person's own: only they make it active (M5). */
function ownedBy(ctx: RecordContext, a: Pick<MemoryAttributes, 'appliesTo'>) {
  if (a.appliesTo.to !== 'person' || ctx.actor.type !== 'user') return;
  if (a.appliesTo.user !== ctx.actor.userId)
    throw new OperationError(
      'forbidden',
      "A personal memory is that person's own; they remember it themselves, or an agent proposes it for them to confirm",
    );
}

async function retire(
  deps: OperationDeps,
  ctx: RecordContext,
  record: RecordEnvelope,
  expectedVersion: number,
  retired: NonNullable<MemoryAttributes['retired']>,
) {
  const records = service(deps);
  if (record.status === 'archived')
    throw new OperationError('invalid_state', `${record.name} is already retired`);
  const marked = await records.update(ctx, record.id, {
    expectedVersion,
    attributes: { ...(record.attributes as MemoryAttributes), retired },
    reason: `Retired: ${retired.why}`,
  });
  return records.archive(ctx, record.id, {
    expectedVersion: marked.version,
    reason: `Retired: ${retired.why}`,
  });
}

export const memoryOperations = [
  implement(memoryPropose, {
    agentPolicy: 'direct',
    run: async (ctx, { evidence, reason, ...input }, deps) => {
      // A memory a person said is theirs as stated, not the agent's guess (UX review 2026-10-02, #3).
      const said =
        ctx.actor.type === 'agent' &&
        !evidence?.source &&
        (input.source.from === 'stated' || input.source.from === 'conversation');
      const { attributes, evidence: dated } = await drafted(deps, ctx, input);
      const named = {
        ...dated,
        ...(said
          ? { source: { source: 'stated' as const, note: 'Where the person said it' } }
          : {}),
        ...evidence,
      };
      return service(deps).create(ctx, {
        kind: 'memory',
        label: labelOf(input.statement),
        attributes,
        ...(Object.keys(named).length ? { evidence: named } : {}),
        reason: reason ?? 'Proposed for the lab memory',
      });
    },
  }),
  implement(memoryRemember, {
    actors: 'people',
    agentPolicy: 'direct',
    run: async (ctx, { reason, ...input }, deps) => {
      const { attributes, evidence } = await drafted(deps, ctx, input);
      ownedBy(ctx, attributes);
      return service(deps).create(ctx, {
        kind: 'memory',
        label: labelOf(input.statement),
        attributes,
        ...(Object.keys(evidence).length ? { evidence } : {}),
        status: 'active',
        reason: reason ?? 'Remembered, as stated',
      });
    },
  }),
  implement(memoryUpdate, {
    agentPolicy: proposeIfActive,
    run: async (ctx, { id, expectedVersion, evidence, reason, when, ...changes }, deps) => {
      const { record, a } = await memoryOf(deps, ctx, id);
      const { when: before, ...kept } = a;
      const after = when === null ? undefined : (when ?? before);
      const attributes = {
        ...kept,
        ...(after ? { when: after } : {}),
        ...changes,
      } as MemoryAttributes;
      if (record.status === 'active') ownedBy(ctx, attributes);
      return service(deps).update(ctx, id, {
        expectedVersion,
        attributes,
        ...(changes.statement ? { label: labelOf(changes.statement) } : {}),
        ...(evidence ? { evidence } : {}),
        reason: reason ?? 'Updated the lab memory',
      });
    },
  }),
  implement(memoryRetire, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const { record } = await memoryOf(deps, ctx, input.id);
      return retire(deps, ctx, record, input.expectedVersion, { why: input.why });
    },
  }),
  implement(memoryReplace, {
    agentPolicy: 'propose',
    run: async (ctx, input, deps) => {
      const { record } = await memoryOf(deps, ctx, input.id);
      if (record.status !== 'active')
        throw new OperationError(
          'invalid_state',
          `${record.name} is ${record.status === 'draft' ? 'a draft; edit it with memory.update' : 'retired already'}`,
        );
      const { attributes, evidence } = await drafted(deps, ctx, input.with);
      ownedBy(ctx, attributes);
      // On approval the new memory is the approver's, active as they confirmed it; an agent's
      // preview of the proposal shows it as a draft.
      const author = ctx.approvedBy ? { ...ctx, actor: ctx.approvedBy } : ctx;
      const memory = await service(deps).create(author, {
        kind: 'memory',
        label: labelOf(input.with.statement),
        attributes,
        ...(Object.keys(evidence).length ? { evidence } : {}),
        status: author.actor.type === 'user' ? 'active' : 'draft',
        reason: `Replaces ${record.name}: ${input.why}`,
      });
      const retired = await retire(deps, ctx, record, input.expectedVersion, {
        why: input.why,
        replacedBy: memory.id,
      });
      return { retired, memory };
    },
  }),
  implement(memorySearch, {
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const statuses =
        input.status === 'retired'
          ? (['archived'] as const)
          : input.status
            ? ([input.status] as const)
            : (['draft', 'active'] as const);
      const all = (
        await Promise.all(
          statuses.map((status) => records.list(ctx, { kind: 'memory', status, limit: 5000 })),
        )
      ).flat();
      const words = input.text?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
      const now = today();
      const found = all.filter((m) => {
        const a = m.attributes as MemoryAttributes;
        const text = `${a.statement} ${a.when ?? ''} ${m.name}`.toLowerCase();
        return (
          words.every((w) => text.includes(w)) &&
          (!input.about || (a.about ?? []).includes(input.about)) &&
          (!input.kind || a.kind === input.kind) &&
          (!input.strength || a.strength === input.strength) &&
          (!input.person || (a.appliesTo.to === 'person' && a.appliesTo.user === input.person))
        );
      });
      // Rules first, then defaults, then notes; newest first within each.
      const order = { rule: 0, default: 1, note: 2 } as const;
      found.sort(
        (x, y) =>
          order[(x.attributes as MemoryAttributes).strength] -
            order[(y.attributes as MemoryAttributes).strength] ||
          y.updatedAt.localeCompare(x.updatedAt),
      );
      const shown = found.slice(0, input.limit ?? 50);
      const evidence = await evidenceByMemory(deps, ctx);
      const named = new Map<string, { id: string; name: string; label: string; kind: string }>();
      for (const id of new Set(
        shown.flatMap((m) => (m.attributes as MemoryAttributes).about ?? []),
      )) {
        const record = await records.get(ctx, id).catch(() => undefined);
        if (record)
          named.set(id, { id, name: record.name, label: record.label, kind: record.kind });
      }
      return {
        memories: shown.map((m) => {
          const a = m.attributes as MemoryAttributes;
          const seen = evidence.get(m.id);
          return {
            ...m,
            due: m.status === 'active' && (isDue(a.checkAgain, now) || seen?.due !== undefined),
            ...(seen ? { seen } : {}),
            aboutRecords: (a.about ?? []).flatMap((id) => {
              const r = named.get(id);
              return r ? [r] : [];
            }),
          };
        }),
        total: found.length,
      };
    },
  }),
  implement(memoryFor, {
    run: async (ctx, input, deps) => {
      const records = input.records ?? [];
      const around = input.nearby ? await nearby(deps, ctx, records) : [];
      const { matches } = lookup(await activeMemories(deps, ctx), ctx, {
        records: [...records, ...around],
        facts: input.facts,
        person: input.person,
      });
      return bundle(matches, input.limit ?? 15);
    },
  }),
  implement(memoryUsedIn, {
    run: async (ctx, input, deps) => {
      await memoryOf(deps, ctx, input.id);
      const citing = await service(deps).citing(ctx, input.id);
      return {
        records: citing.map(({ record, fields }) => ({
          id: record.id,
          name: record.name,
          label: record.label,
          kind: record.kind,
          status: record.status,
          version: record.version,
          fields,
        })),
      };
    },
  }),
];

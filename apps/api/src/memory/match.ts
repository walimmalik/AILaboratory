import {
  type ActiveMemory,
  type AppliedEffects,
  appliedEffects,
  isDue,
  type MemoryMatch,
  matchConflicts,
  memoriesFor,
  memoryLine,
} from '@ailab/domain';
import type { MemoryAttributes, MemoryFacts } from '@ailab/schema';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * Lab memory for consumers (plan 005b): the active memories, matched by the pure functions in
 * @ailab/domain. The liquid class resolver, transfers.options, memory.for and the assistant's page
 * bundle all read memory through here, so one piece of work gets the same memories everywhere.
 */

/** The person a caller acts for: themselves, or the person an agent works for. */
export const personOf = (ctx: RecordContext) =>
  ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf;

/** Every confirmed, unretired memory in the lab. */
export async function activeMemories(
  deps: Pick<OperationDeps, 'db' | 'kinds'>,
  ctx: RecordContext,
): Promise<ActiveMemory[]> {
  const list = await new RecordService(deps.db, deps.kinds).list(ctx, {
    kind: 'memory',
    status: 'active',
    limit: 5000,
  });
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    attributes: r.attributes as MemoryAttributes,
    updatedAt: r.updatedAt,
  }));
}

export interface MemoryLookup {
  records: readonly string[];
  facts?: MemoryFacts | undefined;
  person?: string | undefined;
}

/** The matches for one piece of work and the effects code applies from them. */
export function lookup(
  memories: readonly ActiveMemory[],
  ctx: RecordContext,
  work: MemoryLookup,
): { matches: MemoryMatch[]; effects: AppliedEffects } {
  const matches = memoriesFor(memories, {
    records: work.records,
    facts: work.facts ?? {},
    person: work.person ?? personOf(ctx),
  });
  return { matches, effects: appliedEffects(matches) };
}

/** The records these link to, one step out (a page's neighbours), without the records themselves. */
export async function nearby(
  deps: Pick<OperationDeps, 'db' | 'kinds'>,
  ctx: RecordContext,
  ids: readonly string[],
): Promise<string[]> {
  const service = new RecordService(deps.db, deps.kinds);
  const out = new Set<string>();
  for (const id of ids) {
    const links = await service.linksFrom(ctx, id).catch(() => []);
    for (const link of links) if (!ids.includes(link.toId)) out.add(link.toId);
  }
  return [...out];
}

/**
 * Memories as the agent reads them (M7): one line each, most specific first, capped, with how
 * many more there are. Conflicts follow, since code applies neither side.
 */
export function bundle(matches: readonly MemoryMatch[], limit: number) {
  const now = new Date().toISOString().slice(0, 10);
  const shown = matches.slice(0, limit);
  const conflicts = matchConflicts(matches).map((c) => ({
    memories: c.memories.map((m) => m.name),
    why: c.why,
  }));
  const more = matches.length - shown.length;
  const lines = [
    ...shown.map((m) => {
      const extra = [
        m.applies ? '' : `may apply; not known: ${m.unknown.join(', ')}`,
        isDue(m.memory.attributes.checkAgain, now) ? 'due for a check' : '',
      ].filter(Boolean);
      return `${memoryLine(m.memory)}${extra.length ? ` [${extra.join('; ')}]` : ''}`;
    }),
    ...(more > 0 ? [`${more} more: memory.search`] : []),
    ...conflicts.map((c) => `${c.memories.join(' and ')} disagree: ${c.why}; neither is applied`),
  ];
  return {
    memories: shown.map((m) => {
      const a = m.memory.attributes;
      return {
        id: m.memory.id,
        name: m.memory.name,
        statement: a.statement,
        kind: a.kind,
        strength: a.strength,
        ...(a.effect ? { effect: a.effect } : {}),
        applies: m.applies,
        unknown: m.unknown,
        due: isDue(a.checkAgain, now),
      };
    }),
    more,
    conflicts,
    lines,
  };
}

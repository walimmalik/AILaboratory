import { readiness, summarizeReadiness } from '@ailab/domain';
import {
  type Actor,
  type MemoryAttributes,
  type RecordEnvelope,
  type ReviewItem,
  reviewList,
} from '@ailab/schema';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { conversationTitles, requestTitles } from '../assistant/store.ts';
import type { Db } from '../db/client.ts';
import { recordLinks, records } from '../db/schema.ts';
import { mentionsWaiting } from '../library/mentions.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { listProposals } from './proposal-store.ts';
import { implement } from './registry.ts';

/**
 * How many drafts the inbox reads at most. The counts cover every draft, so the page can say what
 * was left out and open one kind at a time.
 */
const DRAFT_LIMIT = 200;

/** Who an item is for: the person an agent worked for, or the person who acted. */
const addressee = (actor: Actor) => (actor.type === 'agent' ? actor.onBehalfOf : actor.userId);

/** The agent conversation an item came from, when an agent made it in one. */
const sessionOf = (actor: Actor) => (actor.type === 'agent' ? actor.sessionRef : undefined);

const TIERS = ['needs_you', 'to_confirm', 'fyi'] as const;

/**
 * Most urgent first (review 2026-10-01 item 16): by tier, then the earliest due date, then items
 * other records wait on, then the newest.
 */
function byUrgency(a: ReviewItem, b: ReviewItem): number {
  const tier = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier);
  if (tier !== 0) return tier;
  if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1;
  const blocks = Number(Boolean(b.blocking?.length)) - Number(Boolean(a.blocking?.length));
  if (blocks !== 0) return blocks;
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

/** Records, not archived, that point to each of these drafts: what waits on them. */
async function waitingOn(db: Db, labId: string, ids: string[]) {
  const found = new Map<string, { id: string; kind: string; name: string; label: string }[]>();
  if (ids.length === 0) return found;
  const rows = await db
    .selectDistinct({
      toId: recordLinks.toId,
      id: records.id,
      kind: records.kind,
      name: records.name,
      label: records.label,
    })
    .from(recordLinks)
    .innerJoin(records, eq(records.id, recordLinks.fromId))
    .where(
      and(
        eq(recordLinks.labId, labId),
        inArray(recordLinks.toId, ids),
        ne(records.status, 'archived'),
      ),
    )
    .orderBy(records.name);
  for (const { toId, ...record } of rows) found.set(toId, [...(found.get(toId) ?? []), record]);
  return found;
}

export const reviewOperations = [
  implement(reviewList, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const drafts = await service.list(ctx, {
        status: 'draft',
        kind: input.kind,
        limit: DRAFT_LIMIT,
      });
      const changes = await listProposals(deps.db, ctx, 'pending');
      const mentions = await mentionsWaiting(deps.db, ctx);
      // Drafts of a kind this lab no longer offers can't be confirmed, so they aren't waiting on anyone.
      const kinds = new Map(deps.kinds.list().map((k) => [k.kind, k]));
      const perKind = await deps.db
        .select({ kind: records.kind, n: count() })
        .from(records)
        .where(and(eq(records.labId, ctx.labId), eq(records.status, 'draft')))
        .groupBy(records.kind);
      const draftCounts = Object.fromEntries(
        perKind.filter((row) => kinds.has(row.kind) && row.n > 0).map((row) => [row.kind, row.n]),
      );
      const draftTotal = Object.values(draftCounts).reduce((sum, n) => sum + n, 0);
      const me = addressee(ctx.actor);
      const waiting = await waitingOn(
        deps.db,
        ctx.labId,
        drafts.map((d) => d.id),
      );
      // Confirmed records of kinds that raise notices, such as a memory past its check-again date.
      const today = new Date().toISOString().slice(0, 10);
      const notices = input.kind
        ? []
        : (
            await Promise.all(
              deps.kinds
                .list()
                .filter((k) => k.review?.notice)
                .map((k) =>
                  service.list(ctx, { kind: k.kind, status: 'active', limit: DRAFT_LIMIT }),
                ),
            )
          )
            .flat()
            .flatMap((record): ReviewItem[] => {
              const notice = kinds.get(record.kind)?.review?.notice?.(record.attributes, today);
              if (!notice) return [];
              return [
                {
                  type: 'notice',
                  tier: 'fyi',
                  at: record.updatedAt,
                  ...(notice.due ? { due: notice.due } : {}),
                  about: {
                    id: record.id,
                    kind: record.kind,
                    name: record.name,
                    label: record.label,
                  },
                  message: notice.message,
                },
              ];
            });
      const listed: ReviewItem[] = [
        ...(
          await Promise.all(
            drafts.map(async (record) => {
              const kind = kinds.get(record.kind);
              if (!kind) return undefined;
              const own = readiness(record, kind);
              // The stored summary includes checks that read other records (ADR 0050); only a
              // draft where one of those fails is read again, to name what fails.
              const failing = (s: typeof own) =>
                s.checks.filter((c) => c.severity === 'blocker' && !c.passed).length;
              const state =
                record.readiness && record.readiness.blockers > failing(own)
                  ? await service.readiness(ctx, record.id)
                  : own;
              return { record, state };
            }),
          )
        ).flatMap((found): ReviewItem[] => {
          if (!found) return [];
          const { record, state } = found;
          // Older rows written before the stored summary existed fall back to the kind's checks.
          const summary = record.readiness ?? summarizeReadiness(state);
          const due = kinds.get(record.kind)?.review?.due?.(record.attributes as never);
          const blocking = waiting.get(record.id);
          const memory = record.kind === 'memory' ? memoryOf(record) : undefined;
          const item: ReviewItem = {
            type: 'draft',
            tier: 'to_confirm',
            for: addressee(record.createdBy),
            ...(due ? { due } : {}),
            ...(blocking ? { blocking } : {}),
            at: record.updatedAt,
            record: {
              id: record.id,
              kind: record.kind,
              name: record.name,
              label: record.label,
              status: record.status,
              version: record.version,
              updatedBy: record.updatedBy,
              ...(record.summary ? { summary: record.summary } : {}),
            },
            byAgent: record.createdBy.type === 'agent',
            batchable:
              memory?.strength !== 'rule' &&
              summary.assumed === 0 &&
              state.unchecked.length === 0 &&
              summary.blockers === 0 &&
              summary.changed.length === 0,
            warnings: summary.warnings,
            sectionsToConfirm: summary.sectionsLeft,
            missing: state.missing,
            blockers: state.checks
              .filter((c) => c.severity === 'blocker' && !c.passed)
              .map((c) => c.message ?? c.label),
            ready: summary.ready,
            assumed: summary.assumed,
            unchecked: state.unchecked.length,
            ...(memory ? { memory } : {}),
          };
          return [item];
        }),
        ...(input.kind ? [] : changes).map(
          (proposal): ReviewItem => ({
            type: 'change',
            // An agent is waiting on this change, so it blocks something (R1).
            tier: 'needs_you',
            for: addressee(proposal.proposedBy),
            at: proposal.proposedAt,
            proposal,
          }),
        ),
        ...(input.kind ? [] : mentions).map(
          (m): ReviewItem => ({
            type: 'mentions',
            tier: 'to_confirm',
            for: addressee(m.proposedBy),
            at: m.at,
            document: { id: m.id, name: m.name, label: m.label },
            proposed: m.proposed,
          }),
        ),
        ...notices,
      ].filter((item) => !input.mine || item.for === undefined || item.for === me);
      const items = await grouped(deps.db, ctx, listed, new Map(drafts.map((d) => [d.id, d])));
      items.sort(byUrgency);
      // Counts come first, so an agent whose view of a long result is cut still has the totals.
      return {
        counts: {
          total: draftTotal + changes.length + mentions.length,
          changes: changes.length,
          mentions: mentions.reduce((sum, m) => sum + m.proposed, 0),
          notices: notices.length,
          needsYou: changes.filter((p) => addressee(p.proposedBy) === me).length,
          drafts: draftCounts,
        },
        items: input.limit ? items.slice(0, input.limit) : items,
      };
    },
  }),
];

/**
 * Drafts group by their saved request, including a single draft. Proposals keep their existing
 * session grouping and threshold; neither grouping changes review eligibility or authority.
 */
async function grouped(
  db: Db,
  ctx: RecordContext,
  items: ReviewItem[],
  drafts: Map<string, RecordEnvelope>,
): Promise<ReviewItem[]> {
  const maker = (item: ReviewItem) =>
    item.type === 'draft'
      ? drafts.get(item.record.id)?.createdBy
      : item.type === 'change'
        ? item.proposal.proposedBy
        : undefined;
  const session = (item: ReviewItem) => {
    const actor = maker(item);
    return actor && sessionOf(actor);
  };
  const sizes = new Map<string, number>();
  for (const item of items) {
    const id = session(item);
    if (id) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  }
  const shared = [...sizes].filter(([, n]) => n > 1).map(([id]) => id);
  const titles = await conversationTitles(db, ctx, shared);
  const requests = await requestTitles(
    db,
    ctx,
    [...drafts.values()].flatMap((draft) =>
      draft.origin?.type === 'user_message' ? [draft.origin] : [],
    ),
  );
  return items.map((item) => {
    if (item.type === 'draft') {
      const origin = drafts.get(item.record.id)?.origin;
      if (origin?.type !== 'user_message') return item;
      const key = JSON.stringify([origin.conversation, origin.message]);
      return {
        ...item,
        group: {
          id: `request:${key}`,
          title: requests.get(key) ?? 'Saved request (text unavailable)',
        },
      };
    }
    const id = session(item);
    if (!id || !shared.includes(id)) return item;
    const agent = maker(item);
    const name = agent?.type === 'agent' ? agent.agentName : 'an agent';
    return { ...item, group: { id, title: titles.get(id) ?? `Work by ${name} in one session` } };
  });
}

const FROM: Record<MemoryAttributes['source']['from'], string> = {
  stated: 'Stated by a person',
  conversation: 'From a conversation',
  experiment: 'From an experiment',
  run: 'From runs',
  analysis: 'From an analysis',
  edits: 'From repeated edits',
};

/** A proposed memory's group in Review (M16): the detector that proposed it, or its source. */
function memoryOf(record: RecordEnvelope) {
  const a = record.attributes as MemoryAttributes;
  const by = record.createdBy;
  return {
    group:
      by.type === 'agent' && by.agentName.startsWith('Lab memory detector')
        ? by.agentName
        : FROM[a.source.from],
    strength: a.strength,
    ...(a.source.note ? { evidence: a.source.note } : {}),
  };
}

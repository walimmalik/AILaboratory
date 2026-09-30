import { readiness, summarizeReadiness } from '@ailab/domain';
import { type Actor, type ReviewItem, reviewList } from '@ailab/schema';
import { and, count, eq } from 'drizzle-orm';
import { records } from '../db/schema.ts';
import { RecordService } from '../records/service.ts';
import { listProposals } from './proposal-store.ts';
import { implement } from './registry.ts';

/**
 * How many drafts the inbox reads at most. The counts cover every draft, so the page can say what
 * was left out and open one kind at a time.
 */
const DRAFT_LIMIT = 200;

/** Who an item is for: the person an agent worked for, or the person who acted. */
const addressee = (actor: Actor) => (actor.type === 'agent' ? actor.onBehalfOf : actor.userId);

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
      const items: ReviewItem[] = [
        ...drafts.flatMap((record): ReviewItem[] => {
          const kind = kinds.get(record.kind);
          if (!kind) return [];
          const state = readiness(record, kind);
          // The stored summary includes checks that read other records (ADR 0050); older rows
          // written before it existed fall back to the kind's own checks.
          const summary = record.readiness ?? summarizeReadiness(state);
          const item: ReviewItem = {
            type: 'draft',
            tier: 'to_confirm',
            for: addressee(record.createdBy),
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
              summary.assumed === 0 &&
              summary.blockers === 0 &&
              summary.warnings === 0 &&
              summary.changed.length === 0,
            sectionsToConfirm: summary.sectionsLeft,
            missing: state.missing,
            ready: summary.ready,
            assumed: summary.assumed,
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
      ].filter((item) => !input.mine || item.for === me);
      return {
        items: items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
        counts: {
          total: draftTotal + changes.length,
          changes: changes.length,
          needsYou: changes.filter((p) => addressee(p.proposedBy) === me).length,
          drafts: draftCounts,
        },
      };
    },
  }),
];

import { readiness } from '@ailab/domain';
import { type ReviewItem, reviewList } from '@ailab/schema';
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
      const items: ReviewItem[] = [
        ...drafts.flatMap((record): ReviewItem[] => {
          const kind = kinds.get(record.kind);
          if (!kind) return [];
          const state = readiness(record, kind);
          const item: ReviewItem = {
            type: 'draft',
            at: record.updatedAt,
            record: {
              id: record.id,
              kind: record.kind,
              name: record.name,
              label: record.label,
              status: record.status,
              version: record.version,
              updatedBy: record.updatedBy,
            },
            sectionsToConfirm: state.sections
              .filter((s) => s.state === 'needs_review')
              .map((s) => s.title),
            missing: state.missing,
            ready: state.ready,
            assumed: state.assumed.length,
          };
          return [item];
        }),
        ...(input.kind ? [] : changes).map(
          (proposal): ReviewItem => ({
            type: 'change',
            at: proposal.proposedAt,
            proposal,
          }),
        ),
      ];
      return {
        items: items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
        counts: {
          total: draftTotal + changes.length,
          changes: changes.length,
          drafts: draftCounts,
        },
      };
    },
  }),
];

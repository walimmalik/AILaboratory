import { readiness } from '@ailab/domain';
import { type ReviewItem, reviewList } from '@ailab/schema';
import { RecordService } from '../records/service.ts';
import { listProposals } from './proposal-store.ts';
import { implement } from './registry.ts';

/** How many drafts the inbox reads at most; older drafts stay reachable from Records. */
const DRAFT_LIMIT = 200;

export const reviewOperations = [
  implement(reviewList, {
    run: async (ctx, _input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const drafts = await service.list(ctx, { status: 'draft', limit: DRAFT_LIMIT });
      const changes = await listProposals(deps.db, ctx, 'pending');
      // Drafts of a kind this lab no longer offers can't be confirmed, so they aren't waiting on anyone.
      const kinds = new Map(deps.kinds.list().map((k) => [k.kind, k]));
      const items: ReviewItem[] = [
        ...drafts.flatMap((record): ReviewItem[] => {
          const kind = kinds.get(record.kind);
          if (!kind) return [];
          const state = readiness(record, kind.sections ?? [], kind.checks ?? []);
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
        ...changes.map(
          (proposal): ReviewItem => ({
            type: 'change',
            at: proposal.proposedAt,
            proposal,
          }),
        ),
      ];
      return { items: items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)) };
    },
  }),
];

import { readiness, summarizeReadiness } from '@ailab/domain';
import {
  type Actor,
  type MemoryAttributes,
  type RecordEnvelope,
  type ReviewItem,
  reviewList,
} from '@ailab/schema';
import { and, count, eq } from 'drizzle-orm';
import { records } from '../db/schema.ts';
import { mentionsWaiting } from '../library/mentions.ts';
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
      const items: ReviewItem[] = [
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
          const memory = record.kind === 'memory' ? memoryOf(record) : undefined;
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
      ].filter((item) => !input.mine || item.for === me);
      items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      // Counts come first, so an agent whose view of a long result is cut still has the totals.
      return {
        counts: {
          total: draftTotal + changes.length + mentions.length,
          changes: changes.length,
          mentions: mentions.reduce((sum, m) => sum + m.proposed, 0),
          needsYou: changes.filter((p) => addressee(p.proposedBy) === me).length,
          drafts: draftCounts,
        },
        items: input.limit ? items.slice(0, input.limit) : items,
      };
    },
  }),
];

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

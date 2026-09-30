import type { RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { reviewQuery } from '../queries.ts';

/**
 * A record's state in plain words (plan 004d, R5): "draft · needs your review", "active",
 * "active · change waiting" or "archived".
 */
export function StatusChip({
  record,
  quiet,
}: {
  record: Pick<RecordEnvelope, 'id' | 'status'>;
  /** In lists: say nothing about an active record with no change waiting, the usual state. */
  quiet?: boolean;
}) {
  const items = useQuery(reviewQuery).data?.items ?? [];
  const changeWaiting = items.some(
    (i) =>
      i.type === 'change' && (i.proposal.input as { id?: unknown } | undefined)?.id === record.id,
  );
  const note =
    record.status === 'draft'
      ? 'needs your review'
      : record.status === 'active' && changeWaiting
        ? 'change waiting'
        : undefined;
  if (quiet && record.status === 'active' && !note) return null;
  return (
    <span className="status">
      <span className={`chip ${record.status}`}>{record.status}</span>
      {note && <span className="agent-ink status-note">{note}</span>}
    </span>
  );
}

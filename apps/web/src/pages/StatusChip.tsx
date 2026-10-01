import type { RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { proposalTouches } from '../lib/format.ts';
import { reviewQuery } from '../queries.ts';

/**
 * A record's review state in plain words, said once in its header (plan 004f N8): "draft · needs
 * your review", "confirmed", "confirmed · change waiting" or "archived". "Active" stays the stored
 * status; on screen it reads "confirmed".
 */
const STATUS_WORDS: Record<RecordEnvelope['status'], string> = {
  draft: 'draft',
  active: 'confirmed',
  archived: 'archived',
};

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
    (i) => i.type === 'change' && proposalTouches(i.proposal, record.id),
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
      <span className={`chip ${record.status}`}>{STATUS_WORDS[record.status]}</span>
      {note && <span className="agent-ink status-note">{note}</span>}
    </span>
  );
}

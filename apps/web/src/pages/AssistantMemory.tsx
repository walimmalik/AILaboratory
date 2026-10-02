import {
  type MemoryAttributes,
  type RecordEnvelope,
  recordsConfirm,
  type UsedMemory,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { strengthWords, usingLine } from '../lib/memory.ts';
import { recordQuery } from '../queries.ts';

/** The lab memories the assistant had for a turn (plan 005, M21): one folded grey line. */
export function UsedMemories({ memories }: { memories: UsedMemory[] }) {
  return (
    <details className="used-memory">
      <summary className="muted">{usingLine(memories)}</summary>
      <ul className="used-list">
        {memories.map((m) => (
          <li key={m.id}>
            {m.statement}{' '}
            <span className="muted">
              {strengthWords[m.strength as keyof typeof strengthWords] ?? m.strength}
            </span>{' '}
            <Link to="/records/$id" params={{ id: m.id }} className="mono">
              {m.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * "Remember this for the lab?" (M15, M21): a memory the assistant proposed, as a card. Confirm makes
 * it lab memory; Edit opens its page. It reads the record, so the card stays true after a reload.
 */
export function RememberCard({ proposed }: { proposed: RecordEnvelope }) {
  const queryClient = useQueryClient();
  const record = useQuery(recordQuery(proposed.id)).data;
  const confirm = useMutation({
    mutationFn: (current: RecordEnvelope) =>
      api.run(recordsConfirm, { id: current.id, expectedVersion: current.version }),
    onSuccess: () =>
      Promise.all(
        [['record', proposed.id], ['memory'], ['review']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const shown = record ?? proposed;
  const a = shown.attributes as MemoryAttributes;
  return (
    <div className="remember-card">
      <div className="muted">Remember this for the lab?</div>
      <p className="remember-statement">{a.statement}</p>
      <div className="muted">
        {strengthWords[a.strength]} · {a.kind}
        {a.when ? ` · when ${a.when}` : ''}
      </div>
      {shown.status === 'draft' ? (
        <div className="file-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!record || confirm.isPending}
            onClick={() => record && confirm.mutate(record)}
          >
            Confirm
          </button>
          <Link to="/records/$id" params={{ id: shown.id }} className="btn">
            Edit
          </Link>
        </div>
      ) : (
        <div>
          {shown.status === 'active' ? 'Remembered for the lab' : 'Retired'}{' '}
          <Link to="/records/$id" params={{ id: shown.id }} className="mono">
            {shown.name}
          </Link>
        </div>
      )}
      {confirm.error && <div className="error-text">{confirm.error.message}</div>}
    </div>
  );
}

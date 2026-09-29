import { ApiError } from '@ailab/client';
import {
  type Proposal,
  proposalsApprove,
  proposalsReject,
  type RecordEnvelope,
  type ReviewItem,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import {
  actorLabel,
  diffRecords,
  formatValue,
  formatWhen,
  operationIntent,
  operationVerb,
} from '../lib/format.ts';
import { decidedProposalsQuery, recordQuery, reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';

/**
 * Everything waiting for you (plan 004d): drafts to review and confirm, and changes agents proposed
 * to active records. Each line says what to do and opens where you do it.
 */
export function ReviewPage() {
  const waiting = useQuery(reviewQuery);
  const decided = useQuery(decidedProposalsQuery);
  const me = useMe();
  const items = waiting.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>review</b>
          </div>
          <h1>Review</h1>
          <p className="lede">
            Everything waiting for you. Agents draft new records and you confirm them section by
            section; changes to active records wait here until you confirm them.
          </p>
        </div>
      </div>

      <section className="block">
        <header>
          <h2>Waiting for you</h2>
          <span className={`state ${items.length ? 'agent-ink' : 'muted'}`}>
            {items.length} waiting
          </span>
        </header>
        <div className="body">
          {waiting.error && <p className="error-text">{waiting.error.message}</p>}
          {waiting.data?.length === 0 && (
            <p className="empty">Nothing waiting. Drafts and proposed changes appear here live.</p>
          )}
          {items.map((item) =>
            item.type === 'draft' ? (
              <WaitingDraft key={item.record.id} item={item} />
            ) : (
              <PendingProposal key={item.proposal.id} proposal={item.proposal} />
            ),
          )}
        </div>
      </section>

      <section className="block">
        <header>
          <h2>Decided changes</h2>
        </header>
        <div className="body">
          {decided.data?.length === 0 ? (
            <p className="empty">No decisions yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Proposed</th>
                    <th>By</th>
                    <th>Change</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.data?.map((p) => (
                    <tr key={p.id}>
                      <td className="when">{formatWhen(p.proposedAt)}</td>
                      <td className="agent-ink">{actorLabel(p.proposedBy, me)}</td>
                      <td>
                        {operationVerb(p.operationId)} <TargetName proposal={p} />
                      </td>
                      <td>
                        <span className={`chip ${p.status}`}>{decisionWords[p.status]}</span>
                        {p.error && <span className="crit-ink"> {p.error.message}</span>}
                        {p.decisionReason && <span className="muted"> · {p.decisionReason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const decisionWords: Record<Proposal['status'], string> = {
  pending: 'waiting',
  approved: 'confirmed',
  rejected: 'rejected',
  failed: 'failed',
};

/** A draft to review: what is left, and a link to its review. */
function WaitingDraft({ item }: { item: Extract<ReviewItem, { type: 'draft' }> }) {
  const me = useMe();
  const { record } = item;
  const todo = item.sectionsToConfirm.length
    ? `Confirm ${item.sectionsToConfirm.map((t) => t.toLowerCase()).join(' and ')}`
    : item.missing.length
      ? item.missing.join('; ')
      : 'Confirm it';
  return (
    <article className="proposal" aria-label={`Draft ${record.name}`}>
      <div className="line">
        <Link to="/records/$id" params={{ id: record.id }} className="mono">
          {record.name}
        </Link>
        <span>{record.label}</span>
        <span className="agent-ink">draft · needs your review</span>
        <span className="muted mono">{formatWhen(item.at)}</span>
      </div>
      <p className="reason">
        {todo}.
        {item.assumed > 0 && (
          <span className="agent-ink">
            {' '}
            {item.assumed === 1 ? 'One value is' : `${item.assumed} values are`} an estimate by{' '}
            {actorLabel(record.updatedBy, me)}.
          </span>
        )}
      </p>
      <div className="decide">
        <Link to="/records/$id" params={{ id: record.id }} className="btn primary">
          Review {record.name}
        </Link>
      </div>
    </article>
  );
}

function targetId(proposal: Proposal): string | undefined {
  const id = (proposal.input as { id?: unknown })?.id;
  return typeof id === 'string' ? id : undefined;
}

function previewRecord(proposal: Proposal): RecordEnvelope | undefined {
  const preview = proposal.preview as Partial<RecordEnvelope> | undefined;
  return preview && typeof preview === 'object' && 'attributes' in preview
    ? (preview as RecordEnvelope)
    : undefined;
}

function TargetName({ proposal }: { proposal: Proposal }) {
  const id = targetId(proposal);
  const preview = previewRecord(proposal);
  const name = preview?.name;
  if (id) {
    return (
      <Link to="/records/$id" params={{ id }} className="mono">
        {name ?? 'record'}
      </Link>
    );
  }
  return <span className="mono">{name ?? 'a new record'}</span>;
}

function PendingProposal({ proposal }: { proposal: Proposal }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const id = targetId(proposal);
  const current = useQuery({ ...recordQuery(id ?? ''), enabled: Boolean(id) });
  const after = previewRecord(proposal);
  const changes = diffRecords(id ? current.data : undefined, after);
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const input = { id: proposal.id, ...(note.trim() ? { reason: note.trim() } : {}) };
      return api.run(approve ? proposalsApprove : proposalsReject, input);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['proposals'] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
      ]),
  });
  const failed = decide.data?.status === 'failed' ? decide.data.error?.message : undefined;

  return (
    <article className="proposal" aria-label={`Change: ${operationIntent(proposal.operationId)}`}>
      <div className="line">
        <span className="agent-ink">{actorLabel(proposal.proposedBy, me)}</span>
        <span>
          wants to {operationIntent(proposal.operationId)} <TargetName proposal={proposal} />
        </span>
        <span className="muted mono">{formatWhen(proposal.proposedAt)}</span>
      </div>
      {proposal.reason && <p className="reason">“{proposal.reason}”</p>}

      {changes.length > 0 && (
        <table className="diff">
          <caption className="sr-only">What would change</caption>
          <thead>
            <tr>
              <th>Field</th>
              <th>Now</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <Change key={c.field} field={c.field} before={c.before} after={c.after} isNew={!id} />
            ))}
          </tbody>
        </table>
      )}
      {id && current.data && after && current.data.version + 1 !== after.version && (
        <p className="warn-ink">
          The record has changed since this was proposed; confirming will fail.
        </p>
      )}

      <div className="decide">
        <input
          className="field"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Decision note"
        />
        <button
          type="button"
          className="btn primary"
          disabled={decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          Confirm change
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          Reject
        </button>
      </div>
      {decide.error && (
        <p className="error-text">
          {decide.error instanceof ApiError ? decide.error.message : 'Something went wrong'}
        </p>
      )}
      {failed && <p className="error-text">Could not apply: {failed}</p>}
    </article>
  );
}

function Change({
  field,
  before,
  after,
  isNew,
}: {
  field: string;
  before: unknown;
  after: unknown;
  isNew: boolean;
}) {
  return (
    <tr>
      <td className="field-name">{field}</td>
      <td className={`before ${isNew || before === undefined ? 'none' : ''}`}>
        {isNew ? '—' : formatValue(before)}
      </td>
      <td className="after">{formatValue(after)}</td>
    </tr>
  );
}

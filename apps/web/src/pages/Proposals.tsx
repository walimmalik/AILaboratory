import { ApiError } from '@ailab/client';
import {
  type Proposal,
  proposalsApprove,
  proposalsReject,
  type RecordEnvelope,
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
import { decidedProposalsQuery, pendingProposalsQuery, recordQuery } from '../queries.ts';
import { useMe } from '../session.ts';

/** Changes agents asked for. A person looks at what would change and approves or rejects. */
export function ProposalsPage() {
  const pending = useQuery(pendingProposalsQuery);
  const decided = useQuery(decidedProposalsQuery);
  const me = useMe();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>proposals</b>
          </div>
          <h1>Proposals</h1>
          <p className="lede">
            Agents change drafts on their own. Changes to active records wait here until you approve
            them.
          </p>
        </div>
      </div>

      <section className="block">
        <header>
          <h2>Waiting for review</h2>
          <span className="state agent-ink">{pending.data?.length ?? 0} pending</span>
        </header>
        <div className="body">
          {pending.error && <p className="error-text">{pending.error.message}</p>}
          {pending.data?.length === 0 && (
            <p className="empty">Nothing waiting. Agent proposals appear here live.</p>
          )}
          {pending.data?.map((proposal) => (
            <PendingProposal key={proposal.id} proposal={proposal} />
          ))}
        </div>
      </section>

      <section className="block">
        <header>
          <h2>Decided</h2>
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
                        <span className={`chip ${p.status}`}>{p.status}</span>
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals'] }),
  });
  const failed = decide.data?.status === 'failed' ? decide.data.error?.message : undefined;

  return (
    <article
      className="proposal"
      aria-label={`Proposal to ${operationIntent(proposal.operationId)}`}
    >
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
          The record has changed since this was proposed; approving will fail.
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
          Approve
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

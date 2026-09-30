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
  formatWhen,
  operationIntent,
  operationVerb,
} from '../lib/format.ts';
import { kindPage } from '../lib/kinds.ts';
import { decidedProposalsQuery, recordQuery, reviewKindQuery, reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { fieldLabel } from './RecordReview.tsx';
import { renderValue } from './Value.tsx';

/**
 * Everything waiting for you (plan 004d): drafts to review and confirm, and changes agents proposed
 * to active records. Each line says what to do and opens where you do it.
 */
export function ReviewPage() {
  const waiting = useQuery(reviewQuery);
  const decided = useQuery(decidedProposalsQuery);
  const me = useMe();
  const all = waiting.data?.items ?? [];
  const counts = waiting.data?.counts;
  const total = counts?.total ?? 0;
  const [show, setShow] = useState('all');
  // One chip per kind of draft waiting, plus changes to active records, counted over everything
  // waiting rather than over the page of items read.
  // Proposed changes are all listed, so they are grouped here by the kind of record they touch.
  const groups = new Map<string, { label: string; count: number }>();
  for (const item of all) {
    if (item.type !== 'change') continue;
    const key = groupOf(item);
    const kind = changeKind(item.proposal);
    const label = kind ? `${kindPage(kind)?.title ?? kindWords(kind)}, proposed` : 'Other changes';
    groups.set(key, { label, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  for (const [kind, count] of Object.entries(counts?.drafts ?? {})) {
    groups.set(kind, { label: kindPage(kind)?.title ?? kindWords(kind), count });
  }
  const shown = show === 'all' || !groups.has(show) ? 'all' : show;
  // A kind whose drafts didn't all fit in the first page is read on its own.
  const loadedOf = (key: string) => all.filter((i) => groupOf(i) === key).length;
  const needsOwnPage =
    shown !== 'all' &&
    !shown.startsWith('changes') &&
    loadedOf(shown) < (groups.get(shown)?.count ?? 0);
  const ofKind = useQuery({ ...reviewKindQuery(shown), enabled: needsOwnPage });
  const items =
    shown === 'all'
      ? all
      : needsOwnPage
        ? (ofKind.data ?? [])
        : all.filter((i) => groupOf(i) === shown);
  const expected = shown === 'all' ? total : (groups.get(shown)?.count ?? 0);
  const leftOut = waiting.data && !(needsOwnPage && ofKind.isPending) ? expected - items.length : 0;

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
          <span className={`state ${total ? 'agent-ink' : 'muted'}`}>{total} waiting</span>
        </header>
        <div className="body">
          {(groups.size > 1 || total > all.length) && (
            <fieldset className="filters">
              <legend className="sr-only">Show</legend>
              <button type="button" aria-pressed={shown === 'all'} onClick={() => setShow('all')}>
                All <span className="num">{total}</span>
              </button>
              {[...groups].map(([key, group]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={shown === key}
                  onClick={() => setShow(key)}
                >
                  {group.label} <span className="num">{group.count}</span>
                </button>
              ))}
            </fieldset>
          )}
          {waiting.error && <p className="error-text">{waiting.error.message}</p>}
          {waiting.data && total === 0 && (
            <p className="empty">Nothing waiting. Drafts and proposed changes appear here live.</p>
          )}
          {items.map((item) =>
            item.type === 'draft' ? (
              <WaitingDraft key={item.record.id} item={item} />
            ) : (
              <PendingProposal key={item.proposal.id} proposal={item.proposal} />
            ),
          )}
          {leftOut > 0 && (
            <p className="muted">
              Showing the newest {items.length} of {expected}.{' '}
              {shown === 'all'
                ? 'Pick a kind above to see all of its drafts.'
                : 'Confirm some of these to see the rest.'}
            </p>
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

/** Drafts group by their kind; proposed changes form one group. */
/** A kind with no library page, in words: "entity_kind" → "Entity kind". */
function kindWords(kind: string): string {
  const words = kind.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function groupOf(item: ReviewItem): string {
  return item.type === 'change'
    ? `changes:${changeKind(item.proposal) ?? 'other'}`
    : item.record.kind;
}

/**
 * The kind of record a proposed change touches, read from its preview: the record itself, or the
 * first record the operation returned (a container for an inventory event, a lot for a receipt).
 */
function changeKind(proposal: Proposal): string | undefined {
  const isRecord = (v: unknown): v is { kind: string } =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { kind?: unknown }).kind === 'string' &&
    typeof (v as { id?: unknown }).id === 'string';
  const preview = proposal.preview;
  if (isRecord(preview)) return preview.kind;
  if (typeof preview === 'object' && preview !== null) {
    for (const value of Object.values(preview)) {
      if (isRecord(value)) return value.kind;
      if (Array.isArray(value) && isRecord(value[0])) return value[0].kind;
    }
  }
  const kind = (proposal.input as { kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' ? kind : undefined;
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
              <Change key={c.key} field={c.field} before={c.before} after={c.after} isNew={!id} />
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
      <td className="field-name">{fieldLabel(field)}</td>
      <td className={`before ${isNew || before === undefined ? 'none' : ''}`}>
        {isNew ? '—' : renderValue(before)}
      </td>
      <td className="after">{renderValue(after)}</td>
    </tr>
  );
}

import { ApiError } from '@ailab/client';
import {
  type Proposal,
  proposalsApprove,
  proposalsReject,
  type RecordEnvelope,
  type ReviewItem,
  recordsConfirmMany,
  recordsDeleteDraft,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { actorLabel, formatWhen, operationIntent, operationVerb } from '../lib/format.ts';
import { kindPage } from '../lib/kinds.ts';
import {
  decidedProposalsQuery,
  kindsQuery,
  recordQuery,
  reviewKindQuery,
  reviewQuery,
} from '../queries.ts';
import { useMe } from '../session.ts';
import { estimatesIn, ItemDiff, itemChanges } from './ItemDiff.tsx';

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
  const changes = all.filter((i) => i.type === 'change');
  const drafts = all.filter((i) => i.type === 'draft');
  const mentions = all.filter((i) => i.type === 'mentions');
  const draftTotal = Object.values(counts?.drafts ?? {}).reduce((sum, n) => sum + n, 0);
  const [show, setShow] = useState('all');
  // One chip per kind of draft waiting, counted over everything waiting rather than the page read.
  const groups = new Map<string, { label: string; count: number }>();
  for (const [kind, count] of Object.entries(counts?.drafts ?? {})) {
    groups.set(kind, { label: kindPage(kind)?.title ?? kindWords(kind), count });
  }
  const shown = show === 'all' || !groups.has(show) ? 'all' : show;
  // A kind whose drafts didn't all fit in the first page is read on its own.
  const loadedOf = (key: string) => drafts.filter((i) => i.record.kind === key).length;
  const needsOwnPage = shown !== 'all' && loadedOf(shown) < (groups.get(shown)?.count ?? 0);
  const ofKind = useQuery({ ...reviewKindQuery(shown), enabled: needsOwnPage });
  const items = (
    shown === 'all'
      ? drafts
      : needsOwnPage
        ? (ofKind.data ?? [])
        : drafts.filter((i) => i.record.kind === shown)
  ).filter((i): i is DraftItem => i.type === 'draft');
  const expected = shown === 'all' ? draftTotal : (groups.get(shown)?.count ?? 0);
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
            What needs you first, then drafts to confirm. Agents draft; you confirm what you read.
          </p>
        </div>
      </div>

      {waiting.error && <p className="error-text">{waiting.error.message}</p>}
      {waiting.data && changes.length + draftTotal + mentions.length === 0 && (
        <p className="empty">
          Nothing waiting. Drafts, proposed changes and library mentions appear here live.
        </p>
      )}

      {changes.length > 0 && (
        <section className="block" aria-label="Needs you">
          <header>
            <h2>Needs you</h2>
            <span className="state agent-ink">
              {changes.length} {changes.length === 1 ? 'change waits' : 'changes wait'} on you
            </span>
          </header>
          <div className="body">
            {changes.map(
              (item) =>
                item.type === 'change' && (
                  <PendingProposal key={item.proposal.id} proposal={item.proposal} />
                ),
            )}
          </div>
        </section>
      )}

      {draftTotal > 0 && (
        <section className="block" aria-label="To confirm">
          <header>
            <h2>To confirm</h2>
            <span className="state muted">
              {draftTotal} {draftTotal === 1 ? 'draft' : 'drafts'}
            </span>
          </header>
          <div className="body">
            {groups.size > 1 && (
              <fieldset className="filters">
                <legend className="sr-only">Show</legend>
                <button type="button" aria-pressed={shown === 'all'} onClick={() => setShow('all')}>
                  All <span className="num">{draftTotal}</span>
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
            <BatchConfirm items={items} />
            <DraftTable items={items} me={me} />
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
      )}

      {mentions.length > 0 && (
        <section className="block" aria-label="Library mentions">
          <header>
            <h2>Library mentions</h2>
            <span className="state muted">
              {counts?.mentions} to check in {mentions.length}{' '}
              {mentions.length === 1 ? 'document' : 'documents'}
            </span>
          </header>
          <div className="body">
            <p className="muted">
              What each document names: products, labware, instruments, assays and parameters. Check
              them on the document, where each sits beside its passage.
            </p>
            <div className="table-wrap">
              <table className="dense">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Mentions</th>
                    <th>Found</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mentions.map(
                    (item) =>
                      item.type === 'mentions' && (
                        <tr key={item.document.id} aria-label={`Mentions in ${item.document.name}`}>
                          <td>
                            <span className="mono">{item.document.name}</span> {item.document.label}
                          </td>
                          <td className="num">{item.proposed}</td>
                          <td className="when">{formatWhen(item.at)}</td>
                          <td className="row-actions">
                            <Link
                              to="/records/$id"
                              params={{ id: item.document.id }}
                              className="btn small"
                              aria-label={`Check mentions in ${item.document.name}`}
                            >
                              Check
                            </Link>
                          </td>
                        </tr>
                      ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

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
                        {operationVerb(p.operationId)}{' '}
                        {p.operationId === 'changes.apply' ? (
                          `(${stepsOf(p).length} changes)`
                        ) : (
                          <TargetName step={stepsOf(p)[0] as Step} />
                        )}
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

/** A kind with no library page, in words: "entity_kind" → "Entity kind". */
function kindWords(kind: string): string {
  const words = kind.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const decisionWords: Record<Proposal['status'], string> = {
  pending: 'waiting',
  approved: 'confirmed',
  rejected: 'rejected',
  failed: 'failed',
};

type DraftItem = Extract<ReviewItem, { type: 'draft' }>;

/**
 * Confirm the drafts in view that need no one's judgement in one press (plan 004e R3, review
 * 2026-10-01): those holding no guess, no failing blocker and no changed confirmed value. Warnings
 * are counted on the button's line, and the rest are named as left to open one by one.
 */
function BatchConfirm({ items }: { items: DraftItem[] }) {
  const queryClient = useQueryClient();
  const clean = items.filter((i) => i.batchable);
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsConfirmMany, {
        records: clean.map((i) => ({ id: i.record.id, expectedVersion: i.record.version })),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review'] }),
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['record'] }),
      ]),
  });
  if (clean.length < 2) return null;
  const left = items.length - clean.length;
  const warned = clean.filter((i) => i.warnings > 0).length;
  const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
  return (
    <div className="actions batch">
      <button
        type="button"
        className="btn primary"
        disabled={confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        {left === 0 ? `Confirm all ${clean.length}` : `Confirm the ${clean.length} ready ones`}
      </button>
      <span className="muted">
        {left === 0
          ? 'None holds an unverified value or a source to check, and nothing blocks them.'
          : `They hold no unverified value or source to check, and nothing blocks them; ${many(left, 'other opens', 'others open')} on its own.`}
        {warned > 0 && (
          <span className="warn-ink">
            {' '}
            {many(warned, 'has a warning', 'have warnings')}, confirmed as they stand.
          </span>
        )}
      </span>
      {confirm.error && <p className="error-text">{confirm.error.message}</p>}
    </div>
  );
}

/** Drafts as one dense row each: name, what it is, what is left, and the actions. */
function DraftTable({ items, me }: { items: DraftItem[]; me: ReturnType<typeof useMe> }) {
  if (items.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="dense">
        <thead>
          <tr>
            <th>Draft</th>
            <th>What is left</th>
            <th>Changed</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <DraftRow key={item.record.id} item={item} me={me} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DraftRow({ item, me }: { item: DraftItem; me: ReturnType<typeof useMe> }) {
  const queryClient = useQueryClient();
  const { record } = item;
  const discard = useMutation({
    mutationFn: () =>
      api.run(recordsDeleteDraft, {
        id: record.id,
        expectedVersion: record.version,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['review'] }),
  });
  const [sure, setSure] = useState(false);
  const parts = item.sectionsToConfirm;
  // What blocks the draft leads; the parts left to confirm are a count, named on hover.
  const toConfirm =
    parts.length === 0
      ? undefined
      : parts.length === 1
        ? `${parts[0]} to confirm`
        : `${parts.length} parts to confirm`;
  return (
    <tr aria-label={`Draft ${record.name}`}>
      <td>
        <Link to="/records/$id" params={{ id: record.id }} className="mono">
          {record.name}
        </Link>{' '}
        {record.label}
        {record.summary && <div className="muted">{record.summary}</div>}
      </td>
      <td>
        {item.blockers.join('; ')}
        {item.blockers.length > 0 && toConfirm && ' · '}
        {toConfirm && (
          <span title={parts.length > 1 ? parts.join(', ') : undefined}>{toConfirm}</span>
        )}
        {item.blockers.length === 0 && !toConfirm && 'Ready to confirm'}
        {item.assumed > 0 && <span className="agent-ink"> · {item.assumed} unverified</span>}
        {item.unchecked > 0 && (
          <span className="agent-ink">
            {' '}
            · {item.unchecked} {item.unchecked === 1 ? 'source' : 'sources'} to check
          </span>
        )}
      </td>
      <td className="when">
        {formatWhen(item.at)}
        <div className={record.updatedBy.type === 'agent' ? 'agent-ink' : 'muted'}>
          {actorLabel(record.updatedBy, me)}
        </div>
      </td>
      <td className="row-actions">
        <Link
          to="/records/$id"
          params={{ id: record.id }}
          className="btn small"
          aria-label={`Review ${record.name}`}
        >
          Review
        </Link>
        {item.byAgent &&
          (sure ? (
            <>
              <button
                type="button"
                className="btn small"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                Discard {record.name}
              </button>
              <button type="button" className="link-btn" onClick={() => setSure(false)}>
                keep
              </button>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setSure(true)}>
              Discard
            </button>
          ))}
        {discard.error && <div className="error-text">{discard.error.message}</div>}
      </td>
    </tr>
  );
}

/** One operation a proposal would run: the whole proposal, or one step of a change set (ADR 0051). */
interface Step {
  operation: string;
  input: unknown;
  output: unknown;
}

function stepsOf(proposal: Proposal): Step[] {
  if (proposal.operationId === 'changes.apply') {
    const results = (proposal.preview as { results?: Step[] } | undefined)?.results;
    return Array.isArray(results) ? results : [];
  }
  return [{ operation: proposal.operationId, input: proposal.input, output: proposal.preview }];
}

function targetId(input: unknown): string | undefined {
  const id = (input as { id?: unknown })?.id;
  return typeof id === 'string' ? id : undefined;
}

function asRecord(output: unknown): RecordEnvelope | undefined {
  return output && typeof output === 'object' && 'attributes' in output
    ? (output as RecordEnvelope)
    : undefined;
}

function TargetName({ step }: { step: Step }) {
  const id = targetId(step.input);
  const name = asRecord(step.output)?.name;
  if (id) {
    return (
      <Link to="/records/$id" params={{ id }} className="mono">
        {name ?? 'record'}
      </Link>
    );
  }
  return <span className="mono">{name ?? 'a new record'}</span>;
}

/**
 * What one step would change, row by row against the record as it is now (UI rule: a diff is rows
 * of what changed), with the agent's guesses marked and counted, since confirming accepts them.
 */
function StepChanges({ step }: { step: Step }) {
  const id = targetId(step.input);
  const current = useQuery({ ...recordQuery(id ?? ''), enabled: Boolean(id) });
  const kinds = useQuery(kindsQuery).data;
  const after = asRecord(step.output);
  if (!after) return null;
  const before = id ? current.data : undefined;
  if (id && !before) return null;
  const items = kinds?.find((k) => k.kind === after.kind)?.items ?? {};
  const changes = itemChanges(before, after, items);
  const estimates = estimatesIn(changes, after, items);
  return (
    <>
      <ItemDiff kind={after.kind} before={before} after={after} changes={changes} isNew={!id} />
      {estimates > 0 && (
        <p className="agent-ink">
          Confirming verifies {estimates} {estimates === 1 ? 'value' : 'values'} the agent entered
          without a source.
        </p>
      )}
      {id && current.data && current.data.version >= after.version && (
        <p className="warn-ink">
          The record has changed since this was proposed; confirming will fail.
        </p>
      )}
    </>
  );
}

function PendingProposal({ proposal }: { proposal: Proposal }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const steps = stepsOf(proposal);
  const isSet = proposal.operationId === 'changes.apply';
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
        {isSet ? (
          <span>wants to make {steps.length} changes together, all or none</span>
        ) : (
          steps[0] && (
            <span>
              wants to {operationIntent(proposal.operationId)} <TargetName step={steps[0]} />
            </span>
          )
        )}
        <span className="muted mono">{formatWhen(proposal.proposedAt)}</span>
      </div>
      {proposal.reason && <p className="reason">“{proposal.reason}”</p>}

      {isSet ? (
        <ol className="change-steps">
          {steps.map((step, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed, ordered list
            <li key={i}>
              {sentence(operationIntent(step.operation))} <TargetName step={step} />
              <StepChanges step={step} />
            </li>
          ))}
        </ol>
      ) : (
        steps[0] && <StepChanges step={steps[0]} />
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
          {isSet ? `Confirm all ${steps.length}` : 'Confirm change'}
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

/** A step of a change set starts its own line, so its words start with a capital. */
function sentence(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

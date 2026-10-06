import { ApiError } from '@ailab/client';
import {
  type DecisionEvidence,
  type Proposal,
  proposalsApprove,
  proposalsReject,
  RecordEnvelope,
  type ReviewItem,
  SopDefaultDecisionPreview,
} from '@ailab/schema';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { formatValue, formatWhen } from '../lib/format.ts';
import { conversationQuery, decidedProposalsQuery, reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';

function EvidenceText({ evidence: e }: { evidence: DecisionEvidence }) {
  const words = {
    assumed: 'assumed',
    stated: 'provided by the person',
    person: e.by === 'applying_person' ? 'entered by the applying person' : 'entered by a person',
    datasheet: 'from the datasheet',
    imported: 'imported',
    measured: 'measured',
    calculated: 'calculated',
    record: 'copied from a record',
    template: 'protocol default',
    memory: 'from lab memory',
  };
  return (
    <span>
      {words[e.source]}
      {e.note && ` (${e.note})`}
      {e.reference && ` · ${e.reference}`}
      {e.from && (
        <Link to="/records/$id" params={{ id: e.from.id }}>
          {' '}
          source record v{e.from.version}
        </Link>
      )}
    </span>
  );
}

export function supportedDecision(proposal: Proposal) {
  const parsed = SopDefaultDecisionPreview.safeParse(proposal.preview);
  return proposal.decision && parsed.success ? parsed.data : undefined;
}

/** Publish the returned persisted proposal immediately to both views, before refetching. */
export function publishDecision(client: QueryClient, proposal: Proposal) {
  client.setQueriesData<Proposal[]>({ queryKey: ['proposals'] }, (old) =>
    old?.map((p) => (p.id === proposal.id ? proposal : p)),
  );
  client.setQueryData<{ items: ReviewItem[] }>(
    reviewQuery.queryKey,
    (old) =>
      old && {
        ...old,
        items: old.items.flatMap((item) =>
          item.type === 'change' && item.proposal.id === proposal.id
            ? proposal.status === 'pending'
              ? [{ ...item, proposal }]
              : []
            : [item],
        ),
      },
  );
  client.setQueryData<Proposal[]>(decidedProposalsQuery.queryKey, (old) =>
    proposal.status === 'pending'
      ? old?.filter((p) => p.id !== proposal.id)
      : [...(old ?? []).filter((p) => p.id !== proposal.id), proposal],
  );
}

export async function decideSupported(proposal: Proposal, approve: boolean, note: string) {
  const input = { id: proposal.id, ...(note.trim() ? { reason: note.trim() } : {}) };
  if (approve) {
    if (!proposal.decision) throw new Error('The decision preview is unavailable');
    return api.run(proposalsApprove, {
      ...input,
      expectedPreview: proposal.decision.previewIdentity.digest,
    });
  }
  return api.run(proposalsReject, input);
}

type PreviewNotice = { id: string; digest: string };
export function previewNotice(
  returned: Proposal & { previewStatus?: 'stale' | 'refreshed' },
): PreviewNotice | undefined {
  return returned.status === 'pending' &&
    returned.decision &&
    'previewStatus' in returned &&
    (returned.previewStatus === 'stale' || returned.previewStatus === 'refreshed')
    ? { id: returned.id, digest: returned.decision.previewIdentity.digest }
    : undefined;
}
export function retainedPreviewNotice(notice: PreviewNotice | undefined, current: Proposal) {
  return current.status === 'pending' &&
    notice?.id === current.id &&
    notice.digest === current.decision?.previewIdentity.digest
    ? notice
    : undefined;
}
export function DecisionPreviewNotice({
  notice,
  proposal,
}: {
  notice: PreviewNotice | undefined;
  proposal: Proposal;
}) {
  return retainedPreviewNotice(notice, proposal) ? (
    <p className="warn-ink" role="status">
      Nothing was applied. The preview changed; review these values and click Apply decision again.
    </p>
  ) : null;
}

export function ProposalDecisionCard({
  proposal,
  busy = false,
}: {
  proposal: Proposal;
  busy?: boolean;
}) {
  const client = useQueryClient();
  const me = useMe();
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<PreviewNotice>();
  const lock = useRef(false);
  const latest = useRef(proposal);
  const waiting = useQuery({ ...reviewQuery, enabled: false }).data?.items;
  const decided = useQuery({ ...decidedProposalsQuery, enabled: false }).data;
  const origin = proposal.decision?.origin;
  const conversation = origin?.type === 'user_message' ? origin.conversation : undefined;
  // Chats are person-private; another lab reviewer relies on the approval operation's guard.
  const preparingPerson =
    proposal.proposedBy.type === 'agent'
      ? proposal.proposedBy.onBehalfOf
      : proposal.proposedBy.userId;
  const checkProducer = !!conversation && me?.user.id === preparingPerson;
  const producer = useQuery({
    ...conversationQuery(conversation ?? ''),
    enabled: checkProducer && proposal.status === 'pending',
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => decideSupported(latest.current, approve, note),
    onSuccess: async (returned) => {
      setNotice(previewNotice(returned));
      publishDecision(client, returned);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['proposals'] }),
        client.invalidateQueries({ queryKey: ['review'] }),
        client.invalidateQueries({ queryKey: ['record'] }),
        client.invalidateQueries({ queryKey: ['records'] }),
      ]);
    },
    onSettled: () => {
      lock.current = false;
    },
    onError: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['proposals'] }),
        client.invalidateQueries({ queryKey: ['review'] }),
      ]),
  });
  // Mutation output is an authoritative response, including a pending refreshed preview.
  const savedDecision = decided?.find((p) => p.id === proposal.id);
  const waitingDecision = waiting?.find(
    (i) => i.type === 'change' && i.proposal.id === proposal.id,
  );
  const shown =
    savedDecision ??
    (waitingDecision?.type === 'change' ? waitingDecision.proposal : undefined) ??
    decide.data ??
    proposal;
  latest.current = shown;
  useEffect(() => {
    setNotice((current) => retainedPreviewNotice(current, shown));
  }, [shown]);
  const preview = supportedDecision(shown);
  if (!preview) return null;
  const saved = RecordEnvelope.safeParse(shown.receipt?.output);
  const variables =
    saved.success && Array.isArray(saved.data.attributes.variables)
      ? (saved.data.attributes.variables as { name: string; value?: unknown }[])
      : [];
  const savedValue = variables.find((v) => v.name === preview.variable.name)?.value;
  const blocked =
    busy ||
    decide.isPending ||
    (!!conversation &&
      (!me ||
        (checkProducer &&
          (!!producer.error || !producer.data || producer.data.status === 'running'))));
  const apply = (approve: boolean) => {
    if (blocked || lock.current) return;
    lock.current = true;
    setNotice(undefined);
    decide.mutate(approve);
  };
  const pending = shown.status === 'pending';
  const checks = preview.after.readiness.checks;
  const evidence = preview.confirmation.evidence;
  return (
    <article
      className="proposal decision-card"
      aria-label={`Default change: ${preview.target.name}`}
    >
      <p>
        <Link to="/records/$id" params={{ id: preview.target.id }}>
          {preview.target.label} · {preview.target.name}
        </Link>
      </p>
      <p>
        <strong>{preview.variable.label}</strong>: {formatValue(preview.variable.before)} →{' '}
        {formatValue(preview.variable.after)}
      </p>
      <p>{preview.reason}</p>
      <p className="muted">
        Applying reviews the whole {preview.confirmation.section.title} section, including its other
        values. The SOP stays draft; final confirmation is separate. This does not establish
        scientific validity.
      </p>
      <details>
        <summary>Values included in this review</summary>
        {evidence.variables && (
          <p>
            Section origin: <EvidenceText evidence={evidence.variables} />.
          </p>
        )}
        {preview.confirmation.assumed.includes('variables') && (
          <p className="agent-ink">The Values section includes unverified estimates.</p>
        )}
        {preview.confirmation.unchecked.includes('variables') && (
          <p>The Values section has a source to check.</p>
        )}
        <ul>
          {preview.confirmation.section.after.variables.map((variable) => {
            const path = `/variables/${variable.name}`;
            const e = evidence[path];
            return (
              <li key={variable.name}>
                <strong>{variable.label}</strong>: {formatValue(variable.value)} ·{' '}
                {variable.kind === 'default'
                  ? 'planning default'
                  : variable.kind === 'record'
                    ? 'from a record'
                    : variable.kind === 'computed'
                      ? 'calculated'
                      : 'input'}
                {variable.note && <span> · {variable.note}</span>}
                {preview.confirmation.assumed.includes(path) && (
                  <span className="agent-ink"> · unverified estimate</span>
                )}
                {preview.confirmation.unchecked.includes(path) && (
                  <span> · source needs checking</span>
                )}
                {e && (
                  <span>
                    {' '}
                    · <EvidenceText evidence={e} />
                  </span>
                )}
                <details>
                  <summary>Technical value details</summary>
                  <pre>{JSON.stringify(variable, null, 2)}</pre>
                  {e && <pre>{JSON.stringify(e, null, 2)}</pre>}
                </details>
              </li>
            );
          })}
        </ul>
        <details className="tech">
          <summary>Section evidence details</summary>
          <pre>{JSON.stringify(evidence, null, 2)}</pre>
        </details>
      </details>
      <details>
        <summary>Checks and remaining questions ({preview.remainingQuestions} open)</summary>
        <ul>
          {checks.map((c) => (
            <li key={c.id}>
              {c.passed ? 'Pass' : 'Needs attention'}: {c.label}
              {c.message && ` · ${c.message}`} · {c.source}
            </li>
          ))}
        </ul>
        <ul>
          {preview.after.readiness.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <ul>
          {preview.questions.map((q) => (
            <li key={q.id}>
              {q.question} · {q.status} ·{' '}
              {q.stage === 'method' ? 'method' : q.stage === 'experiment' ? 'experiment' : 'run'}
            </li>
          ))}
        </ul>
      </details>
      {!decide.isPending && (
        <DecisionPreviewNotice notice={notice ?? previewNotice(shown)} proposal={shown} />
      )}
      {pending && (
        <div className="decide">
          <input
            className="field"
            aria-label="Decision note"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn primary"
            type="button"
            disabled={blocked}
            onClick={() => apply(true)}
          >
            Apply decision
          </button>
          <button
            className="btn danger"
            type="button"
            disabled={blocked}
            onClick={() => apply(false)}
          >
            Reject
          </button>
        </div>
      )}
      {pending && conversation && (!me || (checkProducer && !producer.data)) && (
        <p className="muted">Waiting to check whether the assistant has finished.</p>
      )}
      {pending && checkProducer && producer.error && (
        <p className="error-text">
          Could not check the assistant.{' '}
          <button type="button" className="link-btn" onClick={() => void producer.refetch()}>
            Try again
          </button>
        </p>
      )}
      {shown.status === 'approved' && shown.receipt && (
        <p role="status">
          Decision applied · saved {formatWhen(shown.receipt.committedAt)}.
          {saved.success && (
            <span>
              {' '}
              Recorded {preview.variable.label.toLowerCase()}: {formatValue(savedValue)} ·{' '}
              {saved.data.status === 'draft' ? 'still draft' : saved.data.status}.
            </span>
          )}{' '}
          <Link to="/records/$id" params={{ id: preview.target.id }}>
            Open saved SOP
          </Link>
        </p>
      )}
      {shown.status === 'approved' && !shown.receipt && (
        <p className="warn-ink">The saved result is unavailable.</p>
      )}
      {shown.status === 'rejected' && <p role="status">Decision rejected.</p>}
      {shown.status === 'failed' && (
        <p className="error-text">Could not apply: {shown.error?.message}</p>
      )}
      {pending && decide.error && (
        <p className="error-text">
          {decide.error instanceof ApiError
            ? decide.error.message
            : 'Could not save the decision. Check the saved proposal before trying again.'}
        </p>
      )}
      <details className="tech">
        <summary>Technical details</summary>
        <pre>
          {JSON.stringify(
            { id: shown.id, decision: shown.decision, receipt: shown.receipt },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

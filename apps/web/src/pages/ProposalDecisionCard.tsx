import { ApiError } from '@ailab/client';
import {
  type DecisionEvidence,
  type Proposal,
  proposalsApprove,
  proposalsReject,
  Quantity,
  RecordEnvelope,
  type ReviewItem,
  ScientificQuestion,
  SopDefaultDecisionPreview,
  SopDilutionDecisionPreview,
  SopInputDecisionPreview,
  SopMaterial,
  SopMaterialDecisionPreview,
} from '@ailab/schema';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { exactInstructionsSearch } from '../lib/exact-source.ts';
import { actorLabel, formatValue, formatWhen } from '../lib/format.ts';
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
  if (!proposal.decision) return undefined;
  const parsed = SopDefaultDecisionPreview.safeParse(proposal.preview);
  if (parsed.success) return parsed.data;
  const input = SopInputDecisionPreview.safeParse(proposal.preview);
  if (input.success) return input.data;
  const material = SopMaterialDecisionPreview.safeParse(proposal.preview);
  if (material.success) return material.data;
  const dilution = SopDilutionDecisionPreview.safeParse(proposal.preview);
  return dilution.success ? dilution.data : undefined;
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
      Nothing was applied. The preview changed; review this decision and click Apply decision again.
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
  const savedValue =
    preview.type === 'sop_volume_default'
      ? variables.find((v) => v.name === preview.variable.name)?.value
      : undefined;
  const question =
    preview.type !== 'sop_volume_default' &&
    saved.success &&
    saved.data.id === preview.target.id &&
    saved.data.kind === 'sop' &&
    Array.isArray(saved.data.attributes.questions)
      ? saved.data.attributes.questions
          .map((q) => ScientificQuestion.safeParse(q))
          .find((q) => q.success && q.data.id === preview.question.id)
      : undefined;
  const savedMaterial =
    preview.type === 'sop_experiment_material' &&
    saved.success &&
    Array.isArray(saved.data.attributes.materials)
      ? saved.data.attributes.materials
          .map((m) => SopMaterial.safeParse(m))
          .find((m) => m.success && m.data.role === preview.material.role)
      : undefined;
  const accepted =
    question?.success &&
    question.data.disposition.status === 'deferred' &&
    question.data.disposition.proposal === shown.id &&
    question.data.disposition.action.obligation.stage === 'experiment' &&
    ((preview.type === 'sop_experiment_input' &&
      question.data.disposition.action.obligation.binding.type === 'input' &&
      question.data.disposition.action.obligation.binding.variable === preview.input.name) ||
      (preview.type === 'sop_experiment_material' &&
        question.data.disposition.action.obligation.binding.type === 'material_role' &&
        question.data.disposition.action.obligation.binding.role === preview.material.role &&
        savedMaterial?.success &&
        savedMaterial.data.default === undefined))
      ? question.data
      : undefined;
  const savedFinal =
    preview.type === 'sop_dilution_final_volume'
      ? Quantity.safeParse(variables.find((v) => v.name === preview.completion.variable)?.value)
      : undefined;
  const resolved =
    preview.type === 'sop_dilution_final_volume' &&
    question?.success &&
    question.data.disposition.status === 'resolved' &&
    question.data.disposition.proposal === shown.id &&
    question.data.disposition.action.sop === preview.target.id &&
    question.data.disposition.action.question === preview.question.id &&
    JSON.stringify(question.data.disposition.action.completion) ===
      JSON.stringify(preview.completion) &&
    savedFinal?.success &&
    JSON.stringify(savedFinal.data) === JSON.stringify(preview.completion.value)
      ? question.data
      : undefined;
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
  return (
    <article
      className="proposal decision-card"
      aria-label={`${preview.type === 'sop_volume_default' ? 'Default change' : preview.type === 'sop_dilution_final_volume' ? 'Dilution final volume decision' : preview.type === 'sop_experiment_input' ? 'Experiment input decision' : 'Experiment material decision'}: ${preview.target.name}`}
    >
      <p>
        <Link to="/records/$id" params={{ id: preview.target.id }}>
          {preview.target.label} · {preview.target.name}
        </Link>
      </p>
      {preview.type === 'sop_volume_default' ? (
        <VolumeDecisionDetails preview={preview} />
      ) : preview.type === 'sop_dilution_final_volume' ? (
        <DilutionDecisionDetails preview={preview} />
      ) : (
        <ObligationDecisionDetails preview={preview} />
      )}
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
          {saved.success && preview.type === 'sop_volume_default' && (
            <span>
              {' '}
              Recorded {preview.variable.label.toLowerCase()}: {formatValue(savedValue)} ·{' '}
              {saved.data.status === 'draft' ? 'still draft' : saved.data.status}.
            </span>
          )}{' '}
          {preview.type === 'sop_dilution_final_volume' && (
            <span>
              {resolved ? (
                <>
                  Resolved selected method question: {resolved.question} Recorded final volume:{' '}
                  {formatValue(
                    variables.find((v) => v.name === preview.completion.variable)?.value,
                  )}
                  .{' '}
                  {saved.success && saved.data.status === 'draft'
                    ? 'SOP still draft; final confirmation is separate.'
                    : ''}
                </>
              ) : (
                'The saved method resolution is unavailable.'
              )}
            </span>
          )}
          {(preview.type === 'sop_experiment_input' ||
            preview.type === 'sop_experiment_material') &&
            (accepted ? (
              <span>
                {preview.type === 'sop_experiment_input'
                  ? 'Accepted as an experiment input'
                  : 'Accepted as an experiment material choice'}
                : {accepted.question} {preview.consequence}{' '}
                {saved.success && saved.data.status === 'draft'
                  ? 'SOP still draft; final confirmation is separate.'
                  : ''}
              </span>
            ) : (
              <span>
                The saved {preview.type === 'sop_experiment_input' ? 'input' : 'material-choice'}{' '}
                acceptance is unavailable.
              </span>
            ))}{' '}
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
            {
              id: shown.id,
              decision: shown.decision,
              preview: shown.preview,
              receipt: shown.receipt,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

function VolumeDecisionDetails({ preview }: { preview: SopDefaultDecisionPreview }) {
  const checks = preview.after.readiness.checks;
  return (
    <>
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
      <ValuesReview preview={preview} />
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
    </>
  );
}

function DilutionDecisionDetails({ preview }: { preview: SopDilutionDecisionPreview }) {
  const me = useMe();
  const c = preview.completion;
  const label =
    preview.confirmation.section.after.variables.find((v) => v.name === c.variable)?.label ??
    'Final volume';
  const after = preview.calculation.after;
  return (
    <>
      <p>
        <strong>{label}</strong>: Missing → {formatValue(c.value)}
      </p>
      <p>
        <strong>{preview.step.title}</strong> ·{' '}
        <a href={`/records/${preview.target.id}#sop-question-${preview.question.id}`}>
          {preview.question.question}
        </a>
      </p>
      <p>{preview.reason}</p>
      <p>
        Only this selected method question will be resolved. Applying reviews the whole{' '}
        {preview.confirmation.section.title} section, including its other values. The SOP stays
        draft; final confirmation is separate.
      </p>
      <p>
        Source-number agreement and dilution arithmetic are checked. By applying, you accept that
        this retained quotation supplies this final volume. This does not establish full assay
        validity or physical feasibility.
      </p>
      {preview.warnings.map((warning) => (
        <p className="warn-ink" key={warning}>
          {warning}
        </p>
      ))}
      <details>
        <summary>Instructions and dilution calculation</summary>
        <p>
          {c.source.title}
          {c.source.printedRevision && ` · ${c.source.printedRevision}`} ·{' '}
          <Link
            to="/library/instructions"
            search={exactInstructionsSearch(c.source, { passage: c.passage })}
          >
            Open retained passage
          </Link>
        </p>
        <p>
          {preview.passage.heading.join(' / ')}
          {preview.passage.page && ` · page ${preview.passage.page}`}
        </p>
        <blockquote className="text">{preview.passage.text}</blockquote>
        <p className="text">Selected quotation: {c.quote}</p>
        <p>Dilution factor unchanged: {c.factor.value}.</p>
        {preview.calculation.before.status === 'missing' && (
          <p>Before: calculation waits for the missing final volume.</p>
        )}
        {after.status === 'calculated' ? (
          <p>
            Calculated sample: {formatValue(after.sample)} · Diluent: {formatValue(after.diluent)} ·
            Recomposed volume: {formatValue(after.recomposed)} · Final volume:{' '}
            {formatValue(after.final)}.
          </p>
        ) : (
          <p>Calculation is unavailable.</p>
        )}
        <p>Saved responses</p>
        {preview.question.responses.length ? (
          <ol>
            {preview.question.responses.map((response) => (
              <li key={`${response.at}-${response.version}`}>
                <p className="text">{response.text}</p>
                <span className="muted">
                  Recorded by {actorLabel(response.by, me)} · {formatWhen(response.at)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No response recorded.</p>
        )}
      </details>
      <ValuesReview preview={preview} />
      <details>
        <summary>Checks and remaining questions ({preview.remainingQuestions} open)</summary>
        <ul>
          {preview.after.readiness.checks.map((check) => (
            <li key={check.id}>
              {check.passed ? 'Pass' : 'Needs attention'}: {check.label}
              {check.message && ` · ${check.message}`} · {check.source}
            </li>
          ))}
        </ul>
        <ul>
          {preview.after.readiness.missing.map((missing) => (
            <li key={missing}>{missing}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

function ObligationDecisionDetails({
  preview,
}: {
  preview: SopInputDecisionPreview | SopMaterialDecisionPreview;
}) {
  const me = useMe();
  const input = preview.type === 'sop_experiment_input' ? preview.input : undefined;
  const obligation = preview.acceptance.action.obligation;
  return (
    <>
      <p>
        <strong>
          {preview.type === 'sop_experiment_input'
            ? 'Accept as an experiment input'
            : 'Accept as an experiment material choice'}
        </strong>
      </p>
      <p className="text">{preview.question.question}</p>
      {preview.type === 'sop_experiment_material' && (
        <p>
          No actual material is selected by this decision. The declared requirements still need
          checking against the eventual choice.
        </p>
      )}
      <p>
        <strong>{preview.consequence}</strong> The method and its section reviews stay unchanged.
        The SOP stays draft; final confirmation is separate.
      </p>
      <p>{preview.reason}</p>
      <details>
        <summary>Question, responses and required {input ? 'input' : 'material choice'}</summary>
        <p className="text">{obligation.condition}</p>
        <p>Stage reason: {preview.question.stage.reason}</p>
        {preview.type === 'sop_experiment_material' && (
          <>
            <p>
              Material role: <strong>{preview.material.label}</strong> ·{' '}
              {preview.material.type === 'entity' ? 'biological entity' : preview.material.type}.
              The existing experiment stage and material-role binding stay unchanged.
            </p>
            {preview.material.requirements ? (
              <p className="text">Declared requirements: {preview.material.requirements}</p>
            ) : (
              <p className="muted">No additional requirements declared.</p>
            )}
            {preview.material.cite?.map((c) => (
              <p key={`${c.document}-${c.passage}-${c.page}-${c.quote}`}>
                Material source passage: {c.quote}
                {c.page && ` · page ${c.page}`}
              </p>
            ))}
          </>
        )}
        {input && (
          <>
            <p>
              Experiment input: <strong>{input.label}</strong>. The existing experiment stage and
              input binding stay unchanged.
            </p>
            {input.value !== undefined && (
              <p>
                Existing default: {formatValue(input.value)}. An explicit value is still required
                for each experiment.
              </p>
            )}
            {input.unit && <p>Unit: {input.unit}</p>}
            {input.min !== undefined && <p>Minimum: {formatValue(input.min)}</p>}
            {input.max !== undefined && <p>Maximum: {formatValue(input.max)}</p>}
            {input.note && <p className="text">{input.note}</p>}
            {input.drawsFrom && <p>Draws from: {input.drawsFrom}</p>}
            {input.readFrom && (
              <p>
                Read from: {input.readFrom.role} · {input.readFrom.field}
              </p>
            )}
            {input.cite?.map((c) => (
              <p key={`${c.document}-${c.passage}-${c.page}-${c.quote}`}>
                Input source passage: {c.quote}
              </p>
            ))}
          </>
        )}
        {preview.question.suggestion && (
          <p className="agent-ink">Suggested answer (assumed): {preview.question.suggestion}</p>
        )}
        {preview.question.passages?.map((c) => (
          <p key={`${c.document}-${c.passage}-${c.page}-${c.quote}`}>
            Question source passage: {c.quote}
          </p>
        ))}
        <p>Saved responses</p>
        {preview.question.responses.length === 0 ? (
          <p className="muted">No response recorded.</p>
        ) : (
          <ol>
            {preview.question.responses.map((response) => (
              <li key={`${response.at}-${response.version}`}>
                <p className="text">{response.text}</p>
                <span className="muted">
                  Recorded by {actorLabel(response.by, me)} · {formatWhen(response.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p>
          Prepared from an open question. Acceptance defers the obligation to each experiment; it
          {input ? ' does not supply its value.' : ' does not select a material.'}
        </p>
      </details>
      <details>
        <summary>Checks before and after this decision</summary>
        {(['before', 'after'] as const).map((phase) => (
          <div key={phase}>
            <p>{phase === 'before' ? 'Before acceptance' : 'After acceptance'}</p>
            <ul>
              {preview[phase].readiness.checks.map((c) => (
                <li key={c.id}>
                  {c.passed ? 'Pass' : 'Needs attention'}: {c.label}
                  {c.message && ` · ${c.message}`} · {c.source}
                </li>
              ))}
            </ul>
            <ul>
              {preview[phase].readiness.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </>
  );
}

function ValuesReview({
  preview,
}: {
  preview: SopDefaultDecisionPreview | SopDilutionDecisionPreview;
}) {
  const evidence = preview.confirmation.evidence;
  return (
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
  );
}

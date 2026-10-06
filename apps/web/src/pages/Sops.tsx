import {
  type Citation,
  ExactSourceReference,
  type RecordEnvelope,
  type ReviewFinding,
  type ScientificQuestion,
  type SopAttributes,
  type SopStep,
  type StepParameter,
  sopsAnswerQuestion,
  sopsCalculate,
  sopsCheckCitations,
  sopsReview,
  sopsReviews,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { exactInstructionsSearch } from '../lib/exact-source.ts';
import { formatValue } from '../lib/format.ts';
import { currentQuestions, questionDiscussion, stepQuestions } from '../lib/sop-questions.ts';
import { fieldWords, sopTerms } from '../lib/sop-text.ts';
import { recordQuery } from '../queries.ts';
import { Head, page as kindPage } from './AreaHead.tsx';
import { RecordList } from './Records.tsx';
import { describeSop, TermAnchor, TermCards } from './SopText.tsx';

/**
 * Digital SOP screens (plan 012d): the list, and on an SOP's page the procedure as a person reads
 * it at the bench, with its run values, open questions, and the checks against its source. A number
 * that comes from a value keeps the value's color, and hovering it says which value it is and where
 * it came from (ADR 0046). Editing and confirming are on the SOP page around these blocks (SopPage.tsx).
 */

const of = (r: RecordEnvelope) => r.attributes as SopAttributes;

export const actionWords: Record<SopStep['action'], string> = {
  add: 'Add',
  transfer: 'Transfer',
  serial_dilute: 'Serial dilution',
  mix: 'Mix',
  wash: 'Wash',
  incubate: 'Incubate',
  shake: 'Shake',
  spin: 'Spin',
  seal: 'Seal',
  peel: 'Peel',
  read: 'Read',
  image: 'Image',
  wait: 'Wait',
  make_solution: 'Make a solution',
  manual: 'By hand',
};

const fromWords = {
  input: 'set for this run',
  record: 'from the record',
  default: 'protocol default',
  typical: 'nominal value, until a lot is selected',
  computed: 'calculated',
  missing: 'missing',
} as const;

export function SopsPage() {
  return (
    <>
      <Head
        page={kindPage('sop')}
        lede="The lab's procedures as structured SOPs: steps, materials, values and formulas, each traced to its source, confirmed by a person before experiments use them."
      />
      <RecordList
        title="SOPs"
        kind="sop"
        placeholder="Find by title or name, e.g. ELISA or SOP-0001"
        empty="No SOPs yet. Ask the assistant to digitize a library document, or load the seed lab."
        columns={[
          {
            header: 'Assay',
            cell: (r) => of(r).assays?.join(', ') || '—',
            filled: (r) => !!of(r).assays?.length,
          },
          { header: 'Steps', cell: (r) => of(r).steps?.length ?? 0, className: 'num' },
          {
            header: 'Open questions',
            cell: (r) =>
              currentQuestions(r)?.filter((q) => q.disposition.status === 'open').length ??
              'Needs reconciliation',
            filled: (r) =>
              currentQuestions(r)?.some((q) => q.disposition.status === 'open') ?? true,
            className: 'num',
          },
        ]}
      />
    </>
  );
}

/** The blocks an SOP's page shows between its readiness and its details. */
export function SopBlocks({ record }: { record: RecordEnvelope }) {
  return (
    <>
      <ProcedureBlock record={record} />
      <QuestionsBlock record={record} />
      <SourceChecksBlock record={record} />
    </>
  );
}

const calculationQuery = (record: RecordEnvelope) => ({
  queryKey: ['record', record.id, 'sop', 'calculate', record.version],
  queryFn: () => api.run(sopsCalculate, { sop: record.id }),
});

function ProcedureBlock({ record }: { record: RecordEnvelope }) {
  const a = of(record);
  const questions = currentQuestions(record);
  const unfinished = questions?.filter(
    (q) => q.stage.stage === 'method' && q.disposition.status === 'open',
  );
  const clarificationNotice = !questions
    ? 'Question history needs reconciliation. We cannot determine whether this procedure is complete.'
    : unfinished && unfinished.length > 0
      ? 'Settle open method questions before final confirmation.'
      : undefined;
  const calc = useQuery(calculationQuery(record));
  // Values read as their numbers at the bench; names shows which value each number is.
  const [names, setNames] = useState(false);
  const values = new Map((calc.data?.variables ?? []).map((v) => [v.name, v]));
  const terms = useMemo(() => sopTerms(a), [a]);
  const runValue = (name: string) => {
    const v = values.get(name);
    if (!v?.ok) return undefined;
    return formatValue(v.quantity ?? v.number ?? v.list);
  };
  const assumed = (name: string) => {
    const from = values.get(name)?.from;
    return from === 'typical' || from === 'missing';
  };
  const describe = describeSop(a, terms, (name) => {
    const v = values.get(name);
    if (!v) return undefined;
    return {
      value: runValue(name) ?? v.error ?? 'no value yet',
      from: `${fromWords[v.from]}${v.source ? ` (${v.source.name}, ${fieldWords(v.source.field)})` : ''}`,
      assumed: assumed(name),
    };
  });
  /** A value in a step: its number, or its name; colored so it reads as a value, not typed text. */
  const valueAt = (name: string, key?: number) => {
    const label = terms.values.find((v) => v.name === name)?.label ?? name;
    return (
      <TermAnchor
        key={key}
        type="value"
        name={name}
        className={assumed(name) ? 'bench agent-ink' : 'bench'}
      >
        {names ? label : (runValue(name) ?? '…')}
      </TermAnchor>
    );
  };
  const materialAt = (role: string, key?: number) => (
    <TermAnchor key={key} type="material" name={role} className="bench">
      {terms.materials.find((m) => m.name === role)?.label ?? role}
    </TermAnchor>
  );
  const parameter = (p: StepParameter, i: number) => (
    <span key={`${p.name}-${i}`}>
      {i > 0 && ' · '}
      {p.name} {p.variable ? valueAt(p.variable) : formatValue(p.quantity ?? p.number ?? p.text)}
    </span>
  );
  // Step text names values and materials as `name`; at the bench each reads as its value or label.
  const inline = (text: string): ReactNode[] =>
    text.split(/`([A-Za-z_][A-Za-z0-9_]*)`/).map((part, i) => {
      if (i % 2 === 0) return part;
      if (terms.values.some((v) => v.name === part)) return valueAt(part, i);
      if (terms.materials.some((m) => m.name === part)) return materialAt(part, i);
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
      return <code key={i}>{part}</code>;
    });
  const shown = a.variables.filter((v) => values.get(v.name));
  const unsure = (calc.data?.variables ?? []).filter(
    (v) => v.from === 'typical' || v.from === 'missing' || !v.ok,
  );
  return (
    <section className="block sop-print" aria-label="At the bench">
      <header>
        <h2>At the bench</h2>
        <span className="state muted num">
          {a.steps.length} {a.steps.length === 1 ? 'step' : 'steps'}
          {unsure.length > 0 && ` · ${unsure.length} values to settle`}
        </span>
      </header>
      <TermCards describe={describe}>
        <div className="body">
          {(record.status === 'draft' || clarificationNotice) && (
            <p className="warn-ink">
              {record.status === 'draft' && 'Draft procedure — not confirmed for use.'}
              {record.status === 'draft' && clarificationNotice && ' '}
              {clarificationNotice}
            </p>
          )}
          {a.purpose && <p>{a.purpose}</p>}
          {a.variables.length > 0 && a.steps.length > 0 && (
            <fieldset className="segmented no-print bench-switch">
              <legend className="sr-only">Show values as</legend>
              <button type="button" aria-pressed={!names} onClick={() => setNames(false)}>
                Numbers
              </button>
              <button type="button" aria-pressed={names} onClick={() => setNames(true)}>
                Names
              </button>
            </fieldset>
          )}
          {a.steps.length === 0 ? (
            <p className="empty">No steps yet.</p>
          ) : (
            <ol className="sop-steps">
              {a.steps.map((s) => (
                <li key={s.id}>
                  <p className="sop-line">
                    {/* "By hand" on every manual step says nothing; other actions keep their word. */}
                    {(s.title ?? (s.action === 'manual' ? undefined : actionWords[s.action])) && (
                      <b>{s.title ?? actionWords[s.action]}. </b>
                    )}
                    {inline(s.text)}
                    {s.repeat && <span className="muted"> Repeat {s.repeat} times.</span>}
                    {!!stepQuestions(questions, s.id)?.length && (
                      <span className="sop-clarification-badge warn-ink">Needs clarification</span>
                    )}
                  </p>
                  {(s.parameters?.length || s.uses?.length) && (
                    <p className="sop-line muted sop-note">
                      {(s.parameters ?? []).map(parameter)}
                      {s.uses?.length ? (
                        <span>
                          {s.parameters?.length ? ' · ' : ''}uses{' '}
                          {s.uses.map((u, i) => (
                            <span key={u}>
                              {i > 0 && ', '}
                              {materialAt(u)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </p>
                  )}
                  <StepClarification record={record} questions={stepQuestions(questions, s.id)} />
                  <Cites cites={s.cite} source={a.source} />
                </li>
              ))}
            </ol>
          )}
          {shown.length > 0 && (
            <details open={unsure.length > 0}>
              <summary>Values for a run ({shown.length})</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Value</th>
                      <th>Amount</th>
                      <th>Where it comes from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => {
                      const result = values.get(v.name);
                      const assumed = result?.from === 'typical' || result?.from === 'missing';
                      return (
                        <tr key={v.name}>
                          <td>{v.label}</td>
                          <td className="num">
                            {result?.ok ? runValue(v.name) : (result?.error ?? '—')}
                          </td>
                          <td className={assumed ? 'agent-ink' : 'muted'}>
                            {result ? fromWords[result.from] : '—'}
                            {result?.source && ` (${result.source.name}, ${result.source.field})`}
                            {result?.problem && ` · ${result.problem}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {calc.error && <p className="error-text">{calc.error.message}</p>}
          <div className="actions no-print">
            <button type="button" className="btn" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      </TermCards>
    </section>
  );
}

function StepClarification({
  record,
  questions,
}: {
  record: RecordEnvelope;
  questions: ScientificQuestion[] | undefined;
}) {
  const assistant = useAssistant();
  if (!questions?.length) return null;
  const discuss = (id: string) => {
    const selected = questionDiscussion(record, id);
    if (selected) void assistant.send(selected.message, { context: selected.context });
  };
  return (
    <details className="sop-clarifications no-print">
      <summary className="cite-toggle">
        {questions.length} {questions.length === 1 ? 'question' : 'questions'} to clarify
      </summary>
      <ul className="sop-question-links" aria-label="Clarification questions">
        {questions.map((q) => (
          <li key={q.id}>
            <a href={`#sop-question-${q.id}`} aria-label={`Review question: ${q.question}`}>
              {q.question}
            </a>
            {' · '}
            <button
              type="button"
              className="link-btn"
              aria-label={`Discuss with assistant: ${q.question}`}
              disabled={assistant.sending || assistant.running}
              onClick={() => discuss(q.id)}
            >
              Discuss with assistant
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A step's source passages, folded away: page and quote. */
function savedExactSource(source: SopAttributes['source']) {
  const parsed = ExactSourceReference.safeParse(source?.exact);
  return parsed.success && parsed.data.document === source?.document ? parsed.data : undefined;
}

export function InstructionsUsed({ source }: { source: SopAttributes['source'] }) {
  if (!source) return null;
  const exact = savedExactSource(source);
  if (!exact)
    return (
      <p className="muted">
        {source.exact
          ? 'The saved instructions link is invalid; text could not be checked.'
          : 'Edition not established; text is unchecked.'}{' '}
        <SourceName id={source.document} />
      </p>
    );
  return (
    <p>
      Instructions used: <strong>{exact.title}</strong>
      {exact.printedRevision && ` · ${exact.printedRevision}`}{' '}
      <Link to="/library/instructions" search={exactInstructionsSearch(exact)}>
        Open instructions
      </Link>
      {exact.parse.status === 'unavailable' && (
        <span className="warn-ink"> · Text could not be checked.</span>
      )}
    </p>
  );
}

export function Cites({
  cites,
  source,
}: {
  cites: Citation[] | undefined;
  source?: SopAttributes['source'];
}) {
  if (!cites?.length) return null;
  const exact = savedExactSource(source);
  return (
    <details className="cites no-print">
      <summary className="cite-toggle">
        source{cites[0]?.page ? `, p. ${cites[0].page}` : ''}
      </summary>
      {cites.map((c) => (
        <blockquote key={`${c.document}-${c.passage ?? ''}-${c.quote}`}>
          “{c.quote}”{' '}
          {exact?.parse.status === 'parsed' && c.document === exact.document && c.passage ? (
            <Link
              to="/library/instructions"
              search={exactInstructionsSearch(exact, { passage: c.passage })}
            >
              Open cited passage
            </Link>
          ) : (
            <>
              <SourceName id={c.document} />
              <span className="muted">
                {' '}
                ·{' '}
                {exact?.parse.status === 'unavailable'
                  ? 'Text could not be checked'
                  : exact && c.document === exact.document
                    ? 'Passage not established; unchecked'
                    : 'Edition not established; unchecked'}
              </span>
            </>
          )}
          {c.page ? `, p. ${c.page}` : ''}
        </blockquote>
      ))}
    </details>
  );
}

function SourceName({ id }: { id: string }) {
  const { data } = useQuery(recordQuery(id));
  return (
    <Link to="/records/$id" params={{ id }} className="muted">
      {data ? data.label : 'Document record'}
    </Link>
  );
}

function useRefresh(record: RecordEnvelope) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['record', record.id] });
}

function QuestionsBlock({ record }: { record: RecordEnvelope }) {
  const questions = currentQuestions(record);
  if (!questions)
    return (
      <section className="block no-print" aria-label="Historical questions">
        <header>
          <h2>Historical questions</h2>
        </header>
        <div className="body">
          <p className="warn-ink">
            These questions need reconciliation before scientific use. Their original text and
            answers remain in History and technical details.
          </p>
        </div>
      </section>
    );
  const open = questions.filter((q) => q.disposition.status === 'open');
  if (questions.length === 0) return null;
  return (
    <section className="block no-print" aria-label="Questions to settle">
      <header>
        <h2>Questions to settle</h2>
        <span className="state muted num">
          {open.length === 0 ? 'no open questions' : `${open.length} open`}
        </span>
      </header>
      <div className="body">
        {open.length === 0 ? (
          <p className="muted">Every question has an accepted decision.</p>
        ) : (
          open.map((q) => <Question key={q.id} record={record} id={q.id} />)
        )}
        {questions.length > open.length && (
          <details>
            <summary>Accepted decisions ({questions.length - open.length})</summary>
            <ul>
              {questions
                .filter((q) => q.disposition.status !== 'open')
                .map((q) => (
                  <li key={q.id}>
                    {q.question} <b>{q.disposition.status}</b>
                    {q.disposition.status !== 'open' && (
                      <span> — {q.disposition.action.reason}</span>
                    )}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function Question({ record, id }: { record: RecordEnvelope; id: string }) {
  const q = currentQuestions(record)?.find((x) => x.id === id);
  const [answer, setAnswer] = useState('');
  const refresh = useRefresh(record);
  const settle = useMutation({
    mutationFn: (text: string) =>
      api.run(sopsAnswerQuestion, {
        sop: record.id,
        expectedVersion: record.version,
        question: id,
        action: { type: 'response', text: text.trim() },
      }),
    onSuccess: (_result, submitted) => {
      setAnswer((current) => (current === submitted ? '' : current));
      return refresh();
    },
  });
  if (!q) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (answer.trim()) settle.mutate(answer);
  };
  return (
    <form
      className="question"
      id={`sop-question-${q.id}`}
      onSubmit={submit}
      aria-label={q.question}
    >
      <p className="question-line">
        <b>{q.question}</b>
        {q.about?.step && <span className="muted"> · step {q.about.step}</span>}
      </p>
      {q.suggestion && <p className="question-line agent-ink">Suggested: {q.suggestion}</p>}
      <Cites cites={q.passages} source={of(record).source} />
      <p className="muted">
        {q.stage.stage === 'method'
          ? 'Method question'
          : q.stage.stage === 'run'
            ? 'Run preparation'
            : q.stage.binding.type === 'material_role'
              ? 'Experiment material'
              : 'Experiment input'}
        : {q.stage.reason}
      </p>
      {q.responses.length > 0 && (
        <div>
          <p className="warn-ink">Response received; the scientific issue remains open.</p>
          {q.responses.map((r) => (
            <p key={r.version}>{r.text}</p>
          ))}
        </div>
      )}
      <div className="actions">
        <label>
          <span className="sr-only">Your answer</span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Respond in your words"
          />
        </label>
        <button type="submit" className="btn" disabled={settle.isPending || !answer.trim()}>
          Record response
        </button>
      </div>
      {settle.error && <p className="error-text">{settle.error.message}</p>}
    </form>
  );
}

/** A reviewer's change in words: "Step 2 (Wash), volume: 400 µL → 300 µL". */
function whereWords(a: SopAttributes, path: string): string {
  const [section, index, ...rest] = path.slice(1).split('/');
  const i = Number(index);
  const tail = rest.filter((t) => Number.isNaN(Number(t))).join(' ');
  if (section === 'steps') {
    const step = a.steps[i];
    const param = rest[0] === 'parameters' ? step?.parameters?.[Number(rest[1])]?.name : undefined;
    return `Step ${i + 1}${step?.title ? ` (${step.title})` : ''}${param ? `, ${param}` : tail ? `, ${tail}` : ''}`;
  }
  if (section === 'variables')
    return `${a.variables[i]?.label ?? 'A value'}${tail ? `, ${tail}` : ''}`;
  if (section === 'materials')
    return `${a.materials[i]?.label ?? 'A material'}${tail ? `, ${tail}` : ''}`;
  if (section === 'questions') return 'A new question';
  return [section, ...rest].filter(Boolean).join(' ');
}

function SourceChecksBlock({ record }: { record: RecordEnvelope }) {
  const a = of(record);
  const refresh = useRefresh(record);
  const [checking, setChecking] = useState(false);
  const citations = useQuery({
    queryKey: ['record', record.id, 'sop', 'citations', record.version],
    queryFn: () => api.run(sopsCheckCitations, { sop: record.id }),
    enabled: checking,
  });
  const reviews = useQuery({
    queryKey: ['record', record.id, 'sop', 'reviews'],
    queryFn: () => api.run(sopsReviews, { sop: record.id }),
  });
  const review = useMutation({
    mutationFn: () => api.run(sopsReview, { sop: record.id, expectedVersion: record.version }),
    onSuccess: refresh,
  });
  const fixes = (reviews.data?.rounds ?? []).flatMap((r) =>
    r.findings.map((f, i) => ({ ...f, key: `${r.id}-${i}`, round: r.round })),
  );
  const problems = (citations.data?.citations ?? []).filter((c) => c.result !== 'matches');
  if (!a.source && a.steps.every((s) => !s.cite?.length) && fixes.length === 0) return null;
  return (
    <section className="block no-print" aria-label="Checks against the source">
      <header>
        <h2>Checks against the source</h2>
        {fixes.length > 0 && (
          <span className="state muted num">
            {fixes.filter((f) => f.type === 'fix').length} reviewer fixes
          </span>
        )}
      </header>
      <div className="body">
        <InstructionsUsed source={a.source} />
        {citations.data && (
          <p className={problems.length ? 'error-text' : 'muted'}>
            {citations.data.sourceStatus === 'unbound'
              ? 'Edition not established; quotes are unchecked.'
              : citations.data.sourceStatus === 'unavailable'
                ? 'Text could not be checked; quotes are unchecked.'
                : `${citations.data.matches} of ${citations.data.citations.length} quotes were found in the cited passages of the instructions used${problems.length > 0 ? `; ${problems.length} unchecked` : ''}. This checks the words, not scientific validity.`}
          </p>
        )}
        {problems.length > 0 && (
          <ul>
            {problems.map((c) => (
              <li key={`${c.where}-${c.quote}`}>
                {c.where}: “{c.quote}”{' '}
                <span className="muted">
                  {c.uncheckedReason === 'edition_not_established'
                    ? 'edition not established; unchecked'
                    : 'text could not be checked; unchecked'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {fixes.length > 0 && (
          <details open={fixes.length <= 5}>
            <summary>What the reviewer changed ({fixes.length})</summary>
            <ul className="reviewer-fixes">
              {fixes.map((f) => (
                <Finding key={f.key} a={a} finding={f} round={f.round} />
              ))}
            </ul>
          </details>
        )}
        {review.data && (
          <p className="muted">
            {review.data.stopped === 'clean'
              ? 'The reviewer has nothing more to change.'
              : review.data.stopped === 'failed'
                ? review.data.problem
                : `The reviewer ran ${review.data.rounds.length} rounds; run it again to continue.`}
          </p>
        )}
        {(citations.error ?? review.error) && (
          <p className="error-text">{(citations.error ?? review.error)?.message}</p>
        )}
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => (checking ? citations.refetch() : setChecking(true))}
          >
            Check the quotes
          </button>
          {record.status === 'draft' && (
            <button
              type="button"
              className="btn"
              disabled={review.isPending}
              onClick={() => review.mutate()}
            >
              {review.isPending ? 'The reviewer is reading…' : 'Have the reviewer check it'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Finding({
  a,
  finding,
  round,
}: {
  a: SopAttributes;
  finding: ReviewFinding;
  round: number;
}) {
  if (finding.type === 'question') {
    const q = finding.after as { question?: string } | undefined;
    return (
      <li className="agent-ink">
        Asked: {q?.question} <span className="muted">(round {round})</span>
      </li>
    );
  }
  return (
    <li className="agent-ink">
      {whereWords(a, finding.path)}: {formatValue(finding.before)} →{' '}
      {finding.after === undefined ? 'removed' : formatValue(finding.after)}.{' '}
      <span className="muted">
        {finding.reason}
        {finding.cite?.page ? `, p. ${finding.cite.page}` : ''} (round {round})
      </span>
    </li>
  );
}

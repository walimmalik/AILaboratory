import {
  type Readiness,
  type RecordEnvelope,
  recordsActivate,
  recordsConfirm,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { questionDiscussion } from '../lib/sop-questions.ts';
import { sopReadiness, sopReviewOutcome } from '../lib/sop-readiness.ts';
import { kindsQuery, readinessQuery } from '../queries.ts';
import { EditorScope, FormRow, type JsonSchema, ValueEditor } from './FieldEditor.tsx';
import { Checks, Estimates, fieldLabel } from './RecordReview.tsx';
import { EditForm, SaveBar, useFieldEdits } from './SectionEditor.tsx';
import { GuessContext, type Guesses, sopListEditors } from './SopEditors.tsx';
import { SopBlocks } from './Sops.tsx';

/**
 * An SOP's Overview (ADR 0046, plan 004f): what is left to do and one Confirm, and the procedure as
 * read at the bench; its parts are on the All fields tab. Edit opens the whole SOP as one form with one Save. Each part still
 * gets its own confirmation record; they show under technical details.
 */
export function SopPage({
  record,
  readiness,
  editing,
  onEdit: setEditing,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  /** The part to open the editor at, or undefined when reading; the record page holds it. */
  editing: string | undefined;
  onEdit: (part: string | undefined) => void;
}) {
  const titles = Object.fromEntries(readiness.sections.map((s) => [s.id, s.title]));
  if (editing)
    return <SopEditor record={record} focus={editing} onDone={() => setEditing(undefined)} />;
  return (
    <>
      <SopStatus
        record={record}
        readiness={readiness}
        titles={titles}
        onEdit={(part) => setEditing(part)}
      />
      <SopBlocks record={record} />
    </>
  );
}

/** Scientific decisions first; section review and final confirmation have explicit scopes. */
function SopStatus({
  record,
  readiness,
  titles,
  onEdit,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  titles: Record<string, string>;
  onEdit: (part: string) => void;
}) {
  const queryClient = useQueryClient();
  const assistant = useAssistant();
  const draft = record.status === 'draft';
  const review = sopReadiness(record, readiness);
  const { failing, toReview, confirmable, activates, canConfirm, methodQuestions } = review;
  const confirm = useMutation({
    mutationFn: (_review: { sections: { id: string; title: string }[]; partial: boolean }) =>
      confirmable.length === 0 && activates
        ? api.run(recordsActivate, { id: record.id, expectedVersion: readiness.version })
        : api.run(recordsConfirm, { id: record.id, expectedVersion: readiness.version }),
    onSuccess: () =>
      Promise.all(
        [['record', record.id], ['review'], ['records']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const remaining = review.summarized
    ? `${methodQuestions?.length} method ${methodQuestions?.length === 1 ? 'decision remains' : 'decisions remain'}${
        review.otherBlockers.length
          ? ` · ${review.otherBlockers.length} other ${review.otherBlockers.length === 1 ? 'blocker' : 'blockers'}`
          : ''
      }`
    : `${failing.length} ${failing.length === 1 ? 'check blocks' : 'checks block'} confirmation`;
  const state = !draft
    ? toReview.length === 0 && failing.length === 0
      ? { text: '✓ confirmed', tone: 'ok-ink' }
      : { text: 'changed since it was confirmed', tone: 'warn-ink' }
    : readiness.ready || (activates && canConfirm)
      ? { text: 'ready to confirm', tone: 'ok-ink' }
      : { text: remaining, tone: 'warn-ink' };
  const discuss = (id: string) => {
    const selected = questionDiscussion(record, id);
    if (selected) void assistant.send(selected.message, { context: selected.context });
  };
  const outcome =
    confirm.variables && confirm.data?.version === record.version
      ? sopReviewOutcome(confirm.data, confirm.variables.sections, confirm.variables.partial)
      : undefined;

  return (
    <section className="block no-print" aria-label="Readiness">
      <header>
        <h2>Readiness</h2>
        <span className={`state ${state.tone}`}>{state.text}</span>
      </header>
      <div className="body">
        <Estimates record={record} readiness={readiness} onOpen={(path) => onEdit(partFor(path))} />
        {!!methodQuestions?.length && (
          <>
            <p className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={assistant.sending || assistant.running}
                onClick={() => {
                  const first = methodQuestions[0];
                  if (first) discuss(first.id);
                }}
              >
                Resolve with assistant
              </button>
              <span className="muted">
                Settle method decisions; choose samples and run details later.
              </span>
            </p>
            <details className="sop-readiness-decisions">
              <summary>Choose a method decision ({methodQuestions.length})</summary>
              <ul className="sop-question-links" aria-label="Method decisions">
                {methodQuestions.map((q) => (
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
          </>
        )}
        {review.visibleChecks.some((c) => !c.passed) && (
          <Checks
            checks={review.visibleChecks.filter((c) => !c.passed)}
            titles={titles}
            onFix={onEdit}
            target={{ id: record.id, version: readiness.version }}
          />
        )}
        <div className="actions">
          {canConfirm && record.status !== 'archived' && (
            <button
              type="button"
              className={failing.length ? 'btn' : 'btn primary'}
              disabled={confirm.isPending}
              onClick={() => confirm.mutate({ sections: confirmable, partial: failing.length > 0 })}
            >
              {review.actionLabel}
            </button>
          )}
          {record.status !== 'archived' && (
            <button type="button" className="btn" onClick={() => onEdit('overview')}>
              Edit
            </button>
          )}
          {!outcome && <span className="muted">{review.before}</span>}
        </div>
        {outcome && <p role="status">{outcome}</p>}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        {readiness.checks.length > 0 && (
          <details className="sop-readiness-checks">
            <summary>All readiness checks</summary>
            <Checks
              checks={readiness.checks}
              titles={titles}
              onFix={onEdit}
              target={{ id: record.id, version: readiness.version }}
            />
          </details>
        )}
        <details className="tech">
          <summary>technical details</summary>
          <ul className="plain">
            {readiness.sections.map((s) => (
              <li key={s.id}>
                {s.title}: {s.state === 'confirmed' ? 'confirmed' : 'needs review'}
                {s.review && ` (last confirmed at version ${s.review.version})`}
              </li>
            ))}
          </ul>
          <pre className="json">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

/** The parts of the SOP a person edits, in the order they read it. Questions and sources are not. */
const parts: { id: string; title: string; fields: string[] }[] = [
  { id: 'overview', title: 'Overview', fields: ['purpose', 'scope', 'safety', 'assays', 'notes'] },
  { id: 'materials', title: 'Materials', fields: ['materials', 'solutions'] },
  { id: 'variables', title: 'Values', fields: ['variables'] },
  { id: 'procedure', title: 'Steps', fields: ['steps'] },
  {
    id: 'layout',
    title: 'Plate layout, timing and analysis',
    fields: ['layout', 'timing', 'analysis'],
  },
];
const whole = new Set(['materials', 'variables', 'steps']);
/** The editor's part for each readiness section, so "Fix in …" lands in the right place. */
const partOf: Record<string, string> = { analysis: 'layout', timing: 'layout' };

/** The editor part that holds a readiness path, so an estimate's name opens its box. */
function partFor(path: string): string {
  const field = path.startsWith('/') ? (path.split('/')[1] ?? '') : path;
  const part = parts.find((p) => p.fields.includes(field));
  return part?.id ?? partOf[field] ?? 'overview';
}

/** The whole SOP as one form: every part at once, one Save. */
function SopEditor({
  record,
  focus,
  onDone,
}: {
  record: RecordEnvelope;
  focus: string;
  onDone: () => void;
}) {
  const kinds = useQuery(kindsQuery).data;
  const definition = kinds?.find((k) => k.kind === record.kind);
  const readiness = useQuery(readinessQuery(record.id)).data;
  const guesses = useMemo(() => guessesOf(record, readiness), [record, readiness]);
  const edits = useFieldEdits(
    record,
    parts.flatMap((p) => p.fields),
    onDone,
  );
  useEffect(() => {
    if (!definition) return;
    const block = document.getElementById(`sop-edit-${partOf[focus] ?? focus}`);
    block?.scrollIntoView({ block: 'start' });
    block?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
  }, [definition, focus]);
  if (!definition) return <p className="empty">Loading…</p>;
  const root = definition.attributes as JsonSchema;
  const kindOfPrefix = Object.fromEntries(kinds?.map((k) => [k.idPrefix, k.kind]) ?? []);

  return (
    <GuessContext.Provider value={guesses}>
      <EditorScope
        root={root}
        kindOfPrefix={kindOfPrefix}
        hidden={new Set()}
        recordId={record.id}
        document={{ ...edits.base.attributes, ...edits.values }}
        listEditors={sopListEditors}
        onSuggested={edits.suggest}
      >
        <EditForm edits={edits} className="editor sop-edit">
          {parts.map((part) => (
            <section
              key={part.id}
              className="block"
              id={`sop-edit-${part.id}`}
              aria-label={part.title}
            >
              <header>
                <h2>{part.title}</h2>
              </header>
              <div className="body">
                {part.fields.map((field) => {
                  const schema = root.properties?.[field];
                  if (!schema) return null;
                  const editor = (
                    <ValueEditor
                      key={field}
                      schema={schema}
                      value={edits.values[field]}
                      onChange={(next) => edits.set(field, next)}
                      label={fieldLabel(field)}
                      path={field}
                    />
                  );
                  return whole.has(field) ? (
                    <div key={field}>{editor}</div>
                  ) : (
                    <div key={field} className="form-rows">
                      <FormRow label={fieldLabel(field)} hint={schema.description}>
                        {editor}
                        {guesses.get(field) &&
                          JSON.stringify(guesses.get(field)?.stored) ===
                            JSON.stringify(edits.values[field]) && (
                            <div className="agent-ink hint">
                              unverified · entered by an agent, no source
                              {guesses.get(field)?.note ? ` (${guesses.get(field)?.note})` : ''}
                            </div>
                          )}
                      </FormRow>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="save-bar">
            <SaveBar
              edits={edits}
              compact
              words={(f) => (f === 'variables' ? 'values' : fieldLabel(f))}
            />
          </div>
        </EditForm>
      </EditorScope>
    </GuessContext.Provider>
  );
}

/** The agent's estimates readiness names, with the value each held and the agent's note. */
function guessesOf(record: RecordEnvelope, readiness: Readiness | undefined): Guesses {
  const paths = new Set(readiness?.assumed ?? []);
  return {
    get: (path) => {
      if (!paths.has(path)) return undefined;
      const [list = '', key] = path.split('/').slice(1);
      const stored = path.startsWith('/')
        ? (record.attributes[list] as Record<string, unknown>[] | undefined)?.find((item) =>
            [item.id, item.name, item.role].includes(key),
          )
        : record.attributes[path];
      return { stored, note: record.evidence[path]?.note };
    },
  };
}

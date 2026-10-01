import {
  type Readiness,
  type RecordEnvelope,
  recordsActivate,
  recordsConfirm,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { kindsQuery, readinessQuery } from '../queries.ts';
import { EditorScope, FormRow, type JsonSchema, ValueEditor } from './FieldEditor.tsx';
import { Checks, Estimates, fieldLabel, SettledDetails } from './RecordReview.tsx';
import { EditForm, SaveBar, useFieldEdits } from './SectionEditor.tsx';
import { GuessContext, type Guesses, sopListEditors } from './SopEditors.tsx';
import { SopBlocks } from './Sops.tsx';

/**
 * An SOP's page (ADR 0046): what is left to do and one Confirm, the procedure as read at the bench,
 * and its parts folded below. Edit opens the whole SOP as one form with one Save. Each part still
 * gets its own confirmation record; they show under technical details.
 */
export function SopPage({
  record,
  readiness,
  renderValue,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  renderValue: (value: unknown) => ReactNode;
}) {
  // The part to open the editor at, or undefined when reading.
  const [editing, setEditing] = useState<string>();
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
      <SettledDetails
        record={record}
        readiness={readiness}
        titles={titles}
        renderValue={renderValue}
        onEdit={(part) => setEditing(part)}
        checks={false}
      />
    </>
  );
}

/** What stands between the SOP and the lab, and the one Confirm that clears what can be cleared. */
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
  const draft = record.status === 'draft';
  const failing = readiness.checks.filter((c) => !c.passed && c.severity === 'blocker');
  const held = new Set(failing.flatMap((c) => (c.section ? [c.section] : [])));
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review');
  const confirmable = toReview.filter((s) => !held.has(s.id));
  const waiting = toReview.filter((s) => held.has(s.id));
  // With nothing failing, confirming everything that waits makes a draft active.
  const activates = draft && failing.length === 0;
  const confirm = useMutation({
    mutationFn: () =>
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
  const canConfirm = confirmable.length > 0 || (activates && toReview.length === 0);
  const state = !draft
    ? toReview.length === 0 && failing.length === 0
      ? { text: '✓ confirmed', tone: 'ok-ink' }
      : { text: 'changed since it was confirmed', tone: 'warn-ink' }
    : readiness.ready || (activates && canConfirm)
      ? { text: 'ready to confirm', tone: 'ok-ink' }
      : { text: `${failing.length} to fix`, tone: 'warn-ink' };
  const words = (parts: typeof toReview) => parts.map((s) => s.title.toLowerCase()).join(', ');

  return (
    <section className="block no-print" aria-label="Readiness">
      <header>
        <h2>Readiness</h2>
        <span className={`state ${state.tone}`}>{state.text}</span>
      </header>
      <div className="body">
        <Estimates record={record} readiness={readiness} onOpen={(path) => onEdit(partFor(path))} />
        {readiness.checks.some((c) => !c.passed) && (
          <Checks
            checks={readiness.checks}
            titles={titles}
            onFix={onEdit}
            target={{ id: record.id, version: readiness.version }}
          />
        )}
        <div className="actions">
          {canConfirm && (
            <button
              type="button"
              className="btn primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {draft ? `Confirm ${record.name}` : 'Confirm the changes'}
            </button>
          )}
          {record.status !== 'archived' && (
            <button type="button" className="btn" onClick={() => onEdit('overview')}>
              Edit
            </button>
          )}
          <span className="muted">
            {canConfirm
              ? `${
                  confirmable.length === 0
                    ? 'Everything is confirmed.'
                    : confirmable.length === readiness.sections.length
                      ? 'Confirms the whole SOP as it stands.'
                      : `Confirms ${words(confirmable)} as they stand.`
                }${activates ? ` ${record.name} becomes active for the lab.` : ''}${
                  waiting.length
                    ? ` ${capital(words(waiting))} ${waiting.length === 1 ? 'waits' : 'wait'} for the fixes above.`
                    : ''
                }`
              : toReview.length > 0
                ? 'Fix what blocks it first.'
                : draft
                  ? 'Fix what blocks it, then confirm.'
                  : ''}
          </span>
        </div>
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
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

const capital = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;

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
                              agent's estimate
                              {guesses.get(field)?.note ? `: ${guesses.get(field)?.note}` : ''}
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

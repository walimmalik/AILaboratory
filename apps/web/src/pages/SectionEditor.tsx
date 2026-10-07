import { type EvidenceInput, type RecordEnvelope, recordsUpdate } from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { kindFieldWords } from '../lib/format.ts';
import { untouchedSuggestions } from '../lib/suggestions.ts';
import { kindsQuery } from '../queries.ts';
import { EditorScope, FormRow, type JsonSchema, ValueEditor } from './FieldEditor.tsx';
import { fieldLabel } from './RecordReview.tsx';

// "Calculated" is not offered: it names a calculator's result by its handle (ADR 0049), and a
// person's own arithmetic is entered by them.
type Source = 'person' | 'measured' | 'datasheet';
const sources: [Source, string][] = [
  ['person', 'Entered by me'],
  ['measured', 'Measured'],
  ['datasheet', 'From a datasheet'],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A person's edits to some of a record's values, saved as one `records.update` (the same change an
 * agent would make). Saving is checked against the version the editor opened on and writes only the
 * values the person changed; if the record changes meanwhile, the editor says so and can load the
 * new values, keeping the person's own.
 */
export function useFieldEdits(
  record: RecordEnvelope,
  fields: string[],
  onDone: () => void,
  onSaved?: (updated: RecordEnvelope) => void | Promise<void>,
) {
  // The version the person started from. Saving is checked against it, so a change someone else
  // makes while the editor is open is never silently written over.
  const [base, setBase] = useState(record);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f, record.attributes[f]])),
  );
  const [source, setSource] = useState<Source>('person');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  // List items the assistant filled in, as it filled them, with its reason (review 2026-10-01 I11).
  const [suggested, setSuggested] = useState<Record<string, { item: unknown; note: string }>>({});
  const form = useRef<HTMLFormElement>(null);
  // Values also change without a typed change event (a pick, a suggested fix), so validity is read
  // again after every change; fields set their own validity first, in their effects.
  useEffect(() => {
    if (values && form.current) setInvalid(!form.current.checkValidity());
  }, [values]);
  const queryClient = useQueryClient();

  const changed = fields.filter((f) => !same(values[f], base.attributes[f]));
  const theirs = record.version !== base.version;
  /** Take the newer version, keeping the values this person changed. */
  const takeTheirs = () => {
    setValues((v) =>
      Object.fromEntries(fields.map((f) => [f, changed.includes(f) ? v[f] : record.attributes[f]])),
    );
    setBase(record);
  };
  const save = useMutation({
    mutationFn: () => {
      const attributes: Record<string, unknown> = { ...base.attributes };
      for (const field of changed) {
        if (values[field] === undefined) delete attributes[field];
        else attributes[field] = values[field];
      }
      const given: EvidenceInput | undefined =
        source === 'person'
          ? undefined
          : {
              source,
              ...(reference.trim() ? { reference: reference.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            };
      const withValue = changed.filter((f) => values[f] !== undefined);
      const evidence: Record<string, EvidenceInput> = {
        ...(given ? Object.fromEntries(withValue.map((f) => [f, given])) : {}),
        ...untouchedSuggestions(suggested, attributes),
      };
      return api.run(recordsUpdate, {
        id: record.id,
        expectedVersion: base.version,
        attributes,
        ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
      });
    },
    onSuccess: async (updated) => {
      // Acknowledged save belongs to this editor. Close it and notify its host before
      // background reads can replace the shown record or report a stale workspace.
      onDone();
      await onSaved?.(updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['record', record.id] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
        queryClient.invalidateQueries({ queryKey: ['records'] }),
      ]);
    },
  });
  return {
    record,
    base,
    values,
    set: (field: string, next: unknown) => setValues((v) => ({ ...v, [field]: next })),
    suggest: (path: string, item: unknown, note: string) =>
      setSuggested((s) => ({ ...s, [path]: { item, note } })),
    changed,
    theirs,
    takeTheirs,
    save,
    invalid,
    setInvalid,
    form,
    source,
    setSource,
    reference,
    setReference,
    note,
    setNote,
    onDone,
  };
}

export type FieldEdits = ReturnType<typeof useFieldEdits>;

/** The form around edits: Save holds while a field is invalid; `children` are the fields. */
export function EditForm({
  edits,
  className,
  children,
}: {
  edits: FieldEdits;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      ref={edits.form as RefObject<HTMLFormElement>}
      className={className ?? 'editor'}
      // A field whose text can't be a value (not a number, not JSON) holds Save until it is fixed.
      onChange={(e) => edits.setInvalid(!e.currentTarget.checkValidity())}
      onSubmit={(e) => {
        e.preventDefault();
        edits.save.mutate();
      }}
    >
      {children}
    </form>
  );
}

/** Where the values came from; a small choice beside Save when `compact`. */
function WhereFrom({ edits, compact }: { edits: FieldEdits; compact?: boolean }) {
  const detail = (
    <>
      {edits.source === 'datasheet' && (
        <input
          className="field"
          type="text"
          aria-label="Datasheet"
          placeholder="A link, or the document's name"
          value={edits.reference}
          onChange={(e) => edits.setReference(e.target.value)}
        />
      )}
      {edits.source !== 'person' && (
        <input
          className="field"
          type="text"
          aria-label="Note"
          placeholder="e.g. page 2, or how it was worked out"
          value={edits.note}
          onChange={(e) => edits.setNote(e.target.value)}
        />
      )}
    </>
  );
  if (compact)
    return (
      <>
        <select
          className="field"
          aria-label="Where these values came from"
          value={edits.source}
          onChange={(e) => edits.setSource(e.target.value as Source)}
        >
          {sources.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </select>
        {detail}
      </>
    );
  return (
    <div className="form-rows">
      <FormRow label="where from">
        <fieldset className="segmented">
          <legend className="sr-only">Where these values came from</legend>
          {sources.map(([value, words]) => (
            <button
              key={value}
              type="button"
              aria-pressed={edits.source === value}
              onClick={() => edits.setSource(value)}
            >
              {words}
            </button>
          ))}
        </fieldset>
      </FormRow>
      {edits.source === 'datasheet' && (
        <FormRow label="datasheet" hint="A link, or the document's name">
          <input
            className="field grow"
            type="text"
            aria-label="Datasheet"
            value={edits.reference}
            onChange={(e) => edits.setReference(e.target.value)}
          />
        </FormRow>
      )}
      {edits.source !== 'person' && (
        <FormRow label="note" hint="e.g. page 2, calipers, or how it was worked out">
          <input
            className="field grow"
            type="text"
            aria-label="Note"
            value={edits.note}
            onChange={(e) => edits.setNote(e.target.value)}
          />
        </FormRow>
      )}
    </div>
  );
}

/** Save and Cancel, what changed, and a notice when the record moved on while editing. */
export function SaveBar({
  edits,
  compact,
  words = (field) => fieldLabel(field),
}: {
  edits: FieldEdits;
  /** Where-from as a small choice beside Save, not a row of its own. */
  compact?: boolean;
  words?: (field: string) => string;
}) {
  const { record, changed, theirs, invalid, save } = edits;
  return (
    <>
      {!compact && <WhereFrom edits={edits} />}
      {theirs && (
        <p className="warn-ink" role="alert">
          This record changed to version {record.version} while you were editing.{' '}
          <button type="button" className="link-btn" onClick={edits.takeTheirs}>
            Load the new values
          </button>{' '}
          (your own changes are kept) before saving.
        </p>
      )}
      <div className="actions">
        <button
          type="submit"
          className="btn primary"
          disabled={changed.length === 0 || theirs || invalid || save.isPending}
        >
          Save
        </button>
        <button type="button" className="btn" onClick={edits.onDone}>
          Cancel
        </button>
        {compact && <WhereFrom edits={edits} compact />}
        <span className="muted">
          {invalid
            ? 'Fix the field marked in red before saving.'
            : changed.length === 0
              ? 'Nothing changed yet.'
              : `Changes ${changed.map(words).join(', ')}.`}
        </span>
      </div>
      {save.error && <p className="error-text">{save.error.message}</p>}
    </>
  );
}

/**
 * Edit a group of a record's values in place, then say where the new values came from. Changed
 * values in a confirmed section need confirming again.
 */
export function SectionEditor({
  record,
  fields,
  notApplicable = [],
  onDone,
  onSaved,
}: {
  record: RecordEnvelope;
  fields: string[];
  /** Paths that don't apply to this record; left out unless they hold a value. */
  notApplicable?: string[];
  onDone: () => void;
  onSaved?: ((updated: RecordEnvelope) => void | Promise<void>) | undefined;
}) {
  const kinds = useQuery(kindsQuery).data;
  const definition = kinds?.find((k) => k.kind === record.kind);
  const edits = useFieldEdits(record, fields, onDone, onSaved);
  if (!definition) return <p className="empty">Loading…</p>;
  const root = definition.attributes as JsonSchema;
  const kindOfPrefix = Object.fromEntries(kinds?.map((k) => [k.idPrefix, k.kind]) ?? []);

  return (
    <EditorScope
      root={root}
      kindOfPrefix={kindOfPrefix}
      hidden={new Set(notApplicable)}
      document={{ ...edits.base.attributes, ...edits.values }}
    >
      <EditForm edits={edits}>
        <div className="form-rows">
          {fields.map((field) => {
            const schema = root.properties?.[field];
            if (!schema) return null;
            if (notApplicable.includes(field) && edits.values[field] === undefined) return null;
            return (
              <FormRow
                key={field}
                label={kindFieldWords(record.kind, field)}
                hint={schema.description}
              >
                <ValueEditor
                  schema={schema}
                  value={edits.values[field]}
                  onChange={(next) => edits.set(field, next)}
                  label={kindFieldWords(record.kind, field)}
                  path={field}
                />
              </FormRow>
            );
          })}
        </div>
        <SaveBar edits={edits} words={(field) => kindFieldWords(record.kind, field)} />
      </EditForm>
    </EditorScope>
  );
}

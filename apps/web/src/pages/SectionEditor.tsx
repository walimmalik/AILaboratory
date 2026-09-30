import { type EvidenceInput, type RecordEnvelope, recordsUpdate } from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { kindsQuery } from '../queries.ts';
import { EditorScope, FormRow, type JsonSchema, ValueEditor } from './FieldEditor.tsx';
import { fieldLabel } from './RecordReview.tsx';
import { sopItemEditors } from './SopEditors.tsx';

type Source = 'person' | 'measured' | 'datasheet' | 'calculated';
const sources: [Source, string][] = [
  ['person', 'Entered by me'],
  ['measured', 'Measured'],
  ['datasheet', 'From a datasheet'],
  ['calculated', 'Calculated'],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Edit a group of a record's values in place, then say where the new values came from. Saving runs
 * `records.update`, so it is the same change an agent would make; changed values in a confirmed section
 * need confirming again.
 */
export function SectionEditor({
  record,
  fields,
  notApplicable = [],
  onDone,
}: {
  record: RecordEnvelope;
  fields: string[];
  /** Paths that don't apply to this record; left out unless they hold a value. */
  notApplicable?: string[];
  onDone: () => void;
}) {
  const kinds = useQuery(kindsQuery).data;
  const definition = kinds?.find((k) => k.kind === record.kind);
  // The version the person started from. Saving is checked against it, so a change someone else
  // makes while the editor is open is never silently written over.
  const [base, setBase] = useState(record);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f, record.attributes[f]])),
  );
  const [source, setSource] = useState<Source>('person');
  const [reference, setReference] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [note, setNote] = useState('');
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
      return api.run(recordsUpdate, {
        id: record.id,
        expectedVersion: base.version,
        attributes,
        ...(given && withValue.length > 0
          ? { evidence: Object.fromEntries(withValue.map((f) => [f, given])) }
          : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['record', record.id] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
        queryClient.invalidateQueries({ queryKey: ['records'] }),
      ]);
      onDone();
    },
  });

  if (!definition) return <p className="empty">Loading…</p>;
  const root = definition.attributes as JsonSchema;
  const kindOfPrefix = Object.fromEntries(kinds?.map((k) => [k.idPrefix, k.kind]) ?? []);

  return (
    <EditorScope
      root={root}
      kindOfPrefix={kindOfPrefix}
      hidden={new Set(notApplicable)}
      document={{ ...base.attributes, ...values }}
      {...(record.kind === 'sop' ? { itemEditors: sopItemEditors } : {})}
    >
      <form
        className="editor"
        // A field whose text can't be a value (not a number, not JSON) holds Save until it is fixed.
        onChange={(e) => setInvalid(!e.currentTarget.checkValidity())}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-rows">
          {fields.map((field) => {
            const schema = root.properties?.[field];
            if (!schema) return null;
            if (notApplicable.includes(field) && values[field] === undefined) return null;
            return (
              <FormRow key={field} label={fieldLabel(field)} hint={schema.description}>
                <ValueEditor
                  schema={schema}
                  value={values[field]}
                  onChange={(next) => setValues((v) => ({ ...v, [field]: next }))}
                  label={fieldLabel(field)}
                  path={field}
                />
              </FormRow>
            );
          })}
        </div>
        <div className="form-rows">
          <FormRow label="where from">
            <fieldset className="segmented">
              <legend className="sr-only">Where these values came from</legend>
              {sources.map(([value, words]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={source === value}
                  onClick={() => setSource(value)}
                >
                  {words}
                </button>
              ))}
            </fieldset>
          </FormRow>
          {source === 'datasheet' && (
            <FormRow label="datasheet" hint="A link, or the document's name">
              <input
                className="field grow"
                type="text"
                aria-label="Datasheet"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </FormRow>
          )}
          {source !== 'person' && (
            <FormRow label="note" hint="e.g. page 2, calipers, or how it was worked out">
              <input
                className="field grow"
                type="text"
                aria-label="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormRow>
          )}
        </div>
        {theirs && (
          <p className="warn-ink" role="alert">
            This record changed to version {record.version} while you were editing.{' '}
            <button type="button" className="link-btn" onClick={takeTheirs}>
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
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
          <span className="muted">
            {invalid
              ? 'Fix the field marked in red before saving.'
              : changed.length === 0
                ? 'Nothing changed yet.'
                : `Changes ${changed.map(fieldLabel).join(', ')}.`}
          </span>
        </div>
        {save.error && <p className="error-text">{save.error.message}</p>}
      </form>
    </EditorScope>
  );
}

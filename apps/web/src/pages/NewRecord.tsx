import { type EvidenceInput, recordsCreate } from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { fieldLabel } from '../lib/format.ts';
import { kindNoun, kindPage } from '../lib/kinds.ts';
import { kindsQuery } from '../queries.ts';
import { EditorScope, FormRow, type JsonSchema, ValueEditor } from './FieldEditor.tsx';

/** Kinds a person adds by hand from their registry page (review 2026-10-01 item 14). */
export const NEW_KINDS = new Set(['product', 'lot', 'location', 'labware_type', 'vendor']);

/** "New product" beside a registry page's title: opens the form for a draft of that kind. */
export function NewRecordButton({ kind }: { kind: string }) {
  return (
    <Link to="/new/$kind" params={{ kind }} className="btn">
      New {kindNoun(kind)}
    </Link>
  );
}

/**
 * A person's own new record, drawn from the kind's schema like any editor (rule 2: the same
 * `records.create` an agent calls). The fields the kind requires come first; the rest fold under
 * "More fields". It is saved as a draft and opens on its page, where one Confirm makes it active.
 */
export function NewRecordPage() {
  const { kind } = useParams({ from: '/app/new/$kind' });
  const kinds = useQuery(kindsQuery).data;
  const definition = kinds?.find((k) => k.kind === kind);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reference, setReference] = useState('');
  const [invalid, setInvalid] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (values && form.current) setInvalid(!form.current.checkValidity());
  }, [values]);
  const create = useMutation({
    mutationFn: () => {
      const attributes = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== undefined),
      );
      const sheet: EvidenceInput | undefined = reference.trim()
        ? { source: 'datasheet', reference: reference.trim() }
        : undefined;
      return api.run(recordsCreate, {
        kind,
        label: label.trim(),
        attributes,
        ...(sheet
          ? { evidence: Object.fromEntries(Object.keys(attributes).map((f) => [f, sheet])) }
          : {}),
      });
    },
    onSuccess: async (record) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
      ]);
      await navigate({ to: '/records/$id', params: { id: record.id } });
    },
  });

  const page = kindPage(kind);
  const noun = kindNoun(kind);
  const head = (
    <div className="page-head">
      <div>
        <div className="crumbs">
          lab /{' '}
          {page ? (
            <Link to={page.path}>{page.title.toLowerCase()}</Link>
          ) : (
            kind.replaceAll('_', ' ')
          )}{' '}
          / <b>new</b>
        </div>
        <h1>New {noun}</h1>
        <p className="lede">
          Saved as a draft you can still change. Confirm it on its page when it is right.
        </p>
      </div>
    </div>
  );
  if (!NEW_KINDS.has(kind)) {
    return (
      <>
        {head}
        <p className="empty">A {noun} isn't added from a form; ask the assistant to draft one.</p>
      </>
    );
  }
  if (!definition) return <p className="empty">Loading…</p>;
  const root = definition.attributes as JsonSchema;
  const kindOfPrefix = Object.fromEntries(kinds?.map((k) => [k.idPrefix, k.kind]) ?? []);
  const fields = Object.keys(root.properties ?? {});
  const required = new Set(root.required ?? []);
  const row = (field: string) => {
    const schema = root.properties?.[field] as JsonSchema;
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
  };
  const rest = fields.filter((f) => !required.has(f));

  return (
    <>
      {head}
      <section className="block" aria-label={`New ${noun}`}>
        <div className="body">
          <EditorScope root={root} kindOfPrefix={kindOfPrefix} hidden={new Set()} document={values}>
            <form
              ref={form}
              className="editor"
              onChange={(e) => setInvalid(!e.currentTarget.checkValidity())}
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="form-rows">
                <FormRow label="name" hint="What the lab calls it">
                  <input
                    className="field grow"
                    type="text"
                    aria-label="Name"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </FormRow>
                {fields.filter((f) => required.has(f)).map(row)}
              </div>
              {rest.length > 0 && (
                <details className="more">
                  <summary className="more-head">More fields ({rest.length})</summary>
                  <div className="form-rows">{rest.map(row)}</div>
                </details>
              )}
              <div className="form-rows">
                <FormRow
                  label="datasheet"
                  hint="Optional: a link or document name the values come from; otherwise they are entered by you"
                >
                  <input
                    className="field grow"
                    type="text"
                    aria-label="Datasheet"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </FormRow>
              </div>
              <div className="actions">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!label.trim() || invalid || create.isPending}
                >
                  Save draft
                </button>
                {page && (
                  <Link to={page.path} className="btn">
                    Cancel
                  </Link>
                )}
                <span className="muted">
                  {invalid ? 'Fix the field marked in red first.' : 'Opens the draft when saved.'}
                </span>
              </div>
              {create.error && <p className="error-text">{create.error.message}</p>}
            </form>
          </EditorScope>
        </div>
      </section>
    </>
  );
}

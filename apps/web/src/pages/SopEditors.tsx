import {
  MATERIAL_KINDS,
  type SopMaterial,
  type SopStep,
  type SopVariable,
  type StepParameter,
  sopsEvaluate,
  sopsSuggest,
} from '@ailab/schema';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { formatValue } from '../lib/format.ts';
import { type NamedValue, nameFor, readSetting } from '../lib/formulas.ts';
import { type JsonSchema, resolve, valueText as schemaValueText } from '../lib/json-schema.ts';
import {
  kindWords,
  plainValue,
  readValue,
  readWords,
  sopTerms,
  type Terms,
  type ValueFields,
  valueText,
  withWords,
  wordsText,
} from '../lib/sop-text.ts';
import { recordsQuery } from '../queries.ts';
import {
  FormRow,
  type ItemEditorProps,
  type ListEditorProps,
  useEditorScope,
  ValueEditor,
} from './FieldEditor.tsx';
import { actionWords } from './Sops.tsx';
import { describeSop, TermAnchor, TermBox, TermCards } from './SopText.tsx';

/**
 * An SOP's values and steps as a scientist edits them (plan 012, ADR 0046). A value is its name and
 * one highlighted box: what is written there decides its kind (a number, a formula, a material's
 * field), shown as a couple of words beside it. A step is one line (action, name, times) and its
 * words in the same box; the materials and settings it uses are read from the words. Agents still
 * see and write the stored form.
 */

type Item = Record<string, unknown>;

/**
 * The agent's estimates in the SOP being edited (rule 6, review 2026-10-01): by readiness path, the
 * value as stored and the agent's note. A box still holding that value is marked in agent ink;
 * once a person types over it, it is theirs.
 */
export interface Guesses {
  get(path: string): { stored: unknown; note?: string | undefined } | undefined;
}
export const GuessContext = createContext<Guesses>({ get: () => undefined });

/** The agent's note when this item still holds the agent's estimate, '' without one. */
function useGuess(path: string | undefined, now: unknown): string | undefined {
  const guess = useContext(GuessContext).get(path ?? '');
  if (!path || !guess || JSON.stringify(guess.stored) !== JSON.stringify(now)) return undefined;
  return guess.note ?? '';
}

/** "unverified: entered by an agent without a source", with the agent's note when it gave one. */
function GuessNote({ note }: { note: string | undefined }) {
  if (note === undefined) return null;
  return (
    <span className="agent-ink">
      unverified · entered by an agent, no source{note ? ` (${note})` : ''}
    </span>
  );
}

/** The SOP as edited so far, and the names its text can use. */
function useSop() {
  const { document = {}, root } = useEditorScope();
  const list = <T,>(key: string) => (Array.isArray(document[key]) ? document[key] : []) as T[];
  const variables = list<Partial<SopVariable>>('variables');
  const doc = {
    variables,
    materials: list<never>('materials'),
    solutions: list<never>('solutions'),
    steps: list<Partial<SopStep>>('steps'),
  };
  return { root, doc, variables, steps: doc.steps };
}

type Target = { value: string } | { step: string } | { newStep: string } | { steps: true };

/**
 * The assistant's fill-in (`sops.suggest`) for part of the SOP as edited so far. It writes nothing;
 * the editor shows what comes back in agent ink until a person changes or saves it.
 */
function useSuggest() {
  const { document = {}, recordId } = useEditorScope();
  const ask = useMutation({
    mutationFn: (target: Target) =>
      api.run(sopsSuggest, { sop: recordId ?? '', attributes: document, ...target }),
  });
  return { ...ask, available: !!recordId };
}

const without = (item: Item) => {
  const next = { ...item };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next;
};

function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type Result = {
  ok: boolean;
  number?: string;
  quantity?: unknown;
  list?: unknown;
  error?: string;
  waitsOn?: string[];
};

/**
 * Every value's result from the calculator, with the values as edited so far; a value read from a
 * material uses its typical value until one is picked. Never worked out in the browser.
 */
function useResults(variables: readonly Partial<SopVariable>[]) {
  type Given = { name: string; expression?: string; unit?: string; value?: SopVariable['value'] };
  const given = variables.flatMap((v): Given[] => {
    if (!v.name) return [];
    if (v.kind === 'computed' && v.expression)
      return [{ name: v.name, expression: v.expression, ...(v.unit ? { unit: v.unit } : {}) }];
    return v.value === undefined ? [] : [{ name: v.name, value: v.value }];
  });
  const input = useDebounced(JSON.stringify({ variables: given }));
  const query = useQuery({
    queryKey: ['sops.evaluate', input],
    queryFn: () => api.run(sopsEvaluate, JSON.parse(input)),
    enabled: given.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const results = new Map<string, Result>(
    (query.data?.variables ?? []).map((r) => [r.name, r as Result]),
  );
  return { results, error: query.error?.message };
}

const labelOf = (terms: Terms, name: string) =>
  terms.values.find((v) => v.name === name)?.label ?? name;

/** A result in words: "10.56 mL", "needs Wells first" or why it has none. */
function resultWords(
  r: Result | undefined,
  terms: Terms,
): { text: string; ok: boolean } | undefined {
  if (!r) return undefined;
  if (r.ok) return { text: formatValue(r.quantity ?? r.number ?? r.list), ok: true };
  if (r.waitsOn?.length)
    return { text: `needs ${r.waitsOn.map((n) => labelOf(terms, n)).join(', ')} first`, ok: false };
  return { text: r.error ?? 'no result yet', ok: false };
}

/** Hover cards for the SOP being edited, with each value as it works out now. */
function EditorCards({
  doc,
  results,
  children,
}: {
  doc: ReturnType<typeof useSop>['doc'];
  results: Map<string, Result>;
  children: ReactNode;
}) {
  const terms = useMemo(() => sopTerms(doc), [doc]);
  const describe = describeSop(doc, terms, (name) => {
    const w = resultWords(results.get(name), terms);
    return w && { value: w.text };
  });
  return <TermCards describe={describe}>{children}</TermCards>;
}

// ---- Values ----

/** The fields a value's text sets, keeping those it doesn't (its name, note, sources). */
function withFields(v: Partial<SopVariable>, f: ValueFields): Item {
  return without({
    ...v,
    kind: f.kind,
    // A value read from a material keeps its typical value; any other takes what was written.
    value: f.kind === 'record' ? (v.kind === 'record' ? v.value : undefined) : f.value,
    expression: f.expression,
    readFrom: f.readFrom,
    unit: f.kind === 'computed' ? v.unit : undefined,
    min: f.kind === 'input' ? v.min : undefined,
    max: f.kind === 'input' ? v.max : undefined,
  });
}

/** The SOP's values, one line each: its name, =, and one box for a number, formula or field. */
function ValuesEditor({ value, onChange }: ListEditorProps) {
  const { doc } = useSop();
  const items = (Array.isArray(value) ? value : []) as Partial<SopVariable>[];
  const { results, error } = useResults(items);
  // Keys follow the rows, so a row's typing stays with it when another is removed.
  const [keys, setKeys] = useState(() => items.map((_, i) => i));
  const [next, setNext] = useState(items.length);
  const update = (nextItems: Partial<SopVariable>[], nextKeys = keys) => {
    setKeys(nextKeys);
    onChange(nextItems.length ? nextItems : undefined);
  };
  return (
    <EditorCards doc={{ ...doc, variables: items }} results={results}>
      <div className="values">
        {items.length === 0 && <p className="muted">No values yet.</p>}
        {items.map((v, i) => (
          <ValueRow
            key={keys[i]}
            value={v}
            index={i}
            items={items}
            doc={doc}
            result={v.name ? results.get(v.name) : undefined}
            onChange={(changed) =>
              update(items.map((x, j) => (j === i ? (changed as Partial<SopVariable>) : x)))
            }
            onRemove={() =>
              update(
                items.filter((_, j) => j !== i),
                keys.filter((_, j) => j !== i),
              )
            }
          />
        ))}
        {error && <p className="error-text">{error}</p>}
        <div className="values-foot">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setNext(next + 1);
              update([...items, { kind: 'default' }], [...keys, next]);
            }}
          >
            Add value
          </button>
          <span className="term-legend muted">
            <span className="t-val">value</span> of this SOP <span className="t-mat">material</span>{' '}
            read as Material.field <span className="t-unk">unknown</span> pick or fix ·{' '}
            <kbd>Tab</kbd> takes a pick
          </span>
        </div>
      </div>
    </EditorCards>
  );
}

function ValueRow({
  value: v,
  index,
  items,
  doc,
  result,
  onChange,
  onRemove,
}: {
  value: Partial<SopVariable>;
  index: number;
  items: readonly Partial<SopVariable>[];
  doc: ReturnType<typeof useSop>['doc'];
  result: Result | undefined;
  onChange: (next: Item) => void;
  onRemove: () => void;
}) {
  const [fresh] = useState(() => !v.name);
  const [open, setOpen] = useState(false);
  const terms = useMemo(() => sopTerms({ ...doc, variables: items }, v.name), [doc, items, v.name]);
  // What is typed stays as typed while the box is in use; after, it reads back from what is stored.
  const [draft, setDraft] = useState<string>();
  const text = draft ?? valueText(v, terms);
  const perRun = v.kind === 'input';
  const read = readValue(text, terms, perRun);
  const set = (patch: Item) => onChange(without({ ...v, ...patch }));
  const taken = new Set(items.flatMap((o, i) => (i !== index && o.name ? [o.name] : [])));
  const plain = v.kind === 'input' || v.kind === 'default';
  const shown = resultWords(result, terms);
  const called = v.label || 'This value';
  const suggest = useSuggest();
  // The assistant's reason while its suggestion stands; typing over it makes it the person's.
  const [suggested, setSuggested] = useState<string>();
  const guess = useGuess(v.name && `/variables/${v.name}`, v);
  const fillIn = () =>
    v.name &&
    suggest.mutate(
      { value: v.name },
      {
        onSuccess: (out) => {
          if (!out.variable) return;
          setDraft(undefined);
          // The whole value as suggested: its kind decides which fields it has.
          onChange({ ...out.variable });
          setSuggested(out.reason);
        },
      },
    );
  const canFill = suggest.available && !!v.name;
  const fillButton = (words: string) => (
    <button
      type="button"
      className="link-btn agent-ink"
      disabled={suggest.isPending}
      onClick={fillIn}
    >
      {suggest.isPending ? 'Asking the assistant…' : words}
    </button>
  );
  return (
    <div className="value-row">
      <input
        className="value-name"
        type="text"
        aria-label="Called"
        placeholder="Name in lab words"
        required
        value={v.label ?? ''}
        onChange={(e) => {
          const label = e.target.value;
          // A new value's name follows its lab words until someone sets it under More. An existing
          // one keeps its name, so formulas and steps that use it still find it.
          const follows = fresh && (!v.name || v.name === nameFor(v.label ?? '', taken));
          set({
            label: label || undefined,
            ...(follows && label ? { name: nameFor(label, taken) } : {}),
          });
        }}
      />
      <span className="value-eq" aria-hidden="true">
        =
      </span>
      <div className="value-body">
        <TermBox
          text={text}
          terms={terms}
          mode="formula"
          label={`${called}: value or formula`}
          placeholder="100 µL, a formula, or Material.field"
          assumed={!!suggested || guess !== undefined}
          check={(t) => {
            const r = readValue(t, terms, perRun);
            return r.ok ? {} : { problem: r.problem, fix: r.fix };
          }}
          onChange={(t) => {
            setDraft(t);
            setSuggested(undefined);
            const r = readValue(t, terms, perRun);
            if (r.ok) onChange(withFields(v, r.value));
          }}
          onBlur={() => {
            if (read.ok) setDraft(undefined);
          }}
        />
        <div className="value-after">
          {(v.kind === 'computed' || v.kind === 'record') && shown && (
            <span className={shown.ok ? 'value-result' : 'warn-ink'}>
              {shown.ok ? (
                <>
                  = <b>{shown.text}</b>
                </>
              ) : (
                shown.text
              )}
            </span>
          )}
          {read.ok && text.trim() && <span className="kind-words">{kindWords(v, terms)}</span>}
          {v.kind === 'record' && v.value !== undefined && (
            <span className="kind-words">typical {formatValue(v.value)}</span>
          )}
          {v.kind === 'input' && (v.min !== undefined || v.max !== undefined) && (
            <span className="kind-words">
              {v.min === undefined ? '…' : formatValue(v.min)} to{' '}
              {v.max === undefined ? '…' : formatValue(v.max)}
            </span>
          )}
          {suggested && (
            <span className="agent-ink">suggested by the assistant, unverified: {suggested}</span>
          )}
          {!suggested && <GuessNote note={guess} />}
          {canFill && (!text.trim() || !read.ok) && fillButton('Fill in with the assistant')}
          <button
            type="button"
            className="link-btn"
            aria-expanded={open}
            aria-label={`More about ${called}`}
            onClick={() => setOpen(!open)}
          >
            More
          </button>
        </div>
        {suggest.error && <p className="error-text">{suggest.error.message}</p>}
        {open && (
          <div className="value-more">
            {v.kind === 'computed' && (
              <label>
                Give it in{' '}
                <input
                  className="field short"
                  type="text"
                  aria-label="Give it in"
                  placeholder="its own unit"
                  value={v.unit ?? ''}
                  onChange={(e) => set({ unit: e.target.value.trim() || undefined })}
                />
              </label>
            )}
            {plain && (
              <label>
                <input
                  type="checkbox"
                  checked={perRun}
                  onChange={(e) =>
                    set({
                      kind: e.target.checked ? 'input' : 'default',
                      ...(e.target.checked ? {} : { min: undefined, max: undefined }),
                    })
                  }
                />{' '}
                Set per run
              </label>
            )}
            {perRun && (
              <>
                <Bound label="At least" value={v.min} onChange={(min) => set({ min })} />
                <Bound label="At most" value={v.max} onChange={(max) => set({ max })} />
              </>
            )}
            {v.kind === 'record' && (
              <Bound
                label="Typical value"
                hint="until a material is picked"
                value={v.value as SopVariable['min']}
                onChange={(typical) => set({ value: typical })}
              />
            )}
            <label>
              Note{' '}
              <input
                className="field"
                type="text"
                aria-label="Note"
                value={v.note ?? ''}
                onChange={(e) => set({ note: e.target.value || undefined })}
              />
            </label>
            <label>
              Technical name{' '}
              <input
                className="field"
                type="text"
                aria-label="Technical name"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                value={v.name ?? ''}
                onChange={(e) => set({ name: e.target.value || undefined })}
              />
            </label>
            {v.kind === 'record' && v.readFrom && (
              <span className="muted">reads the field {v.readFrom.field}</span>
            )}
            <span className="muted">
              {v.cite?.length
                ? `${v.cite.length} source passage${v.cite.length > 1 ? 's' : ''}`
                : 'no source passage'}
            </span>
            {canFill && text.trim() && read.ok && fillButton('Ask the assistant for this value')}
            <button type="button" className="btn small danger" onClick={onRemove}>
              Remove value
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One number or amount, e.g. an input's least allowed or a typical value. */
function Bound({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: SopVariable['min'];
  onChange: (next: SopVariable['min']) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : formatValue(value));
  const read = text.trim() ? plainValue(text) : undefined;
  const bad = !!text.trim() && (read === undefined || Array.isArray(read));
  return (
    <label>
      {label}{' '}
      <input
        className="field short"
        type="text"
        aria-label={label}
        aria-invalid={bad}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.trim() ? plainValue(e.target.value) : undefined;
          const ok = !e.target.value.trim() || (next !== undefined && !Array.isArray(next));
          e.target.setCustomValidity(ok ? '' : 'A number, or a number and a unit');
          if (ok) onChange(next as SopVariable['min']);
        }}
      />
      {hint && <span className="muted"> {hint}</span>}
    </label>
  );
}

// ---- Steps ----

const settingNames = [
  'volume',
  'duration',
  'temperature',
  'speed',
  'cycles',
  'wavelength',
  'concentration',
];

/** A setting's value as one line: "Well volume", "50 µL", "3" or "room temperature". */
function settingText(p: Partial<StepParameter>, values: readonly NamedValue[]): string {
  if (p.variable) return values.find((v) => v.name === p.variable)?.label ?? p.variable;
  if (p.quantity) return schemaValueText(p.quantity);
  return p.number ?? p.text ?? '';
}

function StepEditor({ schema, value, onChange, index }: ItemEditorProps) {
  const { root, doc, variables } = useSop();
  const { results } = useResults(variables);
  const props = resolve(schema, root).properties ?? {};
  const step = value as Partial<SopStep>;
  const terms = useMemo(() => sopTerms(doc), [doc]);
  const [draft, setDraft] = useState<string>();
  const text = draft ?? wordsText(step.text ?? '', terms);
  const set = (patch: Item) => onChange(without({ ...value, ...patch }));
  const suggest = useSuggest();
  const [suggested, setSuggested] = useState<string>();
  const guess = useGuess(step.id && `/steps/${step.id}`, value);
  // Counts suggestions taken, so the setting rows start again from what came back.
  const [round, setRound] = useState(0);
  const parameters = step.parameters ?? [];
  const setParameters = (next: Partial<StepParameter>[]) =>
    set({ parameters: next.length ? next : undefined });
  const more = (key: string, label: string) =>
    props[key] && (
      <FormRow label={label} hint={props[key]?.description}>
        <ValueEditor
          schema={props[key] as JsonSchema}
          value={value[key]}
          onChange={(next) => set({ [key]: next })}
          label={label}
          path={`steps.${key}`}
        />
      </FormRow>
    );
  const read = readWords(text, terms);
  return (
    <EditorCards doc={doc} results={results}>
      <div className="form-rows">
        <FormRow label="Do">
          <div className="step-line">
            <select
              className="field"
              aria-label="Action"
              value={step.action ?? ''}
              onChange={(e) => set({ action: e.target.value || undefined })}
            >
              {Object.entries(actionWords).map(([action, words]) => (
                <option key={action} value={action}>
                  {words}
                </option>
              ))}
            </select>
            <input
              className="field grow"
              type="text"
              aria-label="Short name"
              placeholder="Short name, e.g. Coat"
              value={step.title ?? ''}
              onChange={(e) => set({ title: e.target.value || undefined })}
            />
            <label className="muted">
              ×{' '}
              <input
                className="field num short"
                type="number"
                aria-label="Times"
                placeholder="1"
                min={2}
                step={1}
                value={step.repeat ?? ''}
                onChange={(e) =>
                  set({ repeat: e.target.value ? Number(e.target.value) : undefined })
                }
              />{' '}
              times
            </label>
          </div>
        </FormRow>
        <FormRow label="What to do">
          <div className="step-words">
            <TermBox
              text={text}
              terms={terms}
              mode="words"
              label={`Step ${index + 1}: what to do`}
              placeholder="In lab words, close to the source: Add Well volume of Wash buffer…"
              check={(t) => (t.trim() ? {} : { problem: 'Say what to do' })}
              assumed={!!suggested || guess !== undefined}
              onChange={(t) => {
                setDraft(t);
                setSuggested(undefined);
                if (t.trim()) onChange(without({ ...value, ...withWords(step, t, terms) }));
              }}
              onBlur={() => setDraft(undefined)}
            />
            {!suggested && guess !== undefined && (
              <p className="step-read">
                <GuessNote note={guess} />
              </p>
            )}
            <p className="step-read">
              {(step.uses?.length ?? 0) > 0 && (
                <span>
                  <span className="muted">Uses</span>{' '}
                  {step.uses?.map((u) => (
                    <TermAnchor key={u} type="material" name={u}>
                      {terms.materials.find((m) => m.name === u)?.label ?? u}
                    </TermAnchor>
                  ))}
                </span>
              )}
              {read.values.length > 0 && (
                <span>
                  <span className="muted">Values</span>{' '}
                  {read.values.map((n) => (
                    <TermAnchor key={n} type="value" name={n}>
                      {labelOf(terms, n)}
                    </TermAnchor>
                  ))}
                </span>
              )}
              {parameters.length > 0 && (
                <span>
                  <span className="muted">Settings</span>{' '}
                  {parameters.map((p, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: settings have no id of their own
                    <span key={i} className="setting-words">
                      {p.name} ={' '}
                      {p.variable ? (
                        <TermAnchor type="value" name={p.variable}>
                          {labelOf(terms, p.variable)}
                        </TermAnchor>
                      ) : (
                        formatValue(p.quantity ?? p.number ?? p.text)
                      )}
                      {!read.settings.has(p.name ?? '') && (
                        <span className="muted"> (set under More)</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
              {suggest.available && step.id && text.trim() && (
                <button
                  type="button"
                  className="link-btn agent-ink"
                  disabled={suggest.isPending}
                  onClick={() =>
                    suggest.mutate(
                      { step: step.id as string },
                      {
                        onSuccess: (out) => {
                          const next = out.steps?.[0];
                          if (!next) return;
                          setDraft(undefined);
                          setRound(round + 1);
                          onChange(without({ ...value, ...next }));
                          setSuggested(out.reason);
                        },
                      },
                    )
                  }
                >
                  {suggest.isPending ? 'Asking the assistant…' : 'Fill in with the assistant'}
                </button>
              )}
            </p>
            {suggested && (
              <p className="agent-ink step-note">
                suggested by the assistant, unverified: {suggested}
              </p>
            )}
            {suggest.error && <p className="error-text">{suggest.error.message}</p>}
          </div>
        </FormRow>
        <details className="more">
          <summary className="more-head">
            More: settings, makes, shown with, sources, step id
          </summary>
          <div className="form-rows">
            <FormRow
              label="Settings"
              hint="A value by its name, e.g. Well volume, an amount or words"
            >
              <div className="settings grow">
                {parameters.map((p, i) => (
                  <SettingRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, not moved
                    key={`${round}-${i}-${p.name}`}
                    parameter={p}
                    values={terms.values}
                    onChange={(next) =>
                      setParameters(
                        next === undefined
                          ? parameters.filter((_, j) => j !== i)
                          : parameters.map((q, j) => (j === i ? next : q)),
                      )
                    }
                  />
                ))}
                <datalist id="setting-names">
                  {settingNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <datalist id="setting-values">
                  {terms.values.map((v) => (
                    <option key={v.name} value={v.label} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setParameters([...parameters, { name: '' }])}
                >
                  Add a setting
                </button>
              </div>
            </FormRow>
            {more('produces', 'Makes')}
            {more('group', 'Shown with')}
            {more('prerequisite', 'Do first')}
            <FormRow label="Step id" hint="Made for you; timings and agents refer to it">
              <input
                className="field"
                type="text"
                aria-label="Step id"
                pattern="[a-z0-9_\-]+"
                value={step.id ?? ''}
                onChange={(e) => set({ id: e.target.value || undefined })}
              />
            </FormRow>
            {more('cite', 'Sources')}
          </div>
        </details>
      </div>
    </EditorCards>
  );
}

function SettingRow({
  parameter,
  values,
  onChange,
}: {
  parameter: Partial<StepParameter>;
  values: readonly NamedValue[];
  onChange: (next: Partial<StepParameter> | undefined) => void;
}) {
  const [text, setText] = useState(() => settingText(parameter, values));
  const [problem, setProblem] = useState<string>();
  return (
    <div className="setting-row">
      <input
        className="field"
        type="text"
        aria-label="Setting"
        list="setting-names"
        placeholder="volume"
        required
        value={parameter.name ?? ''}
        onChange={(e) => onChange({ ...parameter, name: e.target.value })}
      />
      <input
        className="field grow"
        type="text"
        aria-label={`${parameter.name || 'Setting'} value`}
        aria-invalid={!!problem}
        list="setting-values"
        placeholder="50 µL, 3, Well volume or room temperature"
        required
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const read = readSetting(e.target.value, values);
          e.target.setCustomValidity(read.ok ? '' : read.problem);
          setProblem(read.ok ? undefined : read.problem);
          if (read.ok) onChange({ name: parameter.name ?? '', ...read.value });
        }}
      />
      <button type="button" className="btn small" onClick={() => onChange(undefined)}>
        Remove
      </button>
      {problem && <span className="error-text">{problem}</span>}
    </div>
  );
}

/** The next free step id: s1, s2… */
function freshStepId(items: unknown[]): string {
  const taken = new Set(items.map((s) => (s as { id?: string })?.id));
  let n = items.length + 1;
  while (taken.has(`s${n}`)) n++;
  return `s${n}`;
}

/** The SOP's steps in order, each open, numbered, with its own words and settings. */
function StepsEditor({ schema, value, onChange }: ListEditorProps) {
  const items = (Array.isArray(value) ? value : []) as Item[];
  const [keys, setKeys] = useState(() => items.map((_, i) => i));
  const [next, setNext] = useState(items.length);
  const update = (nextItems: Item[], nextKeys: number[]) => {
    setKeys(nextKeys);
    onChange(nextItems.length ? nextItems : undefined);
  };
  const { document = {} } = useEditorScope();
  const suggest = useSuggest();
  const [sentence, setSentence] = useState('');
  // Steps the assistant wrote, by id, with its reason, until a person saves.
  const [drafted, setDrafted] = useState<string>();
  const take = (steps: Item[], reason: string, replace: boolean) => {
    const base = replace ? [] : items;
    const fresh = steps.map((_, i) => next + i);
    setNext(next + steps.length);
    update([...base, ...steps], [...(replace ? [] : keys), ...fresh]);
    setDrafted(reason);
  };
  const move = (from: number, to: number) => {
    const order = items.map((_, i) => i);
    order.splice(to, 0, ...order.splice(from, 1));
    update(
      order.map((i) => items[i] as Item),
      order.map((i) => keys[i] as number),
    );
  };
  return (
    <ol className="steps-edit">
      {items.length === 0 && <p className="muted">No steps yet.</p>}
      {items.map((step, i) => (
        <li key={keys[i]} className="step-edit" aria-label={`Step ${i + 1}`}>
          <div className="step-edit-head">
            <span className="step-no num">{i + 1}</span>
            <span className="step-gap" />
            <button
              type="button"
              className="btn small"
              aria-label={`Move step ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn small"
              aria-label={`Move step ${i + 1} down`}
              disabled={i === items.length - 1}
              onClick={() => move(i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn small danger"
              aria-label={`Remove step ${i + 1}`}
              onClick={() =>
                update(
                  items.filter((_, j) => j !== i),
                  keys.filter((_, j) => j !== i),
                )
              }
            >
              Remove
            </button>
          </div>
          <StepEditor
            schema={schema}
            value={step}
            index={i}
            label={`Step ${i + 1}`}
            path="steps"
            onChange={(changed) =>
              update(
                items.map((x, j) => (j === i ? changed : x)),
                keys,
              )
            }
          />
        </li>
      ))}
      <li className="steps-foot">
        <p className="muted hint">
          What a step uses and its settings are read from its words: a material named, a value (Add
          Well volume) or an amount (2 h, 37 °C). Anything else goes under More.
        </p>
        {drafted && (
          <p className="agent-ink step-note">drafted by the assistant, unverified: {drafted}</p>
        )}
        <div className="step-line">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setNext(next + 1);
              update([...items, { id: freshStepId(items), action: 'manual' }], [...keys, next]);
            }}
          >
            Add step
          </button>
          {suggest.available && (
            <>
              <input
                className="field grow"
                type="text"
                aria-label="A new step in a sentence"
                placeholder="Or say it, e.g. wash three times with wash buffer"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                onKeyDown={(e) => {
                  // Enter here asks for the step; it never saves the SOP.
                  if (e.key === 'Enter') e.preventDefault();
                }}
              />
              <button
                type="button"
                className="btn small agent-ink"
                disabled={!sentence.trim() || suggest.isPending}
                onClick={() =>
                  suggest.mutate(
                    { newStep: sentence.trim() },
                    {
                      onSuccess: (out) => {
                        take((out.steps ?? []) as Item[], out.reason, false);
                        setSentence('');
                      },
                    },
                  )
                }
              >
                {suggest.isPending ? 'Asking the assistant…' : 'Write it with the assistant'}
              </button>
              {items.length === 0 && !!document.source && (
                <button
                  type="button"
                  className="btn small agent-ink"
                  disabled={suggest.isPending}
                  onClick={() =>
                    suggest.mutate(
                      { steps: true },
                      { onSuccess: (out) => take((out.steps ?? []) as Item[], out.reason, true) },
                    )
                  }
                >
                  Draft the steps from the source
                </button>
              )}
            </>
          )}
        </div>
        {suggest.error && <p className="error-text">{suggest.error.message}</p>}
      </li>
    </ol>
  );
}

// ---- Materials ----

const materialTypeWords: Record<SopMaterial['type'], string> = {
  reagent: 'Reagent',
  entity: 'Sample or strain',
  labware: 'Labware',
  instrument: 'Instrument',
  consumable: 'Consumable',
  solution: 'Solution',
};

/** The SOP's materials, one line each: what it is called, what type, what it must meet, usually what. */
function MaterialsEditor({ value, onChange }: ListEditorProps) {
  const { doc, variables } = useSop();
  const { results } = useResults(variables);
  const items = (Array.isArray(value) ? value : []) as Partial<SopMaterial>[];
  const [keys, setKeys] = useState(() => items.map((_, i) => i));
  const [next, setNext] = useState(items.length);
  const update = (nextItems: Partial<SopMaterial>[], nextKeys = keys) => {
    setKeys(nextKeys);
    onChange(nextItems.length ? nextItems : undefined);
  };
  return (
    <EditorCards doc={{ ...doc, materials: items as never[] }} results={results}>
      <div className="materials-edit">
        {items.length === 0 && <p className="muted">No materials yet.</p>}
        {items.map((m, i) => (
          <MaterialRow
            key={keys[i]}
            material={m}
            taken={
              new Set([
                ...items.flatMap((o, j) => (j !== i && o.role ? [o.role] : [])),
                ...(doc.solutions as { role?: string }[]).flatMap((s) => (s.role ? [s.role] : [])),
              ])
            }
            gives={variables.filter((v) => v.readFrom?.role && v.readFrom.role === m.role)}
            onChange={(changed) => update(items.map((x, j) => (j === i ? changed : x)))}
            onRemove={() =>
              update(
                items.filter((_, j) => j !== i),
                keys.filter((_, j) => j !== i),
              )
            }
          />
        ))}
        <div className="values-foot">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setNext(next + 1);
              update([...items, { type: 'reagent' }], [...keys, next]);
            }}
          >
            Add material
          </button>
        </div>
      </div>
    </EditorCards>
  );
}

function MaterialRow({
  material: m,
  taken,
  gives,
  onChange,
  onRemove,
}: {
  material: Partial<SopMaterial>;
  taken: ReadonlySet<string>;
  gives: readonly Partial<SopVariable>[];
  onChange: (next: Partial<SopMaterial>) => void;
  onRemove: () => void;
}) {
  const [fresh] = useState(() => !m.role);
  const [open, setOpen] = useState(false);
  const set = (patch: Item) => onChange(without({ ...m, ...patch }) as Partial<SopMaterial>);
  const called = m.label || 'This material';
  const guess = useGuess(m.role && `/materials/${m.role}`, m);
  return (
    <div className={`material-row${guess === undefined ? '' : ' assumed'}`}>
      <GuessNote note={guess} />
      <div className="material-line">
        <input
          className="field material-name"
          type="text"
          aria-label="Material"
          placeholder="Name in lab words"
          required
          value={m.label ?? ''}
          onChange={(e) => {
            const label = e.target.value;
            // Like a value, a new material's name follows its lab words; an existing one keeps it.
            const follows = fresh && (!m.role || m.role === nameFor(m.label ?? '', taken));
            set({
              label: label || undefined,
              ...(follows && label ? { role: nameFor(label, taken) } : {}),
            });
          }}
        />
        <select
          className="field"
          aria-label={`${called}: type`}
          value={m.type ?? 'reagent'}
          onChange={(e) => set({ type: e.target.value, default: undefined })}
        >
          {Object.entries(materialTypeWords).map(([type, words]) => (
            <option key={type} value={type}>
              {words}
            </option>
          ))}
        </select>
        <input
          className="field grow"
          type="text"
          aria-label={`${called}: must be`}
          placeholder="What any choice must meet, e.g. 96-well, high binding"
          value={m.requirements ?? ''}
          onChange={(e) => set({ requirements: e.target.value || undefined })}
        />
        <span className="muted">default</span>
        <MaterialPicker
          type={m.type ?? 'reagent'}
          value={m.default}
          label={`${called}: default record`}
          onChange={(id) => set({ default: id })}
        />
      </div>
      <div className="value-after">
        {gives.length > 0 && (
          <span className="kind-words">
            gives{' '}
            {gives.map((v, i) => (
              <span key={v.name}>
                {i > 0 && ', '}
                <TermAnchor type="value" name={v.name ?? ''}>
                  {v.label ?? v.name}
                </TermAnchor>
              </span>
            ))}
          </span>
        )}
        <button
          type="button"
          className="link-btn"
          aria-expanded={open}
          aria-label={`More about ${called}`}
          onClick={() => setOpen(!open)}
        >
          More
        </button>
      </div>
      {open && (
        <div className="value-more">
          <label>
            Technical name{' '}
            <input
              className="field"
              type="text"
              aria-label="Technical name"
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              value={m.role ?? ''}
              onChange={(e) => set({ role: e.target.value || undefined })}
            />
          </label>
          <span className="muted">
            {m.cite?.length
              ? `${m.cite.length} source passage${m.cite.length > 1 ? 's' : ''}`
              : 'no source passage'}
          </span>
          <button type="button" className="btn small danger" onClick={onRemove}>
            Remove material
          </button>
        </div>
      )}
    </div>
  );
}

/** The usual record for a material, from the kinds that can fill its type. */
function MaterialPicker({
  type,
  value,
  label,
  onChange,
}: {
  type: SopMaterial['type'];
  value: string | undefined;
  label: string;
  onChange: (id: string | undefined) => void;
}) {
  const kinds = MATERIAL_KINDS[type];
  const lists = useQueries({ queries: kinds.map((kind) => recordsQuery({ kind })) });
  const records = lists
    .flatMap((q) => q.data ?? [])
    .filter((r) => r.status !== 'archived' || r.id === value);
  return (
    <select
      className="field"
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">any that fits</option>
      {value && !records.some((r) => r.id === value) && <option value={value}>{value}</option>}
      {records.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label} ({r.name})
        </option>
      ))}
    </select>
  );
}

/** The SOP lists edited whole: its materials, values and steps. */
export const sopListEditors = {
  materials: MaterialsEditor,
  variables: ValuesEditor,
  steps: StepsEditor,
};

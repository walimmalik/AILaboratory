import { type SopStep, type SopVariable, type StepParameter, sopsEvaluate } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { formatValue } from '../lib/format.ts';
import {
  formulaParts,
  type NamedValue,
  nameFor,
  readSetting,
  starterFormulas,
  suggest,
  toReadable,
  toStored,
  typingAt,
  wordsToReadable,
  wordsToStored,
} from '../lib/formulas.ts';
import { type JsonSchema, resolve, valueText } from '../lib/json-schema.ts';
import {
  FormRow,
  type ItemEditor,
  type ItemEditorProps,
  useEditorScope,
  ValueEditor,
} from './FieldEditor.tsx';
import { actionWords } from './Sops.tsx';

/**
 * An SOP's values and steps as a scientist edits them (plan 012): what kind of value it is in lab
 * words, formulas written with the values' lab names, and steps as an action, words, settings and
 * the materials they use. Names and step ids are made from the lab words; agents still see and write
 * the stored form.
 */

type Item = Record<string, unknown>;

/** The SOP's values, materials and step products as edited so far. */
function useSop() {
  const { document = {}, root } = useEditorScope();
  const list = <T,>(key: string) => (Array.isArray(document[key]) ? document[key] : []) as T[];
  return {
    root,
    variables: list<Partial<SopVariable>>('variables'),
    roles: [
      ...list<{ role?: string; label?: string }>('materials'),
      ...list<{ role?: string; label?: string }>('solutions'),
    ].filter((m): m is { role: string; label: string } => !!m.role && !!m.label),
    steps: list<Partial<SopStep>>('steps'),
  };
}

const named = (variables: readonly Partial<SopVariable>[]): NamedValue[] =>
  variables.filter((v): v is NamedValue & Partial<SopVariable> => !!v.name && !!v.label);

const kinds: [SopVariable['kind'], string, string][] = [
  ['input', 'Chosen for each run', 'e.g. number of samples, replicates'],
  ['default', 'Usual value', 'A set value a run may change, e.g. well volume'],
  ['record', 'Read from a material', 'e.g. the working concentration of the lot picked'],
  ['computed', 'Worked out from other values', 'A formula, e.g. total volume to prepare'],
];

const kindWords = Object.fromEntries(kinds.map(([k, words]) => [k, words.toLowerCase()]));

function VariableEditor({ schema, value, onChange, index }: ItemEditorProps) {
  const { root, variables, roles } = useSop();
  const props = resolve(schema, root).properties ?? {};
  const v = value as Partial<SopVariable>;
  const [fresh] = useState(() => !v.name);
  const taken = new Set(
    variables.flatMap((other, i) => (i !== index && other.name ? [other.name] : [])),
  );
  const set = (patch: Item) => {
    const next: Item = { ...value, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const setKind = (kind: SopVariable['kind']) =>
    set({
      kind,
      expression: kind === 'computed' ? v.expression : undefined,
      unit: kind === 'computed' ? v.unit : undefined,
      value: kind === 'computed' ? undefined : v.value,
      readFrom: kind === 'record' ? v.readFrom : undefined,
      min: kind === 'input' ? v.min : undefined,
      max: kind === 'input' ? v.max : undefined,
    });
  const sub = (key: string, label: string, hint?: string) =>
    props[key] && (
      <FormRow label={label} hint={hint}>
        <ValueEditor
          schema={props[key] as JsonSchema}
          value={value[key]}
          onChange={(next) => set({ [key]: next })}
          label={label}
          path={`variables.${key}`}
        />
      </FormRow>
    );
  return (
    <div className="form-rows">
      <FormRow label="Called" hint="In lab words, e.g. Well volume">
        <input
          className="field grow"
          type="text"
          aria-label="Called"
          required
          value={v.label ?? ''}
          onChange={(e) => {
            const label = e.target.value;
            // A new value's name follows its lab words until someone sets it under More. An
            // existing one keeps its name, so formulas and steps that use it still find it.
            const follows = fresh && (!v.name || v.name === nameFor(v.label ?? '', taken));
            set({
              label: label || undefined,
              ...(follows && label ? { name: nameFor(label, taken) } : {}),
            });
          }}
        />
      </FormRow>
      <FormRow label="What is this value?">
        <fieldset className="choices">
          <legend className="sr-only">What is this value?</legend>
          {kinds.map(([kind, words, example]) => (
            <label key={kind}>
              <input
                type="radio"
                name={`variable-kind-${index}`}
                checked={v.kind === kind}
                onChange={() => setKind(kind)}
              />{' '}
              {words} <span className="muted">{example}</span>
            </label>
          ))}
        </fieldset>
      </FormRow>
      {v.kind === 'input' && (
        <>
          {sub('value', 'Starting value', 'e.g. 8, 50 uL, or a list: 1, 2, 4')}
          {sub('min', 'At least')}
          {sub('max', 'At most')}
        </>
      )}
      {v.kind === 'default' && sub('value', 'Value', 'e.g. 100 uL')}
      {v.kind === 'record' && (
        <>
          <FormRow label="From" hint="The material the value is read from once one is picked">
            <select
              className="field"
              aria-label="From"
              required
              value={v.readFrom?.role ?? ''}
              onChange={(e) =>
                set({
                  readFrom: e.target.value
                    ? { role: e.target.value, field: v.readFrom?.field ?? '' }
                    : undefined,
                })
              }
            >
              <option value="">—</option>
              {roles.map((m) => (
                <option key={m.role} value={m.role}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Which of its values" hint="e.g. workingConcentration">
            <input
              className="field grow"
              type="text"
              aria-label="Which of its values"
              required
              value={v.readFrom?.field ?? ''}
              onChange={(e) =>
                set({ readFrom: { role: v.readFrom?.role ?? '', field: e.target.value } })
              }
            />
          </FormRow>
          {sub('value', 'Typical value', 'Used until a material is picked, marked as assumed')}
        </>
      )}
      {v.kind === 'computed' && (
        <>
          <FormRow label="Formula">
            <FormulaEditor
              expression={v.expression}
              self={v.name}
              unit={v.unit}
              variables={variables}
              onChange={(expression) => set({ expression })}
            />
          </FormRow>
          <FormRow label="Give it in" hint="The unit of the result, e.g. mL; blank to keep its own">
            <input
              className="field"
              type="text"
              aria-label="Give it in"
              value={v.unit ?? ''}
              onChange={(e) => set({ unit: e.target.value.trim() || undefined })}
            />
          </FormRow>
        </>
      )}
      {sub('note', 'Note')}
      <details className="more">
        <summary className="more-head">More</summary>
        <div className="form-rows">
          <FormRow
            label="Name"
            hint="How formulas, steps and agents refer to it; made from the lab words"
          >
            <input
              className="field"
              type="text"
              aria-label="Name"
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              value={v.name ?? ''}
              onChange={(e) => set({ name: e.target.value || undefined })}
            />
          </FormRow>
          {sub('cite', 'Sources')}
        </div>
      </details>
    </div>
  );
}

/** Types text into an input as a person would, so its own change handler (and the form's) runs. */
function typeInto(input: HTMLInputElement, text: string, caret: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(caret, caret);
}

function useDebounced<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * A formula written with the values' lab names: pick values and operators from lists, or type and
 * pick from the suggestions; start from a common formula; see the result as it is written.
 */
export function FormulaEditor({
  expression,
  self,
  unit,
  variables,
  onChange,
}: {
  expression: string | undefined;
  /** The value this formula works out, left out of the values it can use. */
  self: string | undefined;
  unit: string | undefined;
  variables: readonly Partial<SopVariable>[];
  onChange: (expression: string | undefined) => void;
}) {
  const values = named(variables).filter((v) => v.name !== self);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => toReadable(expression ?? '', values));
  const [caret, setCaret] = useState<number>();
  const stored = text.trim() ? toStored(text, values) : undefined;
  const typing = caret === undefined ? undefined : typingAt(text, caret);
  const matches = typing ? suggest(typing.typed, values).slice(0, 6) : [];

  const insert = (snippet: string, replaceFrom?: number) => {
    const el = input.current;
    if (!el) return;
    const start = replaceFrom ?? el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    // Inside a function's brackets, the caret waits where the first value goes.
    const blank = snippet.search(/\(\s*[,)]/);
    typeInto(el, next, start + (blank >= 0 ? blank + 1 : snippet.length));
  };
  const insertValue = (v: NamedValue) => insert(`[${v.label}]`, typing?.from);

  return (
    <div className="formula grow">
      <input
        ref={input}
        className="field grow"
        type="text"
        aria-label="Formula"
        aria-invalid={stored?.ok === false}
        placeholder="e.g. [Number of wells] × [Well volume] × 1.1"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? undefined);
          const next = e.target.value.trim() ? toStored(e.target.value, values) : undefined;
          e.target.setCustomValidity(next && !next.ok ? next.problem : '');
          if (!next) onChange(undefined);
          else if (next.ok) onChange(next.expression);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? undefined)}
        onBlur={() => setCaret(undefined)}
      />
      {matches.length > 0 && (
        <ul className="suggestions" aria-label="Matching values">
          {matches.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                className="link-btn"
                // Keeps the caret in the formula, so the pick replaces what was typed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertValue(v)}
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {stored && !stored.ok && (
        <p className="error-text">
          {stored.problem}{' '}
          {stored.suggestion && stored.wrong && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const at = text.indexOf(stored.wrong as string);
                const el = input.current;
                if (!el || at < 0) return;
                const fixed = `[${stored.suggestion?.label}]`;
                const next =
                  text.slice(0, at) + fixed + text.slice(at + (stored.wrong as string).length);
                typeInto(el, next, at + fixed.length);
              }}
            >
              Use it
            </button>
          )}
        </p>
      )}
      {stored?.ok && (
        <FormulaResult
          expression={stored.expression}
          self={self}
          unit={unit}
          variables={variables}
        />
      )}
      <div className="formula-help">
        <div>
          <span className="muted">Values</span>{' '}
          {values.length === 0 && <span className="muted">none yet: add them above</span>}
          {values.map((v) => (
            <button
              key={v.name}
              type="button"
              className="btn small"
              title={`Add ${v.label} to the formula`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(`[${v.label}]`)}
            >
              {v.label}
              {setValueWords(variables, v.name) && (
                <span className="muted"> {setValueWords(variables, v.name)}</span>
              )}
            </button>
          ))}
        </div>
        {(['operator', 'function'] as const).map((kind) => (
          <div key={kind}>
            <span className="muted">{kind === 'operator' ? 'Operators' : 'Functions'}</span>{' '}
            {formulaParts
              .filter((p) => p.kind === kind)
              .map((p) => (
                <button
                  key={p.insert}
                  type="button"
                  className="btn small"
                  title={p.words}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(p.insert)}
                >
                  {p.insert.trim()}
                </button>
              ))}
          </div>
        ))}
        <label>
          <span className="muted">Start from</span>{' '}
          <select
            className="field"
            aria-label="Start from a common formula"
            value=""
            onChange={(e) => {
              const starter = starterFormulas.find((s) => s.title === e.target.value);
              if (starter && input.current)
                typeInto(input.current, starter.formula, starter.formula.indexOf(']') + 1);
            }}
          >
            <option value="">a common formula…</option>
            {starterFormulas.map((s) => (
              <option key={s.title} value={s.title}>
                {s.title}: {s.about}
              </option>
            ))}
          </select>
        </label>
        <p className="muted hint">
          Write values in brackets by their names, numbers with units (0.5 mL), and × ÷ + −. Blanks
          in a common formula are in brackets too: replace each with a value.
        </p>
      </div>
    </div>
  );
}

/** A value's set value in a few words, or how it is found. */
function setValueWords(
  variables: readonly Partial<SopVariable>[],
  name: string,
): string | undefined {
  const v = variables.find((x) => x.name === name);
  if (!v) return undefined;
  if (v.kind === 'computed') return 'worked out';
  return v.value === undefined ? undefined : formatValue(v.value);
}

/** The formula's result from the calculator, with the SOP's values as they are now. */
function FormulaResult({
  expression,
  self,
  unit,
  variables,
}: {
  expression: string;
  self: string | undefined;
  unit: string | undefined;
  variables: readonly Partial<SopVariable>[];
}) {
  const me = self ?? 'this_value';
  const given = [
    ...variables
      .filter((v) => v.name && v.name !== me && (v.expression || v.value !== undefined))
      .map((v) => ({
        name: v.name as string,
        ...(v.kind === 'computed' && v.expression
          ? { expression: v.expression, ...(v.unit ? { unit: v.unit } : {}) }
          : { value: v.value }),
      })),
    { name: me, expression, ...(unit ? { unit } : {}) },
  ];
  const input = useDebounced(JSON.stringify({ variables: given }));
  const result = useQuery({
    queryKey: ['sops.evaluate', input],
    queryFn: () => api.run(sopsEvaluate, JSON.parse(input)),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const values = named(variables);
  const mine = result.data?.variables.find((v) => v.name === me);
  if (result.error) return <p className="error-text">{toReadable(result.error.message, values)}</p>;
  if (!mine) return <p className="muted">Working it out…</p>;
  if (mine.ok)
    return (
      <p className="formula-result">
        = <b>{formatValue(mine.quantity ?? mine.number ?? mine.list)}</b>{' '}
        <span className="muted">with the values as they are now</span>
      </p>
    );
  const waits = mine.waitsOn?.map((n) => values.find((v) => v.name === n)?.label ?? n);
  return (
    <p className="warn-ink">
      {waits?.length
        ? `Needs a value for ${waits.join(', ')} first`
        : toReadable(mine.error ?? 'No result yet', values)}
    </p>
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

/** A setting's value as one line: "[Well volume]", "50 uL", "3" or "room temperature". */
function settingText(p: Partial<StepParameter>, values: readonly NamedValue[]): string {
  if (p.variable) return `[${values.find((v) => v.name === p.variable)?.label ?? p.variable}]`;
  if (p.quantity) return valueText(p.quantity);
  return p.number ?? p.text ?? '';
}

function StepEditor({ schema, value, onChange }: ItemEditorProps) {
  const { root, variables, roles, steps } = useSop();
  const props = resolve(schema, root).properties ?? {};
  const step = value as Partial<SopStep>;
  const values = named(variables);
  const set = (patch: Item) => {
    const next: Item = { ...value, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const parameters = step.parameters ?? [];
  const setParameters = (next: Partial<StepParameter>[]) =>
    set({ parameters: next.length ? next : undefined });
  // Products of other steps can be used too, e.g. the coated plate.
  const usable = [
    ...roles,
    ...steps
      .filter((s) => s.id !== step.id)
      .flatMap((s) => s.produces ?? [])
      .filter((p) => !roles.some((r) => r.role === p.role)),
  ];
  const uses = new Set(step.uses ?? []);
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
  return (
    <div className="form-rows">
      <FormRow label="Action">
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
      </FormRow>
      <FormRow label="Short name" hint="e.g. Coat, Block, Read">
        <input
          className="field"
          type="text"
          aria-label="Short name"
          value={step.title ?? ''}
          onChange={(e) => set({ title: e.target.value || undefined })}
        />
      </FormRow>
      <FormRow
        label="What to do"
        hint="In lab words, close to the source; a value or material in brackets, e.g. [Well volume], shows its amount at the bench"
      >
        <StepWords
          text={step.text}
          names={[...values, ...usable.map((m) => ({ name: m.role, label: m.label }))]}
          onChange={(text) => set({ text })}
        />
      </FormRow>
      <FormRow label="Settings" hint="A value's name in brackets uses it, e.g. [Well volume]">
        <div className="settings grow">
          {parameters.map((p, i) => (
            <SettingRow
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, not moved
              key={i}
              parameter={p}
              values={values}
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
            {values.map((v) => (
              <option key={v.name} value={`[${v.label}]`} />
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
      <FormRow label="Times" hint="Done this many times, e.g. wash 3 times; blank for once">
        <input
          className="field num"
          type="number"
          aria-label="Times"
          min={2}
          step={1}
          value={step.repeat ?? ''}
          onChange={(e) => set({ repeat: e.target.value ? Number(e.target.value) : undefined })}
        />
      </FormRow>
      {usable.length > 0 && (
        <FormRow label="Uses">
          <fieldset className="choices inline">
            <legend className="sr-only">Materials this step uses</legend>
            {usable.map((m) => (
              <label key={m.role}>
                <input
                  type="checkbox"
                  checked={uses.has(m.role)}
                  onChange={(e) => {
                    const next = new Set(uses);
                    if (e.target.checked) next.add(m.role);
                    else next.delete(m.role);
                    const ordered = usable.map((u) => u.role).filter((r) => next.has(r));
                    set({ uses: ordered.length ? ordered : undefined });
                  }}
                />{' '}
                {m.label}
              </label>
            ))}
          </fieldset>
        </FormRow>
      )}
      <details className="more">
        <summary className="more-head">More</summary>
        <div className="form-rows">
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
  );
}

function StepWords({
  text,
  names,
  onChange,
}: {
  text: string | undefined;
  names: readonly NamedValue[];
  onChange: (text: string | undefined) => void;
}) {
  const [shown, setShown] = useState(() => wordsToReadable(text ?? '', names));
  return (
    <textarea
      className="field grow"
      aria-label="What to do"
      required
      rows={Math.min(8, Math.max(2, Math.ceil(shown.length / 55) + 1))}
      value={shown}
      onChange={(e) => {
        setShown(e.target.value);
        onChange(e.target.value.trim() ? wordsToStored(e.target.value, names) : undefined);
      }}
    />
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
        placeholder="50 uL, 3, [Well volume] or room temperature"
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

/** The SOP lists with editors of their own. */
export const sopItemEditors: Record<string, ItemEditor> = {
  variables: {
    Edit: VariableEditor,
    create: () => ({ kind: 'default' }),
    title: (item) => {
      const v = item as Partial<SopVariable>;
      if (!v.label) return '';
      const kind = v.kind ? kindWords[v.kind] : '';
      const shown = v.kind !== 'computed' && v.value !== undefined ? formatValue(v.value) : '';
      return [v.label, [kind, shown].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    },
  },
  steps: {
    Edit: StepEditor,
    create: (items) => ({ id: freshStepId(items), action: 'manual' }),
    title: (item) => {
      const s = item as Partial<SopStep>;
      const words = s.title ?? s.text;
      if (!words) return '';
      const action = s.action ? actionWords[s.action] : '';
      return `${[action, words].filter(Boolean).join(' · ')}${s.repeat ? ` × ${s.repeat}` : ''}`;
    },
  },
};

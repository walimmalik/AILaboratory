import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { recordsQuery } from '../queries.ts';
import { fieldLabel } from './RecordReview.tsx';

/**
 * Editing a record's values by hand. The form is drawn from the kind's JSON Schema (`records.kinds`),
 * so every kind is editable without a form of its own: quantities get a number and a unit, choices a
 * list, references to other records a picker, and shapes with variants (a grid or a list of wells, a
 * round or square opening) a choice of variant first. Anything else is edited as JSON.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  description?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

interface EditorContext {
  root: JsonSchema;
  /** Record kind by ID prefix, for reference pickers. */
  kindOfPrefix: Record<string, string>;
  /** Dotted paths that don't apply to this record (`Readiness.notApplicable`); left out unless set. */
  hidden: ReadonlySet<string>;
}
const Context = createContext<EditorContext>({ root: {}, kindOfPrefix: {}, hidden: new Set() });

export function EditorScope({ children, ...value }: EditorContext & { children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = schema.$ref?.match(/^#\/\$defs\/(.+)$/)?.[1];
  return ref && root.$defs?.[ref] ? resolve(root.$defs[ref], root) : schema;
}

const unitWords: Record<string, string> = { uL: 'µL', um: 'µm' };

function isQuantity(s: JsonSchema): boolean {
  return s.type === 'object' && !!s.properties?.value && !!s.properties.unit && !s.properties.x;
}

/** The property whose `const` tells the variants apart, e.g. "layout" or "shape". */
function discriminator(variants: JsonSchema[]): string | undefined {
  const first = variants[0]?.properties ?? {};
  return Object.keys(first).find((key) =>
    variants.every((v) => v.properties?.[key]?.const !== undefined),
  );
}

type Change = (next: unknown) => void;

/** One value's editor. `undefined` means no value; clearing a field removes it. */
export function ValueEditor({
  schema,
  value,
  onChange,
  label,
  path,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: Change;
  label: string;
  /** Dotted path from the attributes, e.g. "wells.a1". */
  path: string;
}) {
  const { root } = useContext(Context);
  const s = resolve(schema, root);
  const variants = (s.oneOf ?? s.anyOf)?.map((v) => resolve(v, root));
  if (variants)
    return (
      <VariantEditor
        variants={variants}
        value={value}
        onChange={onChange}
        label={label}
        path={path}
      />
    );
  if (isQuantity(s))
    return <QuantityEditor schema={s} value={value} onChange={onChange} label={label} />;
  if (s.type === 'object' && s.properties) {
    return <ObjectEditor schema={s} value={value} onChange={onChange} path={path} />;
  }
  if (s.enum) {
    return (
      <select
        className="field"
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {s.enum.map((option) => (
          <option key={String(option)} value={String(option)}>
            {fieldLabel(String(option))}
          </option>
        ))}
      </select>
    );
  }
  if (s.type === 'boolean') {
    return (
      <select
        className="field"
        aria-label={label}
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'yes')}
      >
        <option value="">—</option>
        <option value="yes">yes</option>
        <option value="no">no</option>
      </select>
    );
  }
  if (s.type === 'integer' || s.type === 'number') {
    return (
      <input
        className="field num"
        type="number"
        aria-label={label}
        step={s.type === 'integer' ? 1 : 'any'}
        min={s.minimum}
        max={s.maximum}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  if (s.type === 'string') {
    return <StringEditor schema={s} value={value} onChange={onChange} label={label} />;
  }
  if (s.type === 'array' && resolve(s.items ?? {}, root).type === 'string') {
    return <ListEditor value={value} onChange={onChange} label={label} />;
  }
  return <JsonEditor value={value} onChange={onChange} label={label} />;
}

function StringEditor({
  schema,
  value,
  onChange,
  label,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const { kindOfPrefix } = useContext(Context);
  const prefix = schema.pattern?.match(/^\^([a-z]{2,5})_/)?.[1];
  const kind = prefix ? kindOfPrefix[prefix] : undefined;
  if (kind) return <RecordPicker kind={kind} value={value} onChange={onChange} label={label} />;
  return (
    <input
      className="field grow"
      type="text"
      aria-label={label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

function RecordPicker({
  kind,
  value,
  onChange,
  label,
}: {
  kind: string;
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const { data = [] } = useQuery(recordsQuery({ kind }));
  const records = data.filter((r) => r.status !== 'archived');
  return (
    <select
      className="field"
      aria-label={label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">—</option>
      {typeof value === 'string' && !records.some((r) => r.id === value) && (
        <option value={value}>{value}</option>
      )}
      {records.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label} ({r.name})
        </option>
      ))}
    </select>
  );
}

function QuantityEditor({
  schema,
  value,
  onChange,
  label,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const unitSchema = schema.properties?.unit ?? {};
  const units = (unitSchema.enum ?? [unitSchema.const]).map(String);
  const current = (value ?? {}) as { value?: string; unit?: string };
  const unit = current.unit ?? units[0] ?? '';
  return (
    <span className="quantity">
      <input
        className="field num"
        type="text"
        inputMode="decimal"
        aria-label={label}
        pattern={schema.properties?.value?.pattern?.replace(/^\^|\$$/g, '')}
        value={current.value ?? ''}
        onChange={(e) => {
          const text = e.target.value.trim();
          onChange(text === '' ? undefined : { value: text, unit });
        }}
      />
      {units.length > 1 ? (
        <select
          className="field"
          aria-label={`${label} unit`}
          value={unit}
          onChange={(e) =>
            current.value !== undefined && onChange({ value: current.value, unit: e.target.value })
          }
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {unitWords[u] ?? u}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted">{unitWords[unit] ?? unit}</span>
      )}
    </span>
  );
}

/** An object's fields as labeled rows; an object left with no values is removed. */
function ObjectEditor({
  schema,
  value,
  onChange,
  skip,
  path,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: Change;
  /** A property shown elsewhere (a variant's discriminator). */
  skip?: string;
  path: string;
}) {
  const { hidden } = useContext(Context);
  const current = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const set = (key: string, next: unknown) => {
    const updated: Record<string, unknown> = { ...current };
    if (next === undefined) delete updated[key];
    else updated[key] = next;
    // A new object starts with its required yes/no fields answered "no", so it can be saved.
    for (const required of schema.required ?? []) {
      if (updated[required] === undefined && schema.properties?.[required]?.type === 'boolean') {
        updated[required] = false;
      }
    }
    const meaningful = Object.keys(updated).some((k) => k !== skip);
    onChange(meaningful ? updated : undefined);
  };
  return (
    <div className="form-rows">
      {Object.entries(schema.properties ?? {})
        .filter(
          ([key, s]) =>
            key !== skip &&
            s.const === undefined &&
            // A not-applicable field shows only if it says something (a false flag doesn't).
            !(
              hidden.has(`${path}.${key}`) &&
              (current[key] === undefined || current[key] === false)
            ),
        )
        .map(([key, s]) => (
          <FormRow key={key} label={fieldLabel(key)} hint={s.description}>
            <ValueEditor
              schema={s}
              value={current[key]}
              onChange={(next) => set(key, next)}
              label={fieldLabel(key)}
              path={`${path}.${key}`}
            />
          </FormRow>
        ))}
    </div>
  );
}

export function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="form-row">
      <span className="name">{label}</span>
      <div className="control">
        {children}
        {hint && <div className="muted hint">{hint}</div>}
      </div>
    </div>
  );
}

function VariantEditor({
  variants,
  value,
  onChange,
  label,
  path,
}: {
  variants: JsonSchema[];
  value: unknown;
  onChange: Change;
  label: string;
  path: string;
}) {
  const key = discriminator(variants);
  if (!key) return <JsonEditor value={value} onChange={onChange} label={label} />;
  const current = (value && typeof value === 'object' ? value : undefined) as
    | Record<string, unknown>
    | undefined;
  const chosen = variants.find((v) => v.properties?.[key]?.const === current?.[key]);
  return (
    <div className="variant">
      <select
        className="field"
        aria-label={`${label} ${fieldLabel(key)}`}
        value={chosen ? String(chosen.properties?.[key]?.const) : ''}
        onChange={(e) => {
          const picked = e.target.value;
          if (picked === '') onChange(undefined);
          else if (picked !== current?.[key]) onChange({ [key]: picked });
        }}
      >
        <option value="">—</option>
        {variants.map((v) => {
          const option = String(v.properties?.[key]?.const);
          return (
            <option key={option} value={option}>
              {fieldLabel(option)}
            </option>
          );
        })}
      </select>
      {chosen && (
        <ObjectEditor
          schema={chosen}
          value={current}
          skip={key}
          path={path}
          onChange={(next) =>
            onChange({ ...((next as Record<string, unknown>) ?? {}), [key]: current?.[key] })
          }
        />
      )}
    </div>
  );
}

/** A list of short names, comma separated. */
function ListEditor({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const [text, setText] = useState(Array.isArray(value) ? value.join(', ') : '');
  return (
    <input
      className="field grow"
      type="text"
      aria-label={label}
      placeholder="comma separated"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const items = e.target.value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        onChange(items.length > 0 ? items : undefined);
      }}
    />
  );
}

function JsonEditor({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();
  return (
    <div className="grow">
      <textarea
        className="field json-field"
        aria-label={label}
        rows={Math.min(12, Math.max(3, text.split('\n').length))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // Text that isn't JSON makes the form invalid, so Save can't quietly keep the last good value.
          const problem = (message?: string) => {
            e.target.setCustomValidity(message ?? '');
            setError(message);
          };
          if (e.target.value.trim() === '') {
            problem();
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            problem();
          } catch {
            problem('Not valid JSON: fix it or clear it before saving');
          }
        }}
      />
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

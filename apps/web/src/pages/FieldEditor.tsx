import { useQuery } from '@tanstack/react-query';
import { type ComponentType, createContext, type ReactNode, useContext, useState } from 'react';
import {
  discriminator,
  isQuantity,
  type JsonSchema,
  parseTyped,
  resolve,
  typedByText,
  valueText,
} from '../lib/json-schema.ts';
import { recordsQuery } from '../queries.ts';
import { fieldLabel } from './RecordReview.tsx';

/**
 * Editing a record's values by hand. The form is drawn from the kind's JSON Schema (`records.kinds`),
 * so every kind is editable without a form of its own: quantities get a number and a unit, choices a
 * list, references to other records a picker, and shapes with variants (a grid or a list of wells, a
 * round or square opening) a choice of variant first, lists of objects (an SOP's steps) one item
 * per row that opens in place, and a value that may be a number, a quantity or a name (a variable's
 * value, a count) one line of text. Anything else is edited as JSON.
 */
export type { JsonSchema };

interface EditorContext {
  root: JsonSchema;
  /** Record kind by ID prefix, for reference pickers. */
  kindOfPrefix: Record<string, string>;
  /** Dotted paths that don't apply to this record (`Readiness.notApplicable`); left out unless set. */
  hidden: ReadonlySet<string>;
  /** The record being edited, for editors that ask about it (the assistant's fill-in). */
  recordId?: string;
  /** The record's values as edited so far, for editors that refer to other fields (an SOP's steps). */
  document?: Record<string, unknown>;
  /** Editors of their own for the items of some lists, by the list's path (an SOP's steps). */
  itemEditors?: Record<string, ItemEditor>;
  /** Editors of their own for some whole lists, by the list's path (an SOP's values). */
  listEditors?: Record<string, ComponentType<ListEditorProps>>;
  /**
   * The assistant filled in a list item (`/steps/<id>`, `/variables/<name>`): saved untouched, it
   * keeps its "assumed" mark and the assistant's reason rather than becoming the person's.
   */
  onSuggested?: (path: string, item: unknown, note: string) => void;
}
const Context = createContext<EditorContext>({ root: {}, kindOfPrefix: {}, hidden: new Set() });

export function EditorScope({ children, ...value }: EditorContext & { children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useEditorScope = () => useContext(Context);

export interface ItemEditorProps {
  /** The item's schema, for fields the custom editor leaves to the generic ones. */
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  label: string;
  path: string;
  /** Its place in the list, from 0. */
  index: number;
}

export interface ListEditorProps {
  /** The schema of one item. */
  schema: JsonSchema;
  value: unknown;
  onChange: Change;
  label: string;
  path: string;
}

export interface ItemEditor {
  Edit: ComponentType<ItemEditorProps>;
  /** A new item, given the list so far (for a fresh id). */
  create?: (items: unknown[]) => Record<string, unknown>;
  /** The item's line in the list. */
  title?: (item: Record<string, unknown>) => string;
}

const unitWords: Record<string, string> = { uL: 'µL', um: 'µm' };

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
  if (variants && !discriminator(variants) && variants.every((v) => typedByText(v, root)))
    return <TextValueEditor variants={variants} value={value} onChange={onChange} label={label} />;
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
  if (s.type === 'array' && s.items && isItem(resolve(s.items, root), root)) {
    return (
      <ItemsEditor
        schema={resolve(s.items, root)}
        value={value}
        onChange={onChange}
        label={label}
        path={path}
      />
    );
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
  const text = typeof value === 'string' ? value : '';
  // Sentences (a step's words, a note) get room to be read whole.
  if (text.length > 60)
    return (
      <textarea
        className="field grow"
        aria-label={label}
        rows={Math.min(6, Math.ceil(text.length / 70))}
        value={text}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    );
  return (
    <input
      className="field grow"
      type="text"
      aria-label={label}
      value={text}
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
  // A quantity of any unit (a stock, a target concentration) has no list to pick from: its unit is
  // typed beside the number (QA 2026-10-01 Q2, where "undefined" was sent as the unit).
  const units = (unitSchema.enum ?? (unitSchema.const === undefined ? [] : [unitSchema.const])).map(
    String,
  );
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
      ) : units.length === 0 ? (
        <input
          className="field short"
          type="text"
          aria-label={`${label} unit`}
          placeholder="unit, e.g. mM"
          required={current.value !== undefined}
          value={current.unit ?? ''}
          onChange={(e) => {
            const typed = e.target.value.trim();
            onChange(
              current.value === undefined && typed === ''
                ? undefined
                : { value: current.value ?? '', unit: typed },
            );
          }}
        />
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
        {hint && (
          <div className="muted hint">
            {hint.replace(/ \((?:ADR \d+|plan \d+\w*|[A-Z]\d{1,2})\)/g, '')}
          </div>
        )}
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

/** Objects, or variants of objects, edited one per row. */
function isItem(s: JsonSchema, root: JsonSchema): boolean {
  if (s.type === 'object' && s.properties && !isQuantity(s)) return true;
  const variants = (s.oneOf ?? s.anyOf)?.map((v) => resolve(v, root));
  return !!variants && !!discriminator(variants);
}

/** What an item is called in its row: its title, label or name, whichever it has. */
function itemTitle(item: unknown): string {
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const words = [o.title, o.label, o.name, o.role, o.what, o.step, o.about].find(
    (w) => typeof w === 'string' && w !== '',
  );
  const action = typeof o.action === 'string' ? fieldLabel(o.action) : undefined;
  const text = typeof o.text === 'string' ? o.text : undefined;
  // Items named only by their id (an experiment's protocol parts: seeding, readout) go by it.
  const id = typeof o.id === 'string' && o.id !== '' ? fieldLabel(o.id) : undefined;
  const title = words ?? text ?? id ?? '';
  return [action, title].filter(Boolean).join(' · ') || 'new, not filled in yet';
}

const asObject = (item: unknown) =>
  (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;

let nextItemKey = 0;

/** What one item of a list is called, where dropping the "s" doesn't say it. */
const itemNoun: Record<string, string> = {
  cite: 'source passage',
  produces: 'product',
  timing: 'timing rule',
  layout: 'layout requirement',
};

/**
 * A list of objects (an SOP's materials, variables or steps): one line per item naming it, which
 * opens to its fields. Items can be added, removed and moved; a new one opens.
 */
function ItemsEditor({
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
  path: string;
}) {
  const { itemEditors, listEditors } = useContext(Context);
  const Whole = listEditors?.[path];
  if (Whole)
    return <Whole schema={schema} value={value} onChange={onChange} label={label} path={path} />;
  return (
    <ListOfItems
      schema={schema}
      value={value}
      onChange={onChange}
      label={label}
      path={path}
      custom={itemEditors?.[path]}
    />
  );
}

function ListOfItems({
  schema,
  value,
  onChange,
  label,
  path,
  custom,
}: ListEditorProps & { custom: ItemEditor | undefined }) {
  const items = Array.isArray(value) ? value : [];
  // Keys follow the items as they move, so an open item's fields stay with it.
  const [keys, setKeys] = useState(() => items.map(() => nextItemKey++));
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  while (keys.length < items.length) keys.push(nextItemKey++);
  const update = (nextItems: unknown[], nextKeys: number[]) => {
    setKeys(nextKeys);
    onChange(nextItems.length > 0 ? nextItems : undefined);
  };
  const move = (from: number, to: number) => {
    const nextItems = [...items];
    const nextKeys = [...keys];
    nextItems.splice(to, 0, ...nextItems.splice(from, 1));
    nextKeys.splice(to, 0, ...nextKeys.splice(from, 1));
    update(nextItems, nextKeys);
  };
  const toggle = (key: number, isOpen: boolean) => {
    const next = new Set(open);
    if (isOpen) next.add(key);
    else next.delete(key);
    setOpen(next);
  };
  return (
    <div className="items grow">
      {items.length === 0 && <p className="muted">None yet.</p>}
      <ol className="items-list">
        {items.map((item, i) => {
          const key = keys[i] as number;
          return (
            <li key={key} className="item-row">
              <details open={open.has(key)} onToggle={(e) => toggle(key, e.currentTarget.open)}>
                <summary className="item-head">
                  <span className="num muted">{i + 1}</span>{' '}
                  {custom?.title?.(asObject(item)) || itemTitle(item)}
                </summary>
                <div className="item-body">
                  {custom ? (
                    <custom.Edit
                      schema={schema}
                      value={asObject(item)}
                      label={`${label} ${i + 1}`}
                      path={path}
                      index={i}
                      onChange={(next) => {
                        const nextItems = [...items];
                        nextItems[i] = next;
                        update(nextItems, keys);
                      }}
                    />
                  ) : (
                    <ValueEditor
                      schema={schema}
                      value={item}
                      label={`${label} ${i + 1}`}
                      path={path}
                      onChange={(next) => {
                        const nextItems = [...items];
                        nextItems[i] = next ?? {};
                        update(nextItems, keys);
                      }}
                    />
                  )}
                  <div className="item-actions">
                    <button
                      type="button"
                      className="btn small"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="btn small danger"
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
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          const key = nextItemKey++;
          setOpen(new Set(open).add(key));
          update([...items, custom?.create?.(items) ?? {}], [...keys, key]);
        }}
      >
        Add {itemNoun[label.toLowerCase()] ?? label.toLowerCase().replace(/s$/, '')}
      </button>
    </div>
  );
}

/** A value that may be a number, a quantity, a name or a list of them, as one line of text. */
function TextValueEditor({
  variants,
  value,
  onChange,
  label,
}: {
  variants: JsonSchema[];
  value: unknown;
  onChange: Change;
  label: string;
}) {
  const { root } = useContext(Context);
  const [text, setText] = useState(valueText(value));
  const [error, setError] = useState(false);
  return (
    <span className="grow">
      <input
        className="field grow"
        type="text"
        aria-label={label}
        aria-invalid={error}
        placeholder="e.g. 3, 50 uL or 1, 2, 4"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            e.target.setCustomValidity('');
            setError(false);
            onChange(undefined);
            return;
          }
          const parsed = parseTyped(e.target.value, variants, root);
          // Text that can't be a value makes the form invalid, so Save waits for it.
          e.target.setCustomValidity(parsed.ok ? '' : 'Not a value yet');
          setError(!parsed.ok);
          if (parsed.ok) onChange(parsed.value);
        }}
      />
      {error && (
        <span className="error-text">
          {' '}
          Write a number, a number and a unit (50 uL), a name, or a list with commas
        </span>
      )}
    </span>
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

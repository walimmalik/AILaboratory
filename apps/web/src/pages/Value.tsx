import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { fieldLabel, formatValue, isQuantity } from '../lib/format.ts';
import { recordQuery } from '../queries.ts';

/**
 * Any stored value as a person reads it (UI rule 1): a record ID at any depth is its linked name,
 * quantities carry their unit, a list of objects is a small table, and a nested object is a list of
 * named values, one per line. Empty values are left out.
 */
export function Value({ value }: { value: unknown }): ReactNode {
  return renderValue(value);
}

/**
 * `field` is the attribute or key the value sits under: a choice like `tip_rack` reads as words,
 * except under keys that hold names people or agents gave (a variable's name, an item's id).
 */
export function renderValue(value: unknown, field?: string): ReactNode {
  if (typeof value === 'string' && isRecordId(value)) return <LinkedName id={value} />;
  if (typeof value === 'string' && isChoice(value) && !(field && namedKeys.test(field)))
    return value.replaceAll('_', ' ');
  // A name someone gave ("sample_dilution") is one word: it never breaks across lines.
  if (typeof value === 'string' && field && namedKeys.test(field) && !/\s/.test(value))
    return <span className="given-name">{value}</span>;
  if (Array.isArray(value) && value.length > 0) {
    if (value.every(isPlainObject))
      return <ItemsTable items={value as Record<string, unknown>[]} />;
    if (value.some(holdsRecordId))
      return value.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a list of plain values has no other key
        <span key={i}>
          {i > 0 && ', '}
          {renderValue(item, field)}
        </span>
      ));
    if (value.every((item) => typeof item === 'string'))
      return value.map((item) => renderValue(item, field)).join(', ');
  }
  if (isPlainObject(value) && isPin(value)) {
    // A pinned version of a record reads "Human IL-6 sandwich ELISA SOP-0005 v9".
    const pin = value as { id: string; version?: number };
    return (
      <>
        <LinkedName id={pin.id} />
        {pin.version !== undefined && <span className="muted"> v{pin.version}</span>}
      </>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key, v]) => key !== 'cite' && !isEmpty(v),
    );
    // Two plain values read on one line ("x 14.38 mm · y 11.37 mm"); anything bigger is a list.
    const short = entries.length <= 2 && entries.every(([, v]) => !isPlainObject(v));
    if (short)
      return entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ' · '}
          <span className="muted">{fieldLabel(k)}</span> {renderValue(v, k)}
        </span>
      ));
    return (
      <dl className="kv nested">
        {entries.map(([k, v]) => (
          <div key={k} className="kv-row">
            <dt>{fieldLabel(k)}</dt>
            <dd>{renderValue(v, k)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return formatValue(value);
}

const isChoice = (v: string) => /^[a-z]+(_[a-z0-9]+)+$/.test(v);

/** Keys whose values are names, not choices: they stay as written. */
const namedKeys = /^(name|id|key|role|roles|uses|variable|variables|aim|aims|prefix|code|path)$/i;

export const isRecordId = (v: string) => /^[a-z]{2,5}_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);

const isPlainObject = (v: unknown) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !isQuantity(v);

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function holdsRecordId(v: unknown): boolean {
  if (typeof v === 'string') return isRecordId(v);
  if (Array.isArray(v)) return v.some(holdsRecordId);
  if (isPlainObject(v)) return Object.values(v as object).some(holdsRecordId);
  return false;
}

/** `{ id, version }` naming a record: a pinned version. */
function isPin(v: unknown): boolean {
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return (
    typeof o.id === 'string' &&
    isRecordId(o.id) &&
    keys.every((k) => k === 'id' || k === 'version') &&
    (o.version === undefined || typeof o.version === 'number')
  );
}

function ItemsTable({ items }: { items: Record<string, unknown>[] }) {
  // Columns in the order the items use them; source quotes stay on the record's history. An item's
  // id is its key in the list: when every item has a label, the label names it and the key stays in
  // technical details (UX review 2026-10-02, item 3).
  const labelled = items.every((item) => typeof item.label === 'string' && item.label !== '');
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))].filter(
    (key) => key !== 'cite' && !(labelled && key === 'id'),
  );
  return (
    <div className="items-wrap">
      <table className="items-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{fieldLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={JSON.stringify(item)}>
              {columns.map((c) => (
                <td key={c}>{isEmpty(item[c]) ? '' : renderValue(item[c], c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A record by its name and label, linked to its page. */
export function LinkedName({ id }: { id: string }) {
  const { data } = useQuery(recordQuery(id));
  return (
    // The name first, its code as a tag after it (plan 004f: codes are never prefixes).
    <Link to="/records/$id" params={{ id }} className="linked-name">
      {data ? (
        <>
          {data.label} <span className="code">{data.name}</span>
        </>
      ) : (
        <span className="mono">{id}</span>
      )}
    </Link>
  );
}

import { keyedItems } from './keyed.ts';
import { sameValue } from './readiness.ts';

/** One value that differs between two versions of a record (ADR 0053). */
export interface ValueChange {
  /** A JSON pointer; items of keyed lists by their key, e.g. `/steps/coat/duration`. */
  path: string;
  change: 'changed' | 'added' | 'removed';
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A quantity or a reference is one value to a reader, not a pair of fields. */
const isLeaf = (v: Record<string, unknown>) =>
  ('value' in v && 'unit' in v) || ('id' in v && 'version' in v && Object.keys(v).length <= 3);

const pointerKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * What differs between two attribute objects, value by value. Objects are compared field by field,
 * lists the kind keys (`items`, e.g. `{steps: 'id'}`, ADR 0049 and 0065) item by item by key, at
 * any depth, and any other list or a quantity as one value, so a changed step reads
 * "/steps/coat/duration" and not "/steps/2". `list` is the list name in `items` the value sits
 * under: field names along the path, without the item keys.
 */
export function diffValues(
  before: unknown,
  after: unknown,
  items: Readonly<Record<string, string>> = {},
  path = '',
  list = '',
): ValueChange[] {
  if (sameValue(before, after)) return [];
  if (before === undefined) return [{ path: path || '/', change: 'added', after }];
  if (after === undefined) return [{ path: path || '/', change: 'removed', before }];
  const spec = list ? items[list] : undefined;
  if (spec && Array.isArray(before) && Array.isArray(after)) {
    const was = keyedItems(before, spec);
    const now = keyedItems(after, spec);
    // Items without a key can't be followed one by one, so the list is one value.
    if (was.size === before.length && now.size === after.length) {
      const keys = [...new Set([...was.keys(), ...now.keys()])];
      return keys.flatMap((key) =>
        diffValues(was.get(key), now.get(key), items, `${path}/${pointerKey(key)}`, `${list}#`),
      );
    }
  }
  if (isObject(before) && isObject(after) && !isLeaf(before) && !isLeaf(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    // Inside a keyed item (`steps#`), a field is a nested list's name (`steps/parameters`).
    const child = (key: string) =>
      !list ? key : list.endsWith('#') ? `${list.slice(0, -1)}/${key}` : '';
    return keys.flatMap((key) =>
      diffValues(before[key], after[key], items, `${path}/${pointerKey(key)}`, child(key)),
    );
  }
  return [{ path: path || '/', change: 'changed', before, after }];
}

/**
 * Keyed lists (ADR 0049, ADR 0065): lists whose items keep their own evidence and confirmation,
 * found by a key rather than a position. A kind names them in `items`, by the list's name:
 *
 * - `{ steps: 'id' }`: each step is keyed by its `id`; its evidence path is `/steps/<id>`.
 * - `{ overrides: 'plate+well' }`: a composite key, the fields' values joined with "+":
 *   `/overrides/pm_1+A1`.
 * - `{ steps: 'id', 'steps/parameters': 'name' }`: a keyed list inside each item of another;
 *   `/steps/<id>/parameters/<name>`. The parent item is compared without its keyed lists, so one
 *   changed parameter leaves its step confirmed.
 *
 * Items without a full key are left out; the first of two items with the same key wins.
 */
export type ItemKeys = Readonly<Record<string, string>>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A key part in a path, escaped as in a JSON pointer. */
const pointerKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** The fields a key spec names: "plate+well" → ["plate", "well"]. */
export const keyFields = (spec: string) => spec.split('+');

/** An item's key under a spec, or undefined when a key field is missing or not text or a number. */
export function keyOf(item: unknown, spec: string): string | undefined {
  if (!isObject(item)) return undefined;
  const parts: string[] = [];
  for (const field of keyFields(spec)) {
    const value = item[field];
    if (typeof value === 'string' && value !== '') parts.push(value);
    else if (typeof value === 'number') parts.push(String(value));
    else return undefined;
  }
  return parts.join('+');
}

/** A keyed list's items by key, in order. */
export function keyedItems(list: unknown, spec: string): Map<string, unknown> {
  const items = new Map<string, unknown>();
  if (!Array.isArray(list)) return items;
  for (const item of list) {
    const key = keyOf(item, spec);
    if (key !== undefined && !items.has(key)) items.set(key, item);
  }
  return items;
}

/** The evidence key of one item of a top-level keyed list. */
export const itemPath = (field: string, key: string) => `/${field}/${pointerKey(key)}`;

/** The keyed lists directly inside the items of the list named `list` (`steps` → `parameters`). */
export function nestedLists(items: ItemKeys, list: string): string[] {
  return Object.keys(items)
    .filter((name) => name.startsWith(`${list}/`) && !name.slice(list.length + 1).includes('/'))
    .map((name) => name.slice(list.length + 1));
}

/** An item as compared for its own confirmation: without the keyed lists inside it. */
export function ownValue(item: unknown, nested: string[]): unknown {
  if (!isObject(item) || nested.length === 0) return item;
  return Object.fromEntries(Object.entries(item).filter(([k]) => !nested.includes(k)));
}

/** One item of a keyed list, at any depth. */
export interface KeyedEntry {
  /** The evidence path: `/steps/coat` or `/steps/coat/parameters/volume`. */
  path: string;
  /** In words, for people: "coat", or "coat · volume" for a nested item. */
  key: string;
  /** The whole item. */
  value: unknown;
  /** The item without its own keyed lists: what its confirmation covers. */
  own: unknown;
}

/** Every item of the keyed list `field` and of the keyed lists inside its items, in order. */
export function keyedEntries(value: unknown, field: string, items: ItemKeys): KeyedEntry[] {
  const walk = (list: unknown, name: string, path: string, label: string[]): KeyedEntry[] => {
    const spec = items[name];
    if (!spec) return [];
    const nested = nestedLists(items, name);
    return [...keyedItems(list, spec)].flatMap(([key, item]) => {
      const at = `${path}/${pointerKey(key)}`;
      const words = [...label, key];
      return [
        { path: at, key: words.join(' · '), value: item, own: ownValue(item, nested) },
        ...nested.flatMap((child) =>
          walk(
            (item as Record<string, unknown>)[child],
            `${name}/${child}`,
            `${at}/${child}`,
            words,
          ),
        ),
      ];
    });
  };
  return walk(value, field, `/${pointerKey(field)}`, []);
}

/** The keyed lists' entries of every keyed field in `attributes`, by evidence path. */
export function entriesByPath(
  attributes: Record<string, unknown> | undefined,
  items: ItemKeys,
): Map<string, KeyedEntry> {
  const found = new Map<string, KeyedEntry>();
  if (!attributes) return found;
  for (const field of Object.keys(items).filter((name) => !name.includes('/'))) {
    for (const entry of keyedEntries(attributes[field], field, items)) found.set(entry.path, entry);
  }
  return found;
}

/**
 * The keyed list a JSON pointer's segment indexes, by its name in `items`, for a pointer into the
 * attributes: `/steps/coat/parameters/volume` reads `steps` at segment 1 and `steps/parameters` at
 * segment 3. Returns the list name per segment index (only where a keyed list is indexed).
 */
export function keyedSegments(parts: readonly string[], items: ItemKeys): Map<number, string> {
  const found = new Map<number, string>();
  let name = parts[0] ?? '';
  for (let i = 1; i < parts.length && items[name]; i += 2) {
    found.set(i, name);
    name = `${name}/${parts[i + 1] ?? ''}`;
  }
  return found;
}

/** The evidence key a value at this pointer is kept under: its deepest keyed item, or its field. */
export function evidenceKeyOf(path: string, items: ItemKeys): string {
  const parts = path.split('/').slice(1);
  const segments = keyedSegments(parts, items);
  const deepest = Math.max(-1, ...segments.keys());
  return deepest < 0 ? (parts[0] ?? '') : `/${parts.slice(0, deepest + 1).join('/')}`;
}

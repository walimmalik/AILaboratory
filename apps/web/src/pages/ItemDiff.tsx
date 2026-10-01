import { diffValues, type ValueChange } from '@ailab/domain';
import type { FieldEvidence, SopVariable } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { itemName, partLabel } from '../lib/format.ts';
import {
  kindWords,
  type SopDoc,
  sopTerms,
  type Terms,
  valueText,
  wordsText,
} from '../lib/sop-text.ts';
import { kindsQuery } from '../queries.ts';
import { renderValue } from './Value.tsx';

const SHOWN = 8;

/** A record's version as a diff reads it. */
export interface DiffSide {
  label?: unknown;
  status?: unknown;
  attributes?: Record<string, unknown>;
  evidence?: Record<string, FieldEvidence>;
}

/** What differs between two versions, item by item for the kind's keyed lists (ADR 0049, 0053). */
export function itemChanges(
  before: DiffSide | undefined,
  after: DiffSide | undefined,
  items: Readonly<Record<string, string>> = {},
): ValueChange[] {
  const top = (side: DiffSide | undefined) => ({ label: side?.label, status: side?.status });
  return [
    ...diffValues(top(before), top(after)),
    ...diffValues(before?.attributes ?? {}, after?.attributes ?? {}, items),
  ];
}

/** The evidence key a diff path's value is kept under: an item of a keyed list, or its field. */
function evidenceKey(path: string, items: Readonly<Record<string, string>>): string {
  const [list = '', key] = path.split('/').slice(1);
  return items[list] && key !== undefined ? `/${list}/${key}` : list;
}

/** Whether this value is an agent's guess, or something an agent says its person told it. */
function agentSaid(evidence: FieldEvidence | undefined): 'estimate' | 'as told' | undefined {
  if (evidence?.by.type !== 'agent') return undefined;
  if (evidence.source === 'assumed') return 'estimate';
  if (evidence.source === 'stated') return 'as told';
  return undefined;
}

/**
 * The agent's estimates a change would have a person accept: each changed value or item whose
 * evidence on the new side is an agent's guess, counted once per item.
 */
export function estimatesIn(
  changes: ValueChange[],
  after: DiffSide | undefined,
  items: Readonly<Record<string, string>> = {},
): number {
  const keys = new Set(
    changes.flatMap((c) =>
      c.change !== 'removed' &&
      agentSaid(after?.evidence?.[evidenceKey(c.path, items)]) === 'estimate'
        ? [evidenceKey(c.path, items)]
        : [],
    ),
  );
  return keys.size;
}

/**
 * Rows of what changed (UI rule: a diff is rows of what changed): one row per changed value or list
 * item, named the way the record names it, with the items that didn't change folded to a count and
 * the agent's guesses in agent ink. Used for proposals on Review and for "changed since you looked".
 */
export function ItemDiff({
  kind,
  before,
  after,
  changes: given,
  isNew = false,
}: {
  kind: string;
  before: DiffSide | undefined;
  after: DiffSide | undefined;
  /** Already worked out (records.diff); otherwise compared here. */
  changes?: ValueChange[];
  isNew?: boolean;
}) {
  const kinds = useQuery(kindsQuery).data;
  const items = kinds?.find((k) => k.kind === kind)?.items ?? {};
  const changes = given ?? itemChanges(before, after, items);
  const [all, setAll] = useState(false);
  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, SHOWN);
  const terms =
    kind === 'sop'
      ? sopTerms((after?.attributes ?? before?.attributes ?? {}) as SopDoc)
      : undefined;
  const words = (value: unknown, path: string): ReactNode => itemWords(value, path, terms);

  // Items of a touched list that didn't change, so "8 other steps unchanged" can be said.
  const touched = new Map<string, Set<string>>();
  for (const c of changes) {
    const [list = '', key] = c.path.split('/').slice(1);
    if (items[list] && key !== undefined)
      touched.set(list, (touched.get(list) ?? new Set()).add(key));
  }
  const folded = [...touched].flatMap(([list, keys]) => {
    const now = after?.attributes?.[list];
    const keyField = items[list] ?? 'id';
    const rest = Array.isArray(now)
      ? now.filter((i) => !keys.has(String((i as Record<string, unknown>)?.[keyField]))).length
      : 0;
    return rest > 0 ? [`${rest} other ${rest === 1 ? singular(list) : list} unchanged`] : [];
  });

  return (
    <>
      <div className="table-wrap">
        <table className="review-fields item-diff">
          <caption className="sr-only">What would change</caption>
          <tbody>
            {shown.map((c) => {
              const said = agentSaid(after?.evidence?.[evidenceKey(c.path, items)]);
              const note = after?.evidence?.[evidenceKey(c.path, items)]?.note;
              return (
                <tr key={c.path} className={said ? 'agent-said' : undefined}>
                  <th scope="row" title={c.path}>
                    {partLabel(c.path, after?.attributes, items, before?.attributes)}
                  </th>
                  <td>
                    {c.change === 'added' || isNew ? (
                      <span className="muted">{isNew ? 'new' : 'added'}</span>
                    ) : (
                      <span className="was">{words(c.before, c.path)}</span>
                    )}
                  </td>
                  <td>
                    {c.change === 'removed' ? (
                      <span className="muted">removed</span>
                    ) : (
                      <span className="now">{words(c.after, c.path)}</span>
                    )}
                    {said && (
                      <span className="agent-ink" title={note}>
                        {' '}
                        · {said}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(folded.length > 0 || changes.length > SHOWN) && (
        <p className="muted">
          {folded.join(', ')}
          {folded.length > 0 && changes.length > SHOWN && ' · '}
          {changes.length > SHOWN && (
            <button type="button" className="link-btn" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${changes.length} changes`}
            </button>
          )}
        </p>
      )}
    </>
  );
}

const singular = (list: string) =>
  list.endsWith('ies') ? `${list.slice(0, -3)}y` : list.replace(/s$/, '');

/**
 * A changed value in lab words: an SOP's step words with values by their names, an added item on
 * one line ("Wash volume = 300 µL, usual value"), anything else as the record page shows it.
 */
function itemWords(value: unknown, path: string, terms: Terms | undefined): ReactNode {
  const [list = '', key, ...inside] = path.split('/').slice(1);
  if (terms && typeof value === 'string') return wordsText(value, terms);
  if (key !== undefined && inside.length === 0 && value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (terms && list === 'variables') {
      const v = item as Partial<SopVariable>;
      const text = valueText(v, terms);
      return `${itemName(item) ?? key}${text ? ` = ${text}` : ''}, ${kindWords(v, terms)}`;
    }
    if (terms && list === 'steps' && typeof item.text === 'string') {
      return `${itemName(item) ?? key}: ${wordsText(item.text, terms)}`;
    }
  }
  return renderValue(value, list);
}

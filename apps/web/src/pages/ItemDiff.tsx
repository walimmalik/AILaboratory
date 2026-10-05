import { diffValues, evidenceKeyOf, keyOf, type ValueChange } from '@ailab/domain';
import { type FieldEvidence, SopStep, type SopVariable } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { fieldLabel, formatValue, itemName, partLabel } from '../lib/format.ts';
import { runCorrectionDiff } from '../lib/run-correction-diff.ts';
import {
  kindWords,
  type SopDoc,
  sopTerms,
  type Terms,
  valueText,
  wordsText,
} from '../lib/sop-text.ts';
import { kindsQuery } from '../queries.ts';
import { actionWords, Cites } from './Sops.tsx';
import { LinkedName, renderValue } from './Value.tsx';

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

/** The evidence key a diff path's value is kept under: its deepest keyed item, or its field. */
const evidenceKey = evidenceKeyOf;

/** Whether this value is an agent's guess, or something an agent says its person told it. */
function agentSaid(
  evidence: FieldEvidence | undefined,
): 'unverified' | 'stated by you' | undefined {
  if (evidence?.by.type !== 'agent') return undefined;
  if (evidence.source === 'assumed') return 'unverified';
  if (evidence.source === 'stated') return 'stated by you';
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
      agentSaid(after?.evidence?.[evidenceKey(c.path, items)]) === 'unverified'
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
  caption = 'What would change',
  adjacent = false,
  labels,
  fullRunSteps = false,
}: {
  kind: string;
  before: DiffSide | undefined;
  after: DiffSide | undefined;
  /** Already worked out (records.diff); otherwise compared here. */
  changes?: ValueChange[];
  isNew?: boolean;
  caption?: string;
  adjacent?: boolean;
  labels?: Record<string, string>;
  /** The supplied checklist diff inside the expandable correction details. */
  fullRunSteps?: boolean;
}) {
  const kinds = useQuery(kindsQuery).data;
  const items = kinds?.find((k) => k.kind === kind)?.items ?? {};
  const rawChanges = given ?? itemChanges(before, after, items);
  const correction = kind === 'run' && !fullRunSteps ? runCorrectionDiff(rawChanges) : undefined;
  const changes = correction?.changes ?? rawChanges;
  const [all, setAll] = useState(false);
  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, SHOWN);
  const currentDoc = (after?.attributes ?? before?.attributes ?? {}) as SopDoc;
  const previousDoc =
    adjacent && kind === 'sop' ? ((before?.attributes ?? {}) as SopDoc) : currentDoc;
  const terms = kind === 'sop' ? sopTerms(currentDoc) : undefined;
  const beforeTerms = adjacent && kind === 'sop' ? sopTerms(previousDoc) : terms;
  const words = (value: unknown, path: string, previous = false): ReactNode =>
    itemWords(
      value,
      path,
      previous ? beforeTerms : terms,
      adjacent,
      previous ? previousDoc : currentDoc,
    );

  // Items of a touched list that didn't change, so "8 other steps unchanged" can be said.
  const touched = new Map<string, Set<string>>();
  for (const c of changes) {
    const [list = '', key] = c.path.split('/').slice(1);
    if (items[list] && key !== undefined)
      touched.set(list, (touched.get(list) ?? new Set()).add(key));
  }
  const folded = [...touched].flatMap(([list, keys]) => {
    const now = after?.attributes?.[list];
    const spec = items[list] ?? 'id';
    const rest = Array.isArray(now) ? now.filter((i) => !keys.has(keyOf(i, spec) ?? '')).length : 0;
    return rest > 0 ? [`${rest} other ${rest === 1 ? singular(list) : list} unchanged`] : [];
  });

  return (
    <>
      <div className="table-wrap">
        <table
          className={`review-fields item-diff${adjacent ? ' history-diff' : ''}${correction ? ' run-correction-diff' : ''}`}
        >
          <caption className="sr-only">{caption}</caption>
          {adjacent && (
            <thead>
              <tr>
                <th>What changed</th>
                <th>Before → After</th>
              </tr>
            </thead>
          )}
          <tbody>
            {shown.map((c) => {
              const said = agentSaid(after?.evidence?.[evidenceKey(c.path, items)]);
              const note = after?.evidence?.[evidenceKey(c.path, items)]?.note;
              return (
                <tr key={c.path} className={said ? 'agent-said' : undefined}>
                  <th scope="row" title={adjacent ? undefined : c.path}>
                    {labels?.[c.path] ??
                      correction?.labels[c.path] ??
                      partLabel(c.path, after?.attributes, items, before?.attributes)}
                    {correction && c.path in correction.planned && (
                      <div className="muted">
                        Original plan: {formatValue(correction.planned[c.path])}
                      </div>
                    )}
                  </th>
                  {adjacent ? (
                    <td>
                      <div className="history-comparison">
                        {c.change === 'added' || isNew ? (
                          <span className="muted">Added</span>
                        ) : (
                          <>
                            <div className="muted">
                              {correction && <span className="diff-side">Before: </span>}
                              {words(c.before, c.path, true)}
                            </div>
                            <span className={correction ? 'diff-arrow' : undefined}>→</span>
                          </>
                        )}
                        {c.change === 'removed' ? (
                          <span>Removed</span>
                        ) : (
                          <div>
                            {correction && <span className="diff-side">After: </span>}
                            {words(c.after, c.path)}
                          </div>
                        )}
                        {said && (
                          <span className="agent-ink" title={note}>
                            · {said}
                          </span>
                        )}
                      </div>
                    </td>
                  ) : (
                    <>
                      <td>
                        {correction && <span className="diff-side">Before: </span>}
                        {c.change === 'added' || isNew ? (
                          <span className="muted">{isNew ? 'new' : 'added'}</span>
                        ) : (
                          <span className="was">{words(c.before, c.path)}</span>
                        )}
                      </td>
                      <td>
                        {correction && <span className="diff-side">After: </span>}
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
                    </>
                  )}
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
      {correction && (
        <details className="tech">
          <summary>
            Full checklist and correction details
            {correction.unchanged > 0 &&
              ` · ${correction.unchanged} other ${correction.unchanged === 1 ? 'step' : 'steps'} unchanged`}
          </summary>
          <ItemDiff
            kind={kind}
            before={before}
            after={after}
            changes={[correction.raw]}
            adjacent={adjacent}
            caption="Full checklist change"
            fullRunSteps
          />
        </details>
      )}
    </>
  );
}

const singular = (list: string) =>
  list.endsWith('ies') ? `${list.slice(0, -3)}y` : list.replace(/s$/, '');

/**
 * A changed value in lab words: an SOP's step words with values by their names, an added item on
 * one line ("Wash volume = 300 µL, protocol default"), anything else as the record page shows it.
 */
function itemWords(
  value: unknown,
  path: string,
  terms: Terms | undefined,
  fullStep = false,
  doc?: SopDoc,
): ReactNode {
  const [list = '', key, ...inside] = path.split('/').slice(1);
  if (fullStep && terms && list === 'steps' && key === undefined && Array.isArray(value)) {
    const parsed = SopStep.array().safeParse(value);
    if (!parsed.success)
      return (
        <span className="muted">
          Scientific settings cannot be rendered for these historical steps. The stored steps remain
          available under Version and technical details.
        </span>
      );
    if (parsed.data.length === 0) return <span className="muted">No steps recorded.</span>;
    return (
      <ol>
        {parsed.data.map((step) => (
          <li key={step.id}>
            <HistoryStep step={step} terms={terms} doc={doc} />
          </li>
        ))}
      </ol>
    );
  }
  if (terms && typeof value === 'string') return wordsText(value, terms);
  if (key !== undefined && inside.length === 0 && value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (terms && list === 'variables') {
      const v = item as Partial<SopVariable>;
      const text = valueText(v, terms);
      return `${itemName(item) ?? key}${text ? ` = ${text}` : ''}, ${kindWords(v, terms)}`;
    }
    if (terms && list === 'steps' && typeof item.text === 'string') {
      if (fullStep) {
        const parsed = SopStep.safeParse(item);
        if (parsed.success) return <HistoryStep step={parsed.data} terms={terms} doc={doc} />;
        return (
          <div>
            <div>
              {itemName(item) ?? key}: {wordsText(item.text, terms)}
            </div>
            <div className="muted">
              Scientific settings cannot be rendered for this historical step. The stored step
              remains available under Version and technical details.
            </div>
          </div>
        );
      }
      return `${itemName(item) ?? key}: ${wordsText(item.text, terms)}`;
    }
  }
  return renderValue(value, list);
}

/** Complete persisted settings on an added or removed step, using that snapshot's SOP terms. */
function HistoryStep({
  step,
  terms,
  doc,
}: {
  step: SopStep;
  terms: Terms;
  doc?: SopDoc | undefined;
}) {
  const material = (role: string) =>
    terms.materials.find((term) => term.name === role)?.label ?? fieldLabel(role);
  const variable = (name: string) => {
    const declared = doc?.variables?.find((value) => value.name === name);
    const label =
      declared?.label ?? terms.values.find((term) => term.name === name)?.label ?? fieldLabel(name);
    const stored = declared ? valueText(declared, terms) : '';
    const source = declared?.kind ? kindWords(declared, terms) : '';
    return stored ? `${stored} (${label}${source ? `, ${source}` : ''})` : label;
  };
  const settings = [
    ...(step.parameters ?? []).map(
      (parameter) =>
        `${fieldLabel(parameter.name)}: ${parameter.variable ? variable(parameter.variable) : formatValue(parameter.quantity ?? parameter.number ?? parameter.text)}`,
    ),
    ...(step.repeat ? [`Repeat ${step.repeat} times`] : []),
    ...(step.uses?.length ? [`Uses ${step.uses.map(material).join(', ')}`] : []),
    ...(step.produces?.length
      ? [`Produces ${step.produces.map((output) => output.label).join(', ')}`]
      : []),
    ...(step.group ? [`Group: ${step.group}`] : []),
  ];
  return (
    <div className="history-step">
      <div>
        <b>{step.title ?? actionWords[step.action]}</b>: {wordsText(step.text, terms)}
      </div>
      {step.title && step.title !== actionWords[step.action] && (
        <div className="muted">Action: {actionWords[step.action]}</div>
      )}
      {settings.length > 0 && <div>{settings.join(' · ')}</div>}
      {step.prerequisite && (
        <div>
          First follow <LinkedName id={step.prerequisite} />
        </div>
      )}
      <Cites cites={step.cite} />
    </div>
  );
}

import { variablesOf } from '@ailab/domain';
import type { SopVariable } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { formatValue } from '../lib/format.ts';
import {
  fieldWords,
  formulaText,
  kindWords,
  picksAt,
  type SopDoc,
  type Terms,
  type TextMode,
  type Token,
  tokenize,
} from '../lib/sop-text.ts';
import { recordQuery } from '../queries.ts';

/**
 * The SOP's highlighted text box and hover cards (ADR 0046). One box serves a value's formula and a
 * step's words: values light up blue and materials orange as they are typed, a name that is not
 * one is underlined amber, and a pick list under the caret offers the names that fit (Tab or Enter
 * takes one). It is a plain textarea with transparent text over a mirror that paints the same
 * characters, so typing, selection, undo and screen readers stay the browser's own.
 */

type TermType = 'value' | 'material';

export interface TermInfo {
  title: string;
  rows: [string, ReactNode][];
  /** An agent's value nobody has confirmed, or an assumed one: shown in agent ink. */
  assumed?: boolean;
}

export type Describe = (type: TermType, name: string) => TermInfo | undefined;

interface Cards {
  show: (anchor: DOMRect, type: TermType, name: string) => void;
  hide: () => void;
}

const CardContext = createContext<Cards | null>(null);

/** Hover cards for the values and materials inside it: what each is and how it is worked out. */
export function TermCards({ describe, children }: { describe: Describe; children: ReactNode }) {
  const [shown, setShown] = useState<{ anchor: DOMRect; type: TermType; name: string }>();
  const cards = useMemo<Cards>(
    () => ({
      show: (anchor, type, name) =>
        setShown((s) =>
          s?.name === name && s.type === type && s.anchor.top === anchor.top
            ? s
            : { anchor, type, name },
        ),
      hide: () => setShown(undefined),
    }),
    [],
  );
  const info = shown && describe(shown.type, shown.name);
  return (
    <CardContext.Provider value={cards}>
      {children}
      {shown && info && createPortal(<TermCard anchor={shown.anchor} info={info} />, document.body)}
    </CardContext.Provider>
  );
}

function TermCard({ anchor, info }: { anchor: DOMRect; info: TermInfo }) {
  const width = 320;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = anchor.bottom + 180 < window.innerHeight;
  return (
    <div
      className={`term-card${info.assumed ? ' assumed' : ''}`}
      role="tooltip"
      style={{
        left,
        maxWidth: width,
        ...(below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }),
      }}
    >
      <b className="term-title">{info.title}</b>
      <dl>
        {info.rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A value or material in read mode: hover, focus or tap shows its card. */
export function TermAnchor({
  type,
  name,
  className,
  children,
}: {
  type: TermType;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const cards = useContext(CardContext);
  const show = (el: HTMLElement) => cards?.show(el.getBoundingClientRect(), type, name);
  return (
    // A button, so keyboard and touch reach the card too; it reads inline, as the word it is.
    <button
      type="button"
      className={`term-anchor ${type === 'value' ? 't-val' : 't-mat'} ${className ?? ''}`}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => cards?.hide()}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => cards?.hide()}
    >
      {children}
    </button>
  );
}

export interface Checked {
  problem?: string | undefined;
  fix?: { from: number; to: number; text: string } | undefined;
}

const tokenClass: Partial<Record<Token['type'], string>> = {
  value: 't-val',
  material: 't-mat',
  op: 't-op',
  fn: 't-fn',
  unknown: 't-unk',
};

/** An operator as it is shown: * and / read as × and ÷ (one character each, so the caret fits). */
const opShown = (text: string) =>
  text === '*' ? '×' : text === '/' ? '÷' : text === '-' ? '−' : text;

/**
 * The highlighted text box. `check` says what is wrong with a text, if anything: a problem marks
 * the box amber and holds the form's Save until fixed, and a fix offers the likely name for a
 * mistyped one.
 */
export function TermBox({
  text,
  onChange,
  terms,
  mode,
  label,
  placeholder,
  check,
  assumed,
  onBlur,
}: {
  text: string;
  onChange: (text: string) => void;
  terms: Terms;
  mode: TextMode;
  label: string;
  placeholder?: string;
  check?: (text: string) => Checked;
  /** Filled in by the assistant and not yet kept: shown in agent ink. */
  assumed?: boolean;
  onBlur?: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const pending = useRef<number | null>(null);
  const cards = useContext(CardContext);
  const [caret, setCaret] = useState<number | null>(null);
  const [chosen, setChosen] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const problemId = useId();
  const listId = useId();
  const tokens = useMemo(() => tokenize(text, terms, mode), [text, terms, mode]);
  const found = caret === null || dismissed ? undefined : picksAt(text, caret, terms, mode);
  const picks = found?.picks ?? [];
  const active = Math.min(chosen, Math.max(0, picks.length - 1));

  useLayoutEffect(() => {
    const el = area.current;
    if (el && pending.current !== null) {
      el.setSelectionRange(pending.current, pending.current);
      setCaret(pending.current);
      pending.current = null;
    }
  });
  const { problem, fix } = check?.(text) ?? {};
  useEffect(() => {
    area.current?.setCustomValidity(problem ?? '');
  }, [problem]);

  const replace = (from: number, to: number, insert: string) => {
    pending.current = from + insert.length;
    setChosen(0);
    setDismissed(false);
    const next = text.slice(0, from) + insert + text.slice(to);
    area.current?.setCustomValidity(check?.(next).problem ?? '');
    onChange(next);
  };
  const accept = (i: number) => {
    const pick = picks[i];
    if (found && pick && caret !== null) replace(found.from, caret, pick.insert);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picks.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : picks.length - 1;
        setChosen((active + step) % picks.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        accept(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    // A formula is one line; Enter would only add a break the calculator can't read.
    if (e.key === 'Enter' && mode === 'formula') e.preventDefault();
  };
  const hover = (e: MouseEvent) => {
    if (!cards || !mirror.current) return;
    for (const span of mirror.current.querySelectorAll<HTMLElement>('[data-term]')) {
      for (const r of span.getClientRects()) {
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          cards.show(r, span.dataset.term as TermType, span.dataset.name as string);
          return;
        }
      }
    }
    cards.hide();
  };
  const track = () => setCaret(area.current?.selectionStart ?? null);

  return (
    <div className="term-field">
      <div className={`term-box${problem ? ' bad' : ''}${assumed ? ' assumed' : ''}`}>
        <div ref={mirror} className="term-mirror" aria-hidden="true">
          {text === '' && placeholder ? (
            <span className="t-ph">{placeholder}</span>
          ) : (
            tokens.map((t) => {
              const cls =
                mode === 'words' && t.type !== 'value' && t.type !== 'material'
                  ? undefined
                  : tokenClass[t.type];
              const shown = t.type === 'op' ? opShown(t.text) : t.text;
              if (!cls) return shown;
              return (
                <span
                  key={t.from}
                  className={cls}
                  {...(t.type === 'value' || t.type === 'material'
                    ? { 'data-term': t.type, 'data-name': t.name }
                    : {})}
                >
                  {shown}
                </span>
              );
            })
          )}
          {/* Keeps a last empty line its height. */}
          {'​'}
        </div>
        <textarea
          ref={area}
          rows={1}
          spellCheck={false}
          aria-label={label}
          aria-invalid={!!problem}
          aria-describedby={problem ? problemId : undefined}
          aria-autocomplete="list"
          aria-controls={picks.length ? listId : undefined}
          value={text}
          onChange={(e) => {
            setChosen(0);
            setDismissed(false);
            setCaret(e.target.selectionStart);
            // Set now, not after the render, so the form's own change handler sees it.
            e.target.setCustomValidity(check?.(e.target.value).problem ?? '');
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={track}
          onClick={track}
          onFocus={track}
          onBlur={() => {
            setCaret(null);
            cards?.hide();
            onBlur?.();
          }}
          onMouseMove={hover}
          onMouseLeave={() => cards?.hide()}
        />
        {picks.length > 0 && (
          <div className="term-picks" id={listId} role="listbox" aria-label="Matching names">
            {picks.map((p, i) => (
              <div
                key={p.insert}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={i === active ? 'on' : undefined}
                // Keeps the caret in the box, so the pick replaces what was typed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(i);
                }}
              >
                <span>{p.label}</span>
                <span className={`pick-kind ${p.what}`}>{p.what}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* While picks are open the name is still being typed, so it isn't a problem yet. */}
      {problem && picks.length === 0 && (
        <p className="warn-ink term-problem" id={problemId}>
          {problem}
          {fix && (
            <>
              {' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  area.current?.focus();
                  replace(fix.from, fix.to, fix.text);
                }}
              >
                Use {fix.text}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function RecordName({ id }: { id: string }) {
  const { data } = useQuery(recordQuery(id));
  return <>{data ? data.label : id}</>;
}

/**
 * What a card says about a value or material of this SOP: its kind, formula, value now (`now`, from
 * the calculator) and source; a material's type, requirements, usual record and the values it gives.
 */
export function describeSop(
  doc: SopDoc,
  terms: Terms,
  now: (name: string) => { value: string; from?: string; assumed?: boolean } | undefined,
): Describe {
  return (type, name) => {
    if (type === 'value') {
      const v = (doc.variables ?? []).find((x) => x.name === name) as
        | Partial<SopVariable>
        | undefined;
      if (!v) return undefined;
      const rows: [string, ReactNode][] = [];
      const current = now(name);
      if (v.kind === 'computed' && v.expression)
        rows.push([
          'formula',
          <span key="formula" className="mono">
            {formulaText(v.expression, terms)}
          </span>,
        ]);
      if (v.kind === 'computed' && v.expression) {
        // The values it uses, each as it is now, so the chain reads without opening them.
        const uses = safeNames(v.expression).flatMap((n) => {
          const label = terms.values.find((t) => t.name === n)?.label;
          return label ? [`${label} ${now(n)?.value ?? '…'}`] : [];
        });
        if (uses.length) rows.push(['with', uses.join(' · ')]);
      }
      if (v.kind === 'record' && v.readFrom) {
        const m = terms.materials.find((x) => x.name === v.readFrom?.role);
        rows.push(['reads', `${m?.label ?? v.readFrom.role}.${fieldWords(v.readFrom.field)}`]);
      }
      if (current)
        rows.push(['now', current.from ? `${current.value} · ${current.from}` : current.value]);
      rows.push(['kind', kindWords(v, terms)]);
      if (v.kind === 'input' && (v.min !== undefined || v.max !== undefined))
        rows.push([
          'allowed',
          `${v.min === undefined ? '…' : formatValue(v.min)} to ${v.max === undefined ? '…' : formatValue(v.max)}`,
        ]);
      const cite = v.cite?.[0];
      if (cite) rows.push(['source', `“${cite.quote}”${cite.page ? `, p. ${cite.page}` : ''}`]);
      if (v.note) rows.push(['note', v.note]);
      return { title: v.label ?? name, rows, ...(current?.assumed ? { assumed: true } : {}) };
    }
    const m = (doc.materials ?? []).find((x) => x.role === name);
    const gives = (doc.variables ?? [])
      .filter((v) => v.readFrom?.role === name)
      .flatMap((v) => (v.label ? [v.label] : []));
    if (m) {
      const rows: [string, ReactNode][] = m.type ? [['type', m.type]] : [];
      if (m.requirements) rows.push(['needs', m.requirements]);
      if (m.default) rows.push(['usually', <RecordName key="usually" id={m.default} />]);
      if (gives.length) rows.push(['gives', gives.join(', ')]);
      return { title: m.label ?? name, rows };
    }
    const s = (doc.solutions ?? []).find((x) => x.role === name);
    if (s) return { title: s.label ?? name, rows: s.text ? [['made as', s.text]] : [] };
    const step = (doc.steps ?? []).find((x) => x.produces?.some((p) => p.role === name));
    const made = step?.produces?.find((p) => p.role === name);
    if (step && made)
      return { title: made.label, rows: [['made in', step.title ?? `step ${step.id}`]] };
    return undefined;
  };
}

function safeNames(expression: string): string[] {
  try {
    return variablesOf(expression);
  } catch {
    return [];
  }
}

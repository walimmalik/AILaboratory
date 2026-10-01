import {
  type Actor,
  type CheckResult,
  type FieldEvidence,
  labwareUseStandardPositions,
  type Me,
  type Readiness,
  type ReadinessSection,
  type RecordEnvelope,
  recordsConfirm,
  recordsConfirmSection,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { fieldLabel, formatWhen, isAgent, partLabel, problemWords } from '../lib/format.ts';
import { kindsQuery } from '../queries.ts';
import { LinkedName } from './Value.tsx';

export { fieldLabel } from '../lib/format.ts';

import { useMe } from '../session.ts';
import { SectionEditor } from './SectionEditor.tsx';

/**
 * Draft and confirm (plan 004c): the record as a person reviews it. One block per section with what
 * changed since it was confirmed and where each value came from, then what still stands in the way.
 */
export function ReviewBlocks({
  record,
  readiness,
  renderValue,
  aside,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  renderValue: (value: unknown, field?: string) => ReactNode;
  /** Shown between the readiness block and the sections, e.g. a labware drawing. */
  aside?: ReactNode;
}) {
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review');
  const blocked = readiness.checks.some((c) => !c.passed && c.severity === 'blocker');
  // Confirming the last section of a draft that nothing blocks also activates it (plan 004d, R6).
  const activates = record.status === 'draft' && toReview.length === 1 && !blocked;
  const [editing, setEditing] = useState<string>();
  const [scrollTo, setScrollTo] = useState<string>();
  useEffect(() => {
    if (!scrollTo) return;
    const block = document.getElementById(`section-${scrollTo}`);
    block?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    block?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    setScrollTo(undefined);
  }, [scrollTo]);
  const fix = (section: string) => {
    setEditing(section);
    setScrollTo(section);
  };
  const titles = Object.fromEntries(readiness.sections.map((s) => [s.id, s.title]));
  // A confirmed active record leads with its content (the drawing, the bench view, the deck).
  // Readiness and the sections fold into one block below it, one line each, opened on demand.
  const settled =
    record.status === 'active' &&
    readiness.ready &&
    readiness.checks.every((c) => c.passed || c.severity !== 'blocker');
  if (settled && !editing) {
    return (
      <>
        {aside}
        <SettledDetails
          record={record}
          readiness={readiness}
          titles={titles}
          renderValue={renderValue}
          onEdit={fix}
        />
      </>
    );
  }
  return (
    <>
      <ReadinessBlock record={record} readiness={readiness} titles={titles} onFix={fix} />
      {aside}
      {readiness.sections.map((section) => (
        <SectionBlock
          key={section.id}
          record={record}
          version={readiness.version}
          section={section}
          activates={activates && section.state === 'needs_review'}
          renderValue={renderValue}
          editing={editing === section.id}
          onEdit={(on) => setEditing(on ? section.id : undefined)}
          notApplicable={readiness.notApplicable}
        />
      ))}
    </>
  );
}

function useInvalidate(id: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['record', id] }),
      queryClient.invalidateQueries({ queryKey: ['review'] }),
    ]);
}

/**
 * What stands between the record and the lab, and one Confirm (ADR 0046, review 2026-10-01): it
 * confirms every part that nothing blocks, as it stands, and a draft left with nothing to do becomes
 * active. Which parts are confirmed sits under technical details; each part can still be confirmed
 * on its own from its block below.
 */
export function ReadinessBlock({
  record,
  readiness,
  titles,
  onFix,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  /** Section titles by ID, for the "Fix in …" links. */
  titles: Record<string, string>;
  onFix: (section: string) => void;
}) {
  const invalidate = useInvalidate(record.id);
  const draft = record.status === 'draft';
  const failing = readiness.checks.filter((c) => !c.passed && c.severity === 'blocker');
  const held = new Set(failing.flatMap((c) => (c.section ? [c.section] : [])));
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review');
  const confirmable = toReview.filter((s) => !held.has(s.id));
  const waiting = toReview.filter((s) => held.has(s.id));
  const activates = draft && failing.length === 0;
  const canConfirm = confirmable.length > 0 || (activates && toReview.length === 0);
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsConfirm, { id: record.id, expectedVersion: readiness.version }),
    onSuccess: invalidate,
  });
  const state = !draft
    ? readiness.ready
      ? { text: '✓ confirmed', tone: 'ok-ink' }
      : { text: 'changed since it was confirmed', tone: 'warn-ink' }
    : readiness.ready
      ? { text: 'ready to confirm', tone: 'ok-ink' }
      : failing.length > 0
        ? { text: `${failing.length} to fix`, tone: 'warn-ink' }
        : { text: 'ready to confirm', tone: 'ok-ink' };
  const words = (parts: ReadinessSection[]) => parts.map((s) => s.title.toLowerCase()).join(', ');
  const all = readiness.sections.length;
  const what = !canConfirm
    ? failing.length > 0
      ? 'Fix what blocks it first.'
      : ''
    : `${
        confirmable.length === 0
          ? 'Everything is confirmed.'
          : confirmable.length === all
            ? `Confirms ${all === 1 ? 'it' : `all ${all} parts`} as they stand.`
            : `Confirms ${words(confirmable)} as they stand.`
      }${activates ? ` ${record.name} becomes active for the lab.` : ''}${
        waiting.length
          ? ` ${capital(words(waiting))} ${waiting.length === 1 ? 'waits' : 'wait'} for the fixes above.`
          : ''
      }`;

  return (
    <section className="block" aria-label="Readiness">
      <header>
        <h2>Readiness</h2>
        <span className={`state ${state.tone}`}>{state.text}</span>
      </header>
      <div className="body">
        <Estimates
          record={record}
          readiness={readiness}
          onOpen={(path) => {
            const field = path.startsWith('/') ? (path.split('/')[1] ?? '') : path;
            const section = readiness.sections.find((s) => s.fields.some((f) => f.field === field));
            if (section) onFix(section.id);
          }}
        />
        {readiness.checks.some((c) => !c.passed) && (
          <Checks
            checks={readiness.checks}
            titles={titles}
            onFix={onFix}
            target={{ id: record.id, version: readiness.version }}
          />
        )}
        {record.status !== 'archived' && (canConfirm || what) && (
          <div className="actions">
            {canConfirm && (
              <button
                type="button"
                className="btn primary"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                {draft ? `Confirm ${record.name}` : 'Confirm the changes'}
              </button>
            )}
            <span className="muted">
              {toReview.length > 1 && `${toReview.length} parts to confirm. `}
              {what}
            </span>
          </div>
        )}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        <details className="tech">
          <summary>technical details</summary>
          {readiness.sections.length > 0 && (
            <ul className="plain">
              {readiness.sections.map((s) => (
                <li key={s.id}>
                  {s.title}: {s.state === 'confirmed' ? 'confirmed' : 'needs review'}
                  {s.review && ` (last confirmed at version ${s.review.version})`}
                </li>
              ))}
            </ul>
          )}
          <pre className="json">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

const SHOWN_ESTIMATES = 6;

/**
 * The agent's estimates a confirm would accept (rule 6), each by the name the record gives it and
 * opening where it is edited; past a handful, the rest fold to a count (UI rule: no overload).
 */
export function Estimates({
  record,
  readiness,
  onOpen,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  onOpen: (path: string) => void;
}) {
  const items = useQuery(kindsQuery).data?.find((k) => k.kind === record.kind)?.items;
  const [all, setAll] = useState(false);
  const paths = readiness.assumed;
  if (paths.length === 0) return null;
  const shown = all ? paths : paths.slice(0, SHOWN_ESTIMATES);
  return (
    <p className="agent-ink estimates">
      {paths.length === 1 ? 'One value was' : `${paths.length} values were`} entered by an agent
      without a source:{' '}
      {shown.map((path, i) => (
        <span key={path}>
          {i > 0 && ', '}
          <button type="button" className="link-btn agent-ink" onClick={() => onOpen(path)}>
            {partLabel(path, record.attributes, items)}
          </button>
        </span>
      ))}
      {paths.length > shown.length && (
        <>
          {' '}
          <button type="button" className="link-btn" onClick={() => setAll(true)}>
            and {paths.length - shown.length} more
          </button>
        </>
      )}
      . Verify {paths.length === 1 ? 'it' : 'them'} before you confirm.
    </p>
  );
}

const capital = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;

/**
 * A record's readiness and sections as one block: a line each, saying who confirmed it and how many
 * of its fields hold a value, opened in place. Editing a section opens the full review (the SOP page
 * opens its whole-page editor).
 */
export function SettledDetails({
  record,
  readiness,
  titles,
  renderValue,
  onEdit,
  checks = true,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  titles: Record<string, string>;
  renderValue: (value: unknown, field?: string) => ReactNode;
  onEdit: (section: string) => void;
  /** Whether the checks get a line here; off when a readiness block above already lists them. */
  checks?: boolean;
}) {
  const me = useMe();
  const [open, setOpen] = useState<string>();
  const toggle = (id: string) => setOpen(open === id ? undefined : id);
  const warnings = readiness.checks.filter((c) => !c.passed).length;
  const passing = readiness.checks.length - warnings;
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review').length;
  return (
    <section className="block" aria-label="Details">
      <header>
        <h2>Details</h2>
        {toReview === 0 ? (
          <span className="state ok-ink">✓ confirmed</span>
        ) : (
          <span className="state warn-ink">
            {toReview === 1 ? '1 part needs review' : `${toReview} parts need review`}
          </span>
        )}
      </header>
      <div className="body">
        <ul className="settled">
          {checks && readiness.checks.length > 0 && (
            <li>
              <button
                type="button"
                className="settled-line"
                aria-expanded={open === 'readiness'}
                onClick={() => toggle('readiness')}
              >
                <b>Checks</b>
                <span className="muted">
                  {passing} {passing === 1 ? 'check passes' : 'checks pass'}
                  {warnings > 0 && (
                    <span className="warn-ink">
                      {' '}
                      · {warnings} {warnings === 1 ? 'warning' : 'warnings'}
                    </span>
                  )}
                </span>
              </button>
              {open === 'readiness' && (
                <Checks
                  checks={readiness.checks}
                  titles={titles}
                  onFix={onEdit}
                  target={{ id: record.id, version: readiness.version }}
                />
              )}
            </li>
          )}
          {readiness.sections.map((section) => {
            return (
              <li key={section.id} id={`section-${section.id}`}>
                <button
                  type="button"
                  className="settled-line"
                  aria-expanded={open === section.id}
                  onClick={() => toggle(section.id)}
                >
                  <b>{section.title}</b>
                  <span className="muted">
                    {filledWords(section)}
                    {section.state === 'needs_review' ? (
                      <span className="warn-ink"> · needs review</span>
                    ) : (
                      section.review &&
                      ` · confirmed by ${who(section.review.confirmedBy, me)} ${formatWhen(section.review.confirmedAt)}`
                    )}
                  </span>
                </button>
                {open === section.id && (
                  <>
                    <SectionValues
                      section={section}
                      me={me}
                      renderValue={renderValue}
                      notApplicable={readiness.notApplicable}
                      hideEmpty
                    />
                    {record.status !== 'archived' && (
                      <div className="actions">
                        <button type="button" className="btn" onClick={() => onEdit(section.id)}>
                          Edit {section.title.toLowerCase()}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <details className="tech">
          <summary>technical details</summary>
          <pre className="json">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

/** "11 steps", "6 materials · 2 solutions" for sections of lists; "2 of 7 filled" otherwise. */
function filledWords(section: ReadinessSection): string {
  const values = section.fields.filter((f) => !isEmpty(f.value));
  if (values.length === 0) return 'empty';
  if (values.every((f) => Array.isArray(f.value)))
    return values
      .map((f) => `${(f.value as unknown[]).length} ${fieldLabel(f.field).toLowerCase()}`)
      .join(' · ');
  return `${values.length} of ${section.fields.length} filled`;
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const rank = (c: CheckResult) => (c.passed ? 2 : c.severity === 'blocker' ? 0 : 1);

/** Failing checks first, each with a link to the section that fixes it; passing ones folded away. */
export function Checks({
  checks,
  titles,
  onFix,
  target,
}: {
  checks: CheckResult[];
  titles: Record<string, string>;
  onFix: (section: string) => void;
  target: Target;
}) {
  const failing = [...checks].filter((c) => !c.passed).sort((a, b) => rank(a) - rank(b));
  const passing = checks.filter((c) => c.passed);
  const table = (rows: CheckResult[]) => (
    <div className="table-wrap">
      <table className="checks">
        <tbody>
          {rows.map((check) => (
            <CheckRow key={check.id} check={check} titles={titles} onFix={onFix} target={target} />
          ))}
        </tbody>
      </table>
    </div>
  );
  const required = failing.filter((c) => c.severity === 'blocker');
  const recommended = failing.filter((c) => c.severity !== 'blocker');
  return (
    <>
      {required.length > 0 && (
        <>
          <p className="check-group crit-ink">Required before confirming</p>
          {table(required)}
        </>
      )}
      {recommended.length > 0 && (
        <>
          <p className="check-group warn-ink">Recommended</p>
          {table(recommended)}
        </>
      )}
      {passing.length > 0 && (
        <details className="passing">
          <summary className="ok-ink">
            ✓ {passing.length === 1 ? '1 check passes' : `${passing.length} checks pass`}
          </summary>
          {table(passing)}
        </details>
      )}
    </>
  );
}

/** The record a quick fix changes, at the version the checks were worked out for. */
interface Target {
  id: string;
  version: number;
}

/** Operations a check may offer as a one-step fix; each takes the record and its version. */
const quickFixes = { 'labware.use_standard_positions': labwareUseStandardPositions } as const;

function CheckRow({
  check,
  titles,
  onFix,
  target,
}: {
  check: CheckResult;
  titles: Record<string, string>;
  onFix: (section: string) => void;
  target: Target;
}) {
  const mark = check.passed ? '✓' : check.severity === 'blocker' ? '✗' : '!';
  const tone = check.passed ? 'ok-ink' : check.severity === 'blocker' ? 'crit-ink' : 'warn-ink';
  const section = check.section && titles[check.section] ? check.section : undefined;
  return (
    <tr>
      <td
        className={`mark ${tone}`}
        aria-label={check.passed ? 'passes' : check.severity === 'blocker' ? 'blocks' : 'warning'}
      >
        {mark}
      </td>
      <td>
        {check.passed ? check.label : problemWords(check)}
        {!check.passed && (check.fix || section || check.record) && (
          <div className="muted">
            {check.fix}
            {check.fix && (section || check.record) && ' · '}
            {/* A check waiting on another record is fixed there, not in a section of this one. */}
            {check.record ? (
              <Link to="/records/$id" params={{ id: check.record }}>
                Open it
              </Link>
            ) : (
              section && (
                <button type="button" className="link-btn" onClick={() => onFix(section)}>
                  Fix in {titles[section]?.toLowerCase()}
                </button>
              )
            )}
          </div>
        )}
        {!check.passed && check.quickFix && <QuickFix fix={check.quickFix} target={target} />}
      </td>
      {/* The source in lab words; plan and ADR numbers stay on hover. */}
      <td className="muted source" title={check.source}>
        {check.source?.replace(/\s*\((?:plan|ADR)[^)]*\)/gi, '')}
      </td>
    </tr>
  );
}

/** A one-step fix the check offers, run as its operation; the record then reloads. */
function QuickFix({ fix, target }: { fix: NonNullable<CheckResult['quickFix']>; target: Target }) {
  const queryClient = useQueryClient();
  const contract = quickFixes[fix.operation as keyof typeof quickFixes];
  const run = useMutation({
    mutationFn: () => api.run(contract, { id: target.id, expectedVersion: target.version }),
    onSuccess: () =>
      Promise.all(
        [['record', target.id], ['review'], ['records']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  if (!contract) return null;
  return (
    <div className="quick-fix">
      <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
        {fix.label}
      </button>
      {run.error && <span className="error-text"> {run.error.message}</span>}
    </div>
  );
}

function SectionBlock({
  record,
  version,
  section,
  activates,
  renderValue,
  editing,
  onEdit,
  notApplicable,
}: {
  record: RecordEnvelope;
  /** The version the readiness report describes: what the person is looking at and confirming. */
  version: number;
  section: ReadinessSection;
  /** Whether confirming this section also makes the draft active. */
  activates: boolean;
  renderValue: (value: unknown, field?: string) => ReactNode;
  editing: boolean;
  onEdit: (on: boolean) => void;
  notApplicable: string[];
}) {
  const me = useMe();
  const invalidate = useInvalidate(record.id);
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsConfirmSection, {
        id: record.id,
        expectedVersion: version,
        section: section.id,
      }),
    onSuccess: invalidate,
  });
  const confirmed = section.state === 'confirmed';
  const changed = section.fields.some((f) => f.state === 'changed');

  return (
    <section className="block" aria-label={section.title} id={`section-${section.id}`}>
      <header>
        <h2>{section.title}</h2>
        {confirmed && section.review ? (
          <span className="state ok-ink">
            ✓ confirmed by {who(section.review.confirmedBy, me)}{' '}
            {formatWhen(section.review.confirmedAt)}
          </span>
        ) : (
          <span className="state warn-ink">
            {changed ? 'changed, needs review' : 'needs review'}
          </span>
        )}
      </header>
      <div className="body">
        {editing ? (
          <SectionEditor
            record={record}
            fields={section.fields.map((f) => f.field)}
            notApplicable={notApplicable}
            onDone={() => onEdit(false)}
          />
        ) : (
          <SectionValues
            section={section}
            me={me}
            renderValue={renderValue}
            notApplicable={notApplicable}
          />
        )}
        {!editing && record.status !== 'archived' && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => onEdit(true)}>
              Edit {section.title.toLowerCase()}
            </button>
            {!confirmed && (
              <button
                type="button"
                className="link-btn"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                confirm only {section.title.toLowerCase()}
                {activates && `, which makes ${record.name} active`}
              </button>
            )}
            {!confirmed && changed && (
              <span className="muted">Highlighted values changed since they were confirmed.</span>
            )}
          </div>
        )}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
      </div>
    </section>
  );
}

function SectionValues({
  section,
  me,
  renderValue,
  notApplicable,
  hideEmpty = false,
}: {
  section: ReadinessSection;
  me: Me | undefined;
  renderValue: (value: unknown, field?: string) => ReactNode;
  notApplicable: string[];
  /** Leaves out fields with no value, for a confirmed record read rather than reviewed. */
  hideEmpty?: boolean;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyCount = hideEmpty ? section.fields.filter((f) => isEmpty(f.value)).length : 0;
  return (
    <div className="table-wrap">
      <table className="review-fields">
        <tbody>
          {section.fields
            .filter((f) => !(notApplicable.includes(f.field) && f.value === undefined))
            .filter((f) => !hideEmpty || showEmpty || !isEmpty(f.value))
            .map((f) => (
              <tr key={f.field} className={f.state === 'changed' ? 'changed' : undefined}>
                <td className="name">{fieldLabel(f.field)}</td>
                <td>
                  {f.state === 'changed' && (
                    <>
                      <span className="was">{renderValue(f.confirmedValue, f.field)}</span>{' '}
                    </>
                  )}
                  <span className={f.state === 'changed' ? 'now' : undefined}>
                    {renderValue(f.value, f.field)}
                  </span>
                  {f.items && f.state !== 'confirmed' && <ItemChanges field={f} />}
                </td>
                <td className="source">
                  {f.assumed ? (
                    <span className="agent-ink">
                      unverified · entered by {who(f.evidence?.by, me)}, no source
                    </span>
                  ) : (
                    <Evidence evidence={f.evidence} me={me} />
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {emptyCount > 0 && (
        <button type="button" className="link-btn" onClick={() => setShowEmpty(!showEmpty)}>
          {showEmpty ? 'hide empty fields' : `show ${emptyCount} empty fields`}
        </button>
      )}
    </div>
  );
}

/**
 * What changed in a keyed list since it was confirmed (ADR 0049): which items changed, were added or
 * removed, whether the order moved, and which are guesses. Unchanged items stay confirmed.
 */
function ItemChanges({ field }: { field: ReadinessSection['fields'][number] }) {
  const items = field.items ?? [];
  const by = (state: string) => items.filter((i) => i.state === state).map((i) => i.key);
  const parts = [
    [by('changed'), 'changed'],
    [by('added'), 'added'],
    [(field.removed ?? []).map((r) => r.key), 'removed'],
  ] as const;
  const assumed = items.filter((i) => i.assumed).map((i) => i.key);
  const confirmed = by('confirmed').length;
  return (
    <p className="muted item-changes">
      {parts
        .filter(([keys]) => keys.length > 0)
        .map(([keys, word]) => `${keys.join(', ')} ${word}`)
        .join(' · ')}
      {field.reordered && ' · order changed'}
      {confirmed > 0 && field.state === 'changed' && ` · ${confirmed} still confirmed`}
      {assumed.length > 0 && <span className="agent-ink"> · assumed: {assumed.join(', ')}</span>}
    </p>
  );
}

const sourceWords: Record<FieldEvidence['source'], string> = {
  // Only shown once a person has confirmed the value; before that it reads "assumed by …".
  assumed: 'entered without a source',
  stated: 'stated',
  person: 'entered',
  datasheet: 'from a datasheet',
  imported: 'imported',
  measured: 'measured',
  calculated: 'calculated',
  record: 'from',
  template: 'template default from',
  memory: 'lab memory',
};

function Evidence({ evidence, me }: { evidence: FieldEvidence | undefined; me: Me | undefined }) {
  const assistant = useAssistant();
  if (!evidence) return <span className="muted">—</span>;
  const by = evidence.by;
  const words =
    evidence.source === 'person'
      ? `entered by ${who(by, me)}`
      : evidence.source === 'stated' && by.type === 'agent'
        ? `stated by ${me && by.onBehalfOf === me.user.id ? 'you' : 'a lab member'} to ${by.agentName}`
        : evidence.from
          ? sourceWords[evidence.source]
          : `${sourceWords[evidence.source]}${isAgent(by) ? ` by ${who(by, me)}` : ''}`;
  const conversation =
    evidence.source === 'stated' && by.type === 'agent' && by.sessionRef?.startsWith('cnv_')
      ? by.sessionRef
      : undefined;
  return (
    // Only guesses and what a person told an agent are in agent ink (plan 004e R5).
    <span className={evidence.source === 'stated' ? 'agent-ink' : 'muted'}>
      {words}
      {evidence.from && (
        <>
          {' '}
          <LinkedName id={evidence.from.id} /> v{evidence.from.version}
        </>
      )}
      {conversation && (
        <>
          {' · '}
          <button type="button" className="link-btn" onClick={() => assistant.show(conversation)}>
            conversation
          </button>
        </>
      )}
      {evidence.note && ` · ${evidence.note}`}
      {evidence.reference &&
        (/^https?:\/\//.test(evidence.reference) ? (
          <>
            {' · '}
            <a href={evidence.reference} target="_blank" rel="noreferrer">
              source
            </a>
          </>
        ) : (
          ` · ${evidence.reference}`
        ))}
    </span>
  );
}

/** "you", "a lab member", or the agent's name. */
function who(actor: Actor | undefined, me: Me | undefined): string {
  if (!actor) return 'someone';
  if (actor.type === 'agent') return actor.agentName;
  return me && actor.userId === me.user.id ? 'you' : 'a lab member';
}

import {
  type Actor,
  type CheckOption,
  type CheckResult,
  experimentsAdoptVersions,
  labwareUseStandardPositions,
  type Me,
  type OperationContract,
  type Readiness,
  type ReadinessSection,
  type RecordEnvelope,
  recordsConfirm,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { kindFieldWords, partLabel, problemWords } from '../lib/format.ts';
import { kindsQuery } from '../queries.ts';
import { FromLabMemory } from './LabNotes.tsx';

export { fieldLabel } from '../lib/format.ts';

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
  editing,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  /** Section titles by ID, for the "Fix in …" links. */
  titles: Record<string, string>;
  onFix: (section: string) => void;
  /**
   * The section open in an editor: Confirm waits until it is saved or cancelled, so it never
   * confirms the stored values while the screen shows different ones (QA 2026-10-01 Q1).
   */
  editing?: string | undefined;
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
  const warnings = readiness.checks.filter((c) => !c.passed && c.severity !== 'blocker').length;
  const unchecked = record.status === 'archived' ? 0 : readiness.unchecked.length;
  // The header already says "confirmed"; here, only what is left.
  const state = !draft
    ? readiness.ready
      ? warnings > 0
        ? { text: `${warnings} recommended`, tone: 'warn-ink' }
        : { text: '✓ confirmed', tone: 'ok-ink' }
      : { text: 'changed since it was confirmed', tone: 'warn-ink' }
    : failing.length > 0
      ? { text: `${failing.length} to fix`, tone: 'warn-ink' }
      : unchecked > 0
        ? { text: 'needs your review', tone: 'warn-ink' }
        : { text: 'ready to confirm', tone: 'ok-ink' };
  const words = (parts: ReadinessSection[]) => parts.map((s) => s.title.toLowerCase()).join(', ');
  const all = readiness.sections.length;
  const what = !canConfirm
    ? failing.length > 0
      ? 'Fix what blocks it first.'
      : ''
    : `${
        readiness.sections.length === 0
          ? 'Confirms it as it stands.'
          : confirmable.length === 0
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
        <FromLabMemory record={record} />
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
                disabled={confirm.isPending || editing !== undefined}
                onClick={() => confirm.mutate()}
              >
                {draft ? `Confirm ${record.name}` : 'Confirm the changes'}
              </button>
            )}
            <span className="muted">
              {editing !== undefined && canConfirm ? (
                `Save or cancel your edit of ${(titles[editing] ?? 'this part').toLowerCase()} first: Confirm takes the saved values.`
              ) : (
                <>
                  {toReview.length > 1 && `${toReview.length} parts to confirm. `}
                  {what}
                </>
              )}
            </span>
          </div>
        )}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        {unchecked > 0 && (
          <p>
            {unchecked}{' '}
            {unchecked === 1
              ? 'value needs checking against its source.'
              : 'values need checking against their sources.'}{' '}
            <Link to="/records/$id" params={{ id: record.id }} search={{ tab: 'fields' }}>
              Review values and sources
            </Link>
          </p>
        )}
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
      {paths.length === 1 ? 'One value remains' : `${paths.length} values remain`} unverified:{' '}
      {shown.map((path, i) => (
        <span key={path}>
          {i > 0 && ', '}
          <button type="button" className="link-btn agent-ink" onClick={() => onOpen(path)}>
            {estimateWords(record, path, items)}
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

/** A top-level field by its lab words; an item inside a list by the name the record gives it. */
function estimateWords(
  record: RecordEnvelope,
  path: string,
  items: Readonly<Record<string, string>> | undefined,
): string {
  const top = path.replace(/^\//, '');
  return top.includes('/')
    ? partLabel(path, record.attributes, items)
    : kindFieldWords(record.kind, top);
}

const capital = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;

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

/** Operations checks offer as one-step fixes; an option naming another one isn't shown. */
const fixContracts: Record<string, OperationContract> = {
  'labware.use_standard_positions': labwareUseStandardPositions,
  'experiments.adopt_versions': experimentsAdoptVersions,
};

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
  // A check that says there is nothing to do yet offers nowhere to fix it (review 2026-10-02, 18).
  const waiting = !!check.fix?.startsWith('Nothing to do');
  const section = check.section && titles[check.section] && !waiting ? check.section : undefined;
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
        {!check.passed && check.options && <FixOptions options={check.options} target={target} />}
      </td>
      {/* The source in lab words; plan and ADR numbers stay on hover. */}
      <td className="muted source" title={check.source}>
        {check.source?.replace(/\s*\((?:plan|ADR)[^)]*\)/gi, '')}
      </td>
    </tr>
  );
}

/**
 * The ways a failing check can be fixed in one step, best first (review 2026-10-01 item 19): each
 * a button saying what it does, run as its operation; the record then reloads.
 */
function FixOptions({ options, target }: { options: CheckOption[]; target: Target }) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: (option: CheckOption) =>
      api.run(fixContracts[option.operation] as OperationContract, option.input as never),
    onSuccess: () =>
      Promise.all(
        [['record', target.id], ['review'], ['records']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const offered = options.filter((o) => fixContracts[o.operation]);
  if (offered.length === 0) return null;
  return (
    <ul className="fix-options">
      {offered.map((option, i) => (
        <li key={option.label}>
          <button
            type="button"
            className="btn"
            disabled={run.isPending}
            onClick={() => run.mutate(option)}
          >
            {option.label}
          </button>
          <span className="muted">
            {offered.length > 1 && i === 0 && 'Recommended. '}
            {option.consequence}
          </span>
        </li>
      ))}
      {run.error && <li className="error-text">{run.error.message}</li>}
    </ul>
  );
}

/**
 * What changed in a keyed list since it was confirmed (ADR 0049): which items changed, were added or
 * removed, whether the order moved, and which are guesses. Unchanged items stay confirmed.
 */
export function ItemChanges({ field }: { field: ReadinessSection['fields'][number] }) {
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

/** "you", "a lab member", or the agent's name. */
export function who(actor: Actor | undefined, me: Me | undefined): string {
  if (!actor) return 'someone';
  if (actor.type === 'agent') return actor.agentName;
  return me && actor.userId === me.user.id ? 'you' : 'a lab member';
}

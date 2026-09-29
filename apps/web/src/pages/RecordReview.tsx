import {
  type Actor,
  type CheckResult,
  type FieldEvidence,
  labwareUseStandardPositions,
  type Me,
  type Readiness,
  type ReadinessSection,
  type RecordEnvelope,
  recordsActivate,
  recordsConfirmSection,
} from '@ailab/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { formatWhen, isAgent } from '../lib/format.ts';
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
  renderValue: (value: unknown) => ReactNode;
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

function ReadinessBlock({
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
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsActivate, { id: record.id, expectedVersion: readiness.version }),
    onSuccess: invalidate,
  });
  const draft = record.status === 'draft';
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review').length;
  // Kinds with sections activate with their last section's confirm (plan 004d); only kinds without
  // sections, or a draft left ready, need the record-level Confirm.
  const sectioned = readiness.sections.length > 0;
  const state = !draft
    ? readiness.ready
      ? { text: '✓ confirmed', tone: 'ok-ink' }
      : { text: 'changed since it was confirmed', tone: 'warn-ink' }
    : readiness.ready
      ? { text: 'ready to confirm', tone: 'ok-ink' }
      : { text: `${readiness.missing.length} to do`, tone: 'warn-ink' };

  return (
    <section className="block" aria-label="Readiness">
      <header>
        <h2>Readiness</h2>
        <span className={`state ${state.tone}`}>{state.text}</span>
      </header>
      <div className="body">
        {readiness.missing.some((m) => !readiness.checks.some((c) => c.message === m)) && (
          <ul className="todo">
            {readiness.missing
              .filter((m) => !readiness.checks.some((c) => c.message === m))
              .map((m) => (
                <li key={m}>{m}</li>
              ))}
          </ul>
        )}
        {readiness.assumed.length > 0 && (
          <p className="agent-ink">
            {readiness.assumed.length === 1
              ? 'One value is'
              : `${readiness.assumed.length} values are`}{' '}
            an agent's estimate: {readiness.assumed.map(fieldLabel).join(', ')}. Check{' '}
            {readiness.assumed.length === 1 ? 'it' : 'them'} before you confirm.
          </p>
        )}
        {readiness.checks.length > 0 && (
          <Checks
            checks={readiness.checks}
            titles={titles}
            onFix={onFix}
            target={{ id: record.id, version: readiness.version }}
          />
        )}
        {draft &&
          (sectioned && !readiness.ready ? (
            <p className="muted">
              {toReview > 0
                ? `Confirm ${toReview === 1 ? 'the last section' : `the ${toReview} sections`} below. Confirming the last one makes ${record.name} active.`
                : 'Fix what blocks it first.'}
            </p>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={!readiness.ready || confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                Confirm {record.name}
              </button>
              <span className="muted">
                {readiness.ready
                  ? 'Everything is confirmed. Confirm it to make it active for the lab.'
                  : 'Fix what blocks it first.'}
              </span>
            </div>
          ))}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        <details className="tech">
          <summary>technical details</summary>
          <pre className="json">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

const rank = (c: CheckResult) => (c.passed ? 2 : c.severity === 'blocker' ? 0 : 1);

/** Failing checks first, each with a link to the section that fixes it; passing ones folded away. */
function Checks({
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
  return (
    <>
      {failing.length > 0 && table(failing)}
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
        {check.label}
        {!check.passed && check.message && <span className={tone}> · {check.message}</span>}
        {!check.passed && (check.fix || section) && (
          <div className="muted">
            {check.fix}
            {check.fix && section && ' · '}
            {section && (
              <button type="button" className="link-btn" onClick={() => onFix(section)}>
                Fix in {titles[section]?.toLowerCase()}
              </button>
            )}
          </div>
        )}
        {!check.passed && check.quickFix && <QuickFix fix={check.quickFix} target={target} />}
      </td>
      <td className="muted source">{check.source}</td>
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
  renderValue: (value: unknown) => ReactNode;
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
            {!confirmed && (
              <button
                type="button"
                className={activates ? 'btn primary' : 'btn'}
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                Confirm {section.title.toLowerCase()}
                {activates && ' and activate'}
              </button>
            )}
            <button type="button" className="btn" onClick={() => onEdit(true)}>
              Edit {section.title.toLowerCase()}
            </button>
            {!confirmed && (
              <span className="muted">
                {changed
                  ? 'Highlighted values changed since this was last confirmed.'
                  : 'Check these values, correct any that are wrong, then confirm.'}
                {activates &&
                  ` This is the last section, so ${record.name} becomes active for the lab.`}
              </span>
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
}: {
  section: ReadinessSection;
  me: Me | undefined;
  renderValue: (value: unknown) => ReactNode;
  notApplicable: string[];
}) {
  return (
    <div className="table-wrap">
      <table className="review-fields">
        <tbody>
          {section.fields
            .filter((f) => !(notApplicable.includes(f.field) && f.value === undefined))
            .map((f) => (
              <tr key={f.field} className={f.state === 'changed' ? 'changed' : undefined}>
                <td className="name">{fieldLabel(f.field)}</td>
                <td>
                  {f.state === 'changed' && (
                    <>
                      <span className="was">{renderValue(f.confirmedValue)}</span>{' '}
                    </>
                  )}
                  <span className={f.state === 'changed' ? 'now' : undefined}>
                    {renderValue(f.value)}
                  </span>
                </td>
                <td className="source">
                  {f.assumed ? (
                    <span className="agent-ink">assumed by {who(f.evidence?.by, me)}</span>
                  ) : (
                    <Evidence evidence={f.evidence} me={me} />
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

const sourceWords: Record<FieldEvidence['source'], string> = {
  // Only shown once a person has confirmed the value; before that it reads "assumed by …".
  assumed: 'estimated',
  stated: 'told',
  person: 'entered',
  datasheet: 'from a datasheet',
  imported: 'imported',
  measured: 'measured',
  calculated: 'calculated',
};

function Evidence({ evidence, me }: { evidence: FieldEvidence | undefined; me: Me | undefined }) {
  const assistant = useAssistant();
  if (!evidence) return <span className="muted">—</span>;
  const by = evidence.by;
  const words =
    evidence.source === 'person'
      ? `entered by ${who(by, me)}`
      : evidence.source === 'stated' && by.type === 'agent'
        ? `${me && by.onBehalfOf === me.user.id ? 'you' : 'a lab member'} told ${by.agentName}`
        : `${sourceWords[evidence.source]}${isAgent(by) ? ` by ${who(by, me)}` : ''}`;
  const conversation =
    evidence.source === 'stated' && by.type === 'agent' && by.sessionRef?.startsWith('cnv_')
      ? by.sessionRef
      : undefined;
  return (
    <span className="muted">
      {words}
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

/** "partOf" → "part of", "dead_volume" → "dead volume". */
export function fieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

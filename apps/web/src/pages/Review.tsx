import {
  type Actor,
  type CheckResult,
  type FieldEvidence,
  type Me,
  type Readiness,
  type ReadinessSection,
  type RecordEnvelope,
  recordsActivate,
  recordsConfirmSection,
} from '@ailab/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { formatWhen, isAgent } from '../lib/format.ts';
import { useMe } from '../session.ts';

/**
 * Draft and confirm (plan 004c): the record as a person reviews it. One block per section with what
 * changed since it was confirmed and where each value came from, then what still stands in the way.
 */
export function ReviewBlocks({
  record,
  readiness,
  renderValue,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  renderValue: (value: unknown) => ReactNode;
}) {
  return (
    <>
      <ReadinessBlock record={record} readiness={readiness} />
      {readiness.sections.map((section) => (
        <SectionBlock
          key={section.id}
          record={record}
          section={section}
          renderValue={renderValue}
        />
      ))}
    </>
  );
}

function useInvalidate(id: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['record', id] });
}

function ReadinessBlock({ record, readiness }: { record: RecordEnvelope; readiness: Readiness }) {
  const invalidate = useInvalidate(record.id);
  const confirm = useMutation({
    mutationFn: () => api.run(recordsActivate, { id: record.id, expectedVersion: record.version }),
    onSuccess: invalidate,
  });
  const draft = record.status === 'draft';
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review').length;
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
        {readiness.missing.length > 0 && (
          <ul className="todo">
            {readiness.missing.map((m) => (
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
        {readiness.checks.length > 0 && <Checks checks={readiness.checks} />}
        {draft && (
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
                ? 'Everything is confirmed. Confirming makes it available to the rest of the lab.'
                : toReview > 0
                  ? `Confirm ${toReview === 1 ? 'the remaining section' : `the ${toReview} remaining sections`} first.`
                  : 'Fix what blocks it first.'}
            </span>
          </div>
        )}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        <details className="tech">
          <summary>technical details</summary>
          <pre className="json">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

function Checks({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="table-wrap">
      <table className="checks">
        <tbody>
          {checks.map((check) => {
            const mark = check.passed ? '✓' : check.severity === 'blocker' ? '✗' : '!';
            const tone = check.passed
              ? 'ok-ink'
              : check.severity === 'blocker'
                ? 'crit-ink'
                : 'warn-ink';
            return (
              <tr key={check.id}>
                <td
                  className={`mark ${tone}`}
                  aria-label={
                    check.passed ? 'passes' : check.severity === 'blocker' ? 'blocks' : 'warning'
                  }
                >
                  {mark}
                </td>
                <td>
                  {check.label}
                  {!check.passed && check.message && (
                    <span className={tone}> · {check.message}</span>
                  )}
                  {!check.passed && check.fix && <div className="muted">{check.fix}</div>}
                </td>
                <td className="muted source">{check.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionBlock({
  record,
  section,
  renderValue,
}: {
  record: RecordEnvelope;
  section: ReadinessSection;
  renderValue: (value: unknown) => ReactNode;
}) {
  const me = useMe();
  const invalidate = useInvalidate(record.id);
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsConfirmSection, {
        id: record.id,
        expectedVersion: record.version,
        section: section.id,
      }),
    onSuccess: invalidate,
  });
  const confirmed = section.state === 'confirmed';
  const changed = section.fields.some((f) => f.state === 'changed');

  return (
    <section className="block" aria-label={section.title}>
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
        <div className="table-wrap">
          <table className="review-fields">
            <tbody>
              {section.fields.map((f) => (
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
        {!confirmed && record.status !== 'archived' && (
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              Confirm {section.title.toLowerCase()}
            </button>
            <span className="muted">
              {changed
                ? 'Highlighted values changed since this was last confirmed.'
                : 'Check these values, correct any that are wrong, then confirm.'}
            </span>
          </div>
        )}
        {confirm.error && <p className="error-text">{confirm.error.message}</p>}
      </div>
    </section>
  );
}

const sourceWords: Record<FieldEvidence['source'], string> = {
  assumed: 'assumed',
  person: 'entered',
  datasheet: 'from a datasheet',
  imported: 'imported',
  measured: 'measured',
  calculated: 'calculated',
};

function Evidence({ evidence, me }: { evidence: FieldEvidence | undefined; me: Me | undefined }) {
  if (!evidence) return <span className="muted">—</span>;
  const words =
    evidence.source === 'person'
      ? `entered by ${who(evidence.by, me)}`
      : `${sourceWords[evidence.source]}${isAgent(evidence.by) ? ` by ${who(evidence.by, me)}` : ''}`;
  return (
    <span className="muted">
      {words}
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

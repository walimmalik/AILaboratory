import {
  type FieldEvidence,
  type Me,
  type Readiness,
  type ReadinessSection,
  type RecordEnvelope,
  recordsConfirmSection,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useAssistant } from '../assistant.tsx';
import { formatShortDay, isSeed, kindFieldWords } from '../lib/format.ts';
import { kindsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import type { JsonSchema } from './FieldEditor.tsx';
import { ItemChanges, who } from './RecordReview.tsx';
import { SectionEditor } from './SectionEditor.tsx';
import { LinkedName } from './Value.tsx';

type Field = ReadinessSection['fields'][number];

/**
 * Every value of a record, part by part (plan 004f N4, N7): one block, each part with what it holds
 * and where its values came from, said once for the part. A value nobody gave a source for carries
 * a small mark, and the part's line says who entered it. Confirmed content is open; empty values
 * are named in one line.
 */
export function AllFields({
  record,
  readiness,
  renderValue,
  editing,
  onEdit,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  renderValue: (value: unknown, field?: string) => ReactNode;
  /** The part open in an editor. */
  editing: string | undefined;
  onEdit: (part: string | undefined) => void;
}) {
  const kinds = useQuery(kindsQuery).data;
  const sections =
    readiness.sections.length > 0
      ? readiness.sections
      : [wholeRecord(record, readiness, kinds?.find((k) => k.kind === record.kind)?.attributes)];
  return (
    <section className="block all-fields" aria-label="All fields">
      <div className="body">
        {sections.map((section) => (
          <Part
            key={section.id}
            record={record}
            readiness={readiness}
            section={section}
            sectioned={readiness.sections.length > 0}
            renderValue={renderValue}
            editing={editing === section.id}
            onEdit={(on) => onEdit(on ? section.id : undefined)}
          />
        ))}
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

/**
 * A kind without parts reads as one: every attribute its schema names, with the record's evidence.
 * It is confirmed as a whole, so its values are confirmed once the record is active.
 */
function wholeRecord(
  record: RecordEnvelope,
  readiness: Readiness,
  schema: unknown,
): ReadinessSection {
  const names = Object.keys((schema as JsonSchema | undefined)?.properties ?? record.attributes);
  const confirmed = record.status !== 'draft';
  return {
    id: 'fields',
    title: 'Fields',
    state: confirmed ? 'confirmed' : 'needs_review',
    fields: names.map((field) => ({
      field,
      value: record.attributes[field],
      state: confirmed ? 'confirmed' : 'unconfirmed',
      assumed: !confirmed && readiness.assumed.includes(field),
      ...(record.evidence[field] ? { evidence: record.evidence[field] } : {}),
    })),
  };
}

function Part({
  record,
  readiness,
  section,
  sectioned,
  renderValue,
  editing,
  onEdit,
}: {
  record: RecordEnvelope;
  readiness: Readiness;
  section: ReadinessSection;
  /** Whether the kind has parts; a kind without them has one, confirmed with the record. */
  sectioned: boolean;
  renderValue: (value: unknown, field?: string) => ReactNode;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () =>
      api.run(recordsConfirmSection, {
        id: record.id,
        expectedVersion: readiness.version,
        section: section.id,
      }),
    onSuccess: () =>
      Promise.all(
        [['record', record.id], ['review']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const applies = section.fields.filter(
    (f) => !(readiness.notApplicable.includes(f.field) && isEmpty(f.value)),
  );
  const filled = applies.filter((f) => !isEmpty(f.value));
  const empty = applies.filter((f) => isEmpty(f.value));
  const confirmed = section.state === 'confirmed';
  const changed = section.fields.some((f) => f.state === 'changed');
  const archived = record.status === 'archived';
  const ownedQuestions =
    record.kind === 'sop' && section.fields.some((f) => f.field === 'questions');
  const title = sectioned ? section.title : 'Values';

  return (
    <section className="part" id={`section-${section.id}`} aria-label={title}>
      <div className="part-head">
        <h3 className="part-title">{title}</h3>
        {!confirmed && (
          <span className="warn-ink part-state">
            {changed ? 'changed, needs review' : 'needs review'}
          </span>
        )}
        {!editing && !archived && !ownedQuestions && (
          <button
            type="button"
            className="link-btn"
            aria-label={`Edit ${title.toLowerCase()}`}
            onClick={() => onEdit(true)}
          >
            Edit
          </button>
        )}
      </div>
      {editing && !ownedQuestions ? (
        <SectionEditor
          record={record}
          fields={section.fields.map((f) => f.field)}
          notApplicable={readiness.notApplicable}
          onDone={() => onEdit(false)}
        />
      ) : (
        <>
          <Sources
            kind={record.kind}
            section={section}
            fields={filled}
            sectioned={sectioned}
            me={me}
          />
          {filled.length > 0 && (
            <dl className="values">
              {filled.map((f) => (
                <Fragment key={f.field}>
                  <dt>{kindFieldWords(record.kind, f.field)}</dt>
                  <dd className={f.state === 'changed' ? 'changed' : undefined}>
                    {f.state === 'changed' && (
                      <>
                        <span className="was">{renderValue(f.confirmedValue, f.field)}</span>{' '}
                      </>
                    )}
                    <span className={f.state === 'changed' ? 'now' : undefined}>
                      {renderValue(f.value, f.field)}
                    </span>
                    {unsourced(f) && (
                      <span
                        className="unsourced"
                        title={`${f.assumed ? 'unverified · ' : ''}entered by ${who(f.evidence?.by, me)}, no source given`}
                      >
                        ◦
                      </span>
                    )}
                    {f.items && f.state !== 'confirmed' && <ItemChanges field={f} />}
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
          {filled.length === 0 ? (
            <p className="empty">None entered.</p>
          ) : (
            empty.length > 0 && (
              <p className="empty">
                Not filled: {empty.map((f) => kindFieldWords(record.kind, f.field)).join(', ')}
              </p>
            )
          )}
          {!confirmed && sectioned && !archived && (
            <div className="actions">
              <button
                type="button"
                className="link-btn"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                confirm only {section.title.toLowerCase()}
              </button>
              {changed && (
                <span className="muted">Highlighted values changed since they were confirmed.</span>
              )}
            </div>
          )}
          {confirm.error && <p className="error-text">{confirm.error.message}</p>}
        </>
      )}
    </section>
  );
}

/** An agent's value with no source, confirmed or not: marked where it shows (N7). */
const unsourced = (f: Field) =>
  !fromSeed(f) &&
  (f.assumed || (f.evidence?.source === 'assumed' && f.evidence.by.type === 'agent'));

/**
 * The seed lab's files are the source of what the seed loader entered and a person confirmed (ADR
 * 0044); a seed value still waiting on a person stays marked.
 */
const fromSeed = (f: Field) => !f.assumed && !!f.evidence && isSeed(f.evidence.by);

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * Where a part's values came from, said once (N7): "Confirmed by you on 1 Oct. Manufacturer from
 * the lab's instrument list; 5 values entered by an agent with no source given (marked ◦)."
 * Values with the same source are named together, or counted past three.
 */
function Sources({
  kind,
  section,
  fields,
  sectioned,
  me,
}: {
  kind: string;
  section: ReadinessSection;
  fields: Field[];
  sectioned: boolean;
  me: Me | undefined;
}) {
  const assistant = useAssistant();
  const groups = new Map<string, { evidence: FieldEvidence | undefined; fields: Field[] }>();
  for (const f of fields) {
    const e = f.evidence;
    const key = unsourced(f)
      ? `none ${f.assumed}`
      : e
        ? [e.source, by(e, me), e.from?.id, e.from?.version, e.reference, e.note].join('|')
        : 'unknown';
    const group = groups.get(key) ?? { evidence: e, fields: [] };
    group.fields.push(f);
    groups.set(key, group);
  }
  const confirmedLine =
    sectioned && section.state === 'confirmed' && section.review
      ? `Confirmed by ${who(section.review.confirmedBy, me)} on ${formatShortDay(section.review.confirmedAt)}.`
      : undefined;
  const pieces = [...groups.values()]
    .filter((g) => g.evidence || g.fields.some(unsourced))
    .map((g) => {
      const names =
        g.fields.length <= 3 ? g.fields.map((f) => kindFieldWords(kind, f.field)) : undefined;
      const subject = names ? capital(list(names)) : `${g.fields.length} values`;
      const e = g.evidence;
      if (g.fields.some(unsourced)) {
        const unverified = g.fields.some((f) => f.assumed);
        return (
          <span key="none" className="agent-ink">
            {subject} entered by {who(e?.by, me)} with no source given
            {unverified && ', unverified'} (marked ◦)
          </span>
        );
      }
      if (!e) return null;
      if (g.fields.every(fromSeed) && e.source === 'assumed')
        return <span key="seed">{subject} imported from the seed lab</span>;
      const conversation =
        e.source === 'stated' && e.by.type === 'agent' && e.by.sessionRef?.startsWith('cnv_')
          ? e.by.sessionRef
          : undefined;
      // A value copied from another record names that record, which anyone can open and check.
      const copied = e.source === 'record' || e.source === 'template';
      return (
        <span key={[e.source, e.from?.id, e.reference, e.note, subject].join('|')}>
          {subject} {sourcePhrase(e, me)}
          {e.from && (
            <>
              {' '}
              <LinkedName id={e.from.id} /> v{e.from.version}
              {e.source === 'template' && ' (protocol default)'}
            </>
          )}
          {e.note && ` (${e.note})`}
          {e.reference &&
            (/^https?:\/\//.test(e.reference) ? (
              <>
                {' '}
                <a href={e.reference} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            ) : (
              ` (${e.reference})`
            ))}
          {conversation && (
            <>
              {' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => assistant.show(conversation)}
              >
                conversation
              </button>
            </>
          )}
          {/* A source an agent named is its claim until a person checks it. */}
          {e.by.type === 'agent' && e.source !== 'stated' && e.source !== 'person' && !copied && (
            <span className="agent-ink">, according to {e.by.agentName}</span>
          )}
        </span>
      );
    })
    .filter((p) => p !== null);
  if (!confirmedLine && pieces.length === 0) return null;
  return (
    <p className="sources muted">
      {confirmedLine}
      {confirmedLine && pieces.length > 0 && ' '}
      {pieces.map((p, i) => (
        <Fragment key={(p as { key?: string }).key ?? i}>
          {i > 0 && '; '}
          {p}
        </Fragment>
      ))}
      {pieces.length > 0 && '.'}
    </p>
  );
}

/** Who gave a value, as part of the grouping key: the same source from two people stays two. */
const by = (e: FieldEvidence, me: Me | undefined) => who(e.by, me);

/** The source in lab words (plan 004f, state words): only beside values. */
function sourcePhrase(e: FieldEvidence, me: Me | undefined): string {
  switch (e.source) {
    case 'person':
      return `entered by ${who(e.by, me)}`;
    case 'stated':
      return e.by.type === 'agent'
        ? `stated by ${me && e.by.onBehalfOf === me.user.id ? 'you' : 'a lab member'} to ${e.by.agentName}`
        : 'stated';
    case 'datasheet':
      return 'from the datasheet';
    case 'imported':
      return 'imported';
    case 'measured':
      return 'measured';
    case 'calculated':
      return 'calculated';
    case 'record':
    case 'template':
      return 'copied from';
    case 'memory':
      return 'from lab memory';
    default:
      return 'entered with no source given';
  }
}

const capital = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;

/** "a, b and c". */
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

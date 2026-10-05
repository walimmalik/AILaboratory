import type {
  InventoryEvent,
  RecordEnvelope,
  RecordVersion,
  ScientificQuestion,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAssistant } from '../assistant.tsx';
import { actorLabel, fieldLabel, formatWhen, isAgent } from '../lib/format.ts';
import {
  compareHistoryQuestions,
  historyChangeLabel,
  historyChangePreview,
  historyEntries,
  historyEntrySearch,
  historyExcerpt,
  historyWindow,
  inventorySummary,
  versionReviews,
  versionSummary,
} from '../lib/history.ts';
import { kindsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { sourcePhrase } from './AllFields.tsx';
import { ItemDiff, itemChanges } from './ItemDiff.tsx';
import { RestoreVersion } from './RecordActions.tsx';
import { Cites } from './Sops.tsx';
import { LinkedName, renderValue } from './Value.tsx';

const PAGE = 30;

/** The same chronological History for every record kind, using snapshots and physical events. */
export function RecordHistory({
  record,
  versions,
  ledger,
  selected,
}: {
  record: RecordEnvelope;
  versions: RecordVersion[];
  ledger: InventoryEvent[];
  selected?: string | undefined;
}) {
  const me = useMe();
  const assistant = useAssistant();
  const navigate = useNavigate({ from: '/records/$id' });
  const kinds = useQuery(kindsQuery).data;
  const items = kinds?.find((kind) => kind.kind === record.kind)?.items ?? {};
  const [count, setCount] = useState(PAGE);
  const entries = historyEntries(versions, ledger);
  const { shown, earlier } = historyWindow(entries, count, selected);
  const newest = entries.at(-1);
  const selectedAvailable = shown.some((entry) => entry.key === selected);
  useEffect(() => {
    if (selected && selectedAvailable)
      document.getElementById(`history-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, selectedAvailable]);
  const select = (key?: string) =>
    navigate({ search: key ? historyEntrySearch(key) : { tab: 'history' }, resetScroll: false });
  return (
    <section className="block record-history" aria-label="History">
      <header>
        <h2>History</h2>
        {newest && (
          <Link
            to="/records/$id"
            params={{ id: record.id }}
            search={historyEntrySearch(newest.key)}
            resetScroll={false}
            onClick={() =>
              document.getElementById(`history-${newest.key}`)?.scrollIntoView({ block: 'nearest' })
            }
          >
            Newest activity ↓
          </Link>
        )}
      </header>
      <div className="body">
        {entries.length === 0 ? (
          <p className="empty">No history recorded yet.</p>
        ) : (
          <>
            <p className="muted history-orientation">
              Oldest to newest · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </p>
            {selected && !entries.some((entry) => entry.key === selected) && (
              <p className="muted">This history entry is not available.</p>
            )}
            {earlier > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setCount(entries.length - earlier + PAGE)}
              >
                Show earlier activity ({earlier} earlier)
              </button>
            )}
            <ol className="history-timeline" aria-label="Record history entries">
              {shown.map((entry) => {
                const version = entry.type === 'version' ? entry.version : undefined;
                const event = entry.type === 'inventory' ? entry.event : undefined;
                const actor = version?.actor ?? event?.actor;
                const previous = version
                  ? versions.find((candidate) => candidate.version === version.version - 1)
                      ?.snapshot
                  : undefined;
                const comparable = version && (version.operation === 'create' || previous);
                const changes = comparable ? itemChanges(previous, version.snapshot, items) : [];
                const labels = Object.fromEntries(
                  changes.map((change) => [
                    change.path,
                    historyChangeLabel(change.path, version?.snapshot ?? record, items, previous),
                  ]),
                );
                const questionComparison =
                  comparable && record.kind === 'sop'
                    ? compareHistoryQuestions(previous, version.snapshot)
                    : { available: true, changes: [] };
                const questions = questionComparison.changes;
                const response = questions
                  .flatMap(
                    (question) =>
                      question.after?.responses.slice(question.before?.responses.length ?? 0) ?? [],
                  )
                  .at(-1);
                const preview = [
                  response
                    ? `Response: “${historyExcerpt(response.text)}”`
                    : historyChangePreview(changes, labels),
                  !questionComparison.available ? 'Scientific question comparison unavailable' : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                const reason = version?.reason ?? event?.reason;
                const conversation =
                  actor?.type === 'agent' && actor.sessionRef?.startsWith('cnv_')
                    ? actor.sessionRef
                    : undefined;
                const open = selected === entry.key;
                return (
                  <li
                    key={entry.key}
                    id={`history-${entry.key}`}
                    className={open ? 'history-entry selected' : 'history-entry'}
                  >
                    <span
                      className={`history-marker${actor && isAgent(actor) ? ' agent-ink' : ''}`}
                      aria-hidden="true"
                    >
                      {actor && isAgent(actor) ? '◇' : '●'}
                    </span>
                    <div className="history-content">
                      <div className="history-top">
                        <p className="history-heading">
                          <strong className={actor && isAgent(actor) ? 'agent-ink' : undefined}>
                            {actor && actorLabel(actor, me)}
                          </strong>{' '}
                          {version
                            ? versionSummary(version, previous, [])
                            : event
                              ? inventorySummary(event, record.id)
                              : ''}
                        </p>
                        <div className="history-meta">
                          <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                            {formatWhen(entry.at)}
                          </time>
                          <Link
                            to="/records/$id"
                            params={{ id: record.id }}
                            search={historyEntrySearch(entry.key)}
                            resetScroll={false}
                            aria-label={
                              version
                                ? `Open version ${version.version} in history`
                                : 'Link to this inventory event'
                            }
                          >
                            {version ? `v${version.version}` : 'Link to event'}
                          </Link>
                          {version?.version === record.version && <span>current</span>}
                          {conversation && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => assistant.show(conversation)}
                            >
                              Conversation
                            </button>
                          )}
                        </div>
                      </div>
                      <details
                        open={open}
                        className="history-details"
                        onToggle={(event) => {
                          if (event.currentTarget.open !== open)
                            void select(event.currentTarget.open ? entry.key : undefined);
                        }}
                      >
                        <summary>
                          <span className="history-preview">
                            {preview ||
                              (version?.operation === 'create'
                                ? historyExcerpt(version.snapshot.summary ?? version.snapshot.label)
                                : event
                                  ? 'Recorded well changes'
                                  : 'Section confirmations and version details')}
                          </span>{' '}
                          <span className="history-disclosure">
                            {open ? 'Hide change' : 'View change'}
                          </span>
                        </summary>
                        {open && (
                          <div className="history-expanded" id={`history-details-${entry.key}`}>
                            {version && (
                              <>
                                {comparable ? (
                                  <ItemDiff
                                    kind={record.kind}
                                    before={previous}
                                    after={version.snapshot}
                                    changes={
                                      record.kind === 'sop'
                                        ? changes.filter(
                                            (change) =>
                                              change.path !== '/questions' &&
                                              !change.path.startsWith('/questions/'),
                                          )
                                        : changes
                                    }
                                    isNew={version.operation === 'create'}
                                    caption="What changed"
                                    adjacent
                                    labels={labels}
                                  />
                                ) : (
                                  <p className="muted">
                                    The preceding version is not available to compare.
                                  </p>
                                )}
                                {questions.map((question) => (
                                  <QuestionChange
                                    key={question.id}
                                    before={question.before}
                                    after={question.after}
                                  />
                                ))}
                                {!questionComparison.available && (
                                  <p className="muted">
                                    Scientific question comparison is unavailable for this
                                    historical version. The stored questions remain available under
                                    Version and technical details.
                                  </p>
                                )}
                                {comparable && changes.length === 0 && (
                                  <p className="muted">No field values changed.</p>
                                )}
                              </>
                            )}
                            {event && <InventoryChange event={event} container={record.id} />}
                            {reason && (
                              <p className="history-why">
                                <b>Why:</b> {reason}
                              </p>
                            )}
                            {version && (
                              <VersionSources version={version} previous={previous} items={items} />
                            )}
                            {version && (
                              <RestoreVersion record={record} version={version.version} />
                            )}
                            <details className="tech">
                              <summary>Version and technical details</summary>
                              {version && (
                                <>
                                  <p>
                                    Snapshot at v{version.version} · {version.snapshot.status} at
                                    this version
                                  </p>
                                  {versionReviews(previous, version.snapshot).map(
                                    ([id, review]) => (
                                      <p key={id}>
                                        {fieldLabel(id)} confirmed by{' '}
                                        {actorLabel(review.confirmedBy, me)} at v{review.version}.
                                      </p>
                                    ),
                                  )}
                                </>
                              )}
                              <p>{version?.via ?? version?.operation ?? event?.operationId}</p>
                              <pre className="json">
                                {JSON.stringify(version ?? event, null, 2)}
                              </pre>
                            </details>
                          </div>
                        )}
                      </details>
                      {!open && reason && (
                        <p className="history-context">
                          <span className="muted">Why:</span> {historyExcerpt(reason, 200)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function VersionSources({
  version,
  previous,
  items,
}: {
  version: RecordVersion;
  previous: RecordEnvelope | undefined;
  items: Readonly<Record<string, string>>;
}) {
  const me = useMe();
  const sources = Object.entries(version.snapshot.evidence).filter(
    ([path, evidence]) => JSON.stringify(previous?.evidence[path]) !== JSON.stringify(evidence),
  );
  if (!sources.length) return null;
  return (
    <details className="history-sources">
      <summary>Sources ({sources.length})</summary>
      <ul className="plain">
        {sources.map(([path, evidence]) => (
          <li key={path}>
            <b>
              {historyChangeLabel(
                path.startsWith('/') ? path : `/${path}`,
                version.snapshot,
                items,
                previous,
              )}
            </b>
            : {sourcePhrase(evidence, me)}
            {evidence.from && (
              <>
                {' '}
                <LinkedName id={evidence.from.id} /> v{evidence.from.version}
              </>
            )}
            {evidence.note && <> · {evidence.note}</>}
            {evidence.reference &&
              (/^https?:\/\//.test(evidence.reference) ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={evidence.reference} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </>
              ) : (
                <> · {evidence.reference}</>
              ))}
            {evidence.by.type === 'agent' && <> · according to {evidence.by.agentName}</>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function InventoryChange({ event, container }: { event: InventoryEvent; container: string }) {
  return (
    <>
      {event.runLog && (
        <p>
          Instrument report: <LinkedName id={event.runLog} />
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Well changes recorded by this event</caption>
          <thead>
            <tr>
              <th>Well</th>
              <th>Change</th>
              <th>Amount</th>
              <th>From / to</th>
              <th>Contents after</th>
            </tr>
          </thead>
          <tbody>
            {event.lines
              .filter((line) => line.container === container)
              .map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: immutable ledger lines can repeat a well and direction
                <tr key={`${line.well}-${line.change}-${i}`}>
                  <th scope="row">{line.well}</th>
                  <td>
                    {line.change === 'in'
                      ? 'added'
                      : line.change === 'out'
                        ? 'removed'
                        : 'set contents'}
                  </td>
                  <td>{renderValue(line.volume)}</td>
                  <td>
                    {(line.from ?? line.to) && (
                      <>
                        <LinkedName id={(line.from ?? line.to)?.container ?? ''} /> ·{' '}
                        {(line.from ?? line.to)?.well}
                      </>
                    )}
                  </td>
                  <td>{renderValue(line.after)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** An answer appends an observation; it never silently resolves a scientific question. */
function QuestionChange({
  before,
  after,
}: {
  before: ScientificQuestion | undefined;
  after: ScientificQuestion | undefined;
}) {
  const me = useMe();
  if (!before || !after)
    return (
      <div className="history-question">
        <b>{after ? 'Added scientific question' : 'Removed scientific question'}</b>
        <QuestionSnapshot question={after ?? before} />
      </div>
    );
  const added = after.responses.filter(
    (response) => !before.responses.some((old) => JSON.stringify(old) === JSON.stringify(response)),
  );
  return (
    <div className="history-question">
      <p>
        <b>Question:</b>{' '}
        {before.question === after.question ? (
          after.question
        ) : (
          <>
            <span className="muted">{before.question}</span> → {after.question}
          </>
        )}
      </p>
      {added.map((response) => (
        <div key={`${response.version}-${response.at}-${response.text}`}>
          <p>
            <b>Response:</b> {response.text}
          </p>
          <small className="muted">
            {actorLabel(response.by, me)} · {formatWhen(response.at)} · v{response.version} ·
            question remains {after.disposition.status.replaceAll('_', ' ')}
          </small>
        </div>
      ))}
      <Cites cites={after.passages} />
    </div>
  );
}

/** A response is an observation; show its words and author, not a raw actor object. */
export function QuestionSnapshot({ question }: { question: ScientificQuestion | undefined }) {
  const me = useMe();
  if (!question) return <span className="muted">None</span>;
  return (
    <>
      <p>{question.question}</p>
      {question.suggestion && (
        <p className="agent-ink">Suggested answer (assumed): {question.suggestion}</p>
      )}
      <p className="muted">
        {question.stage.stage === 'method'
          ? 'Before using this method'
          : question.stage.stage === 'experiment'
            ? 'Before the experiment'
            : 'Before the run'}{' '}
        · {question.disposition.status.replaceAll('_', ' ')}
      </p>
      <p className="muted">Why at this stage: {question.stage.reason}</p>
      <Cites cites={question.passages} />
      {question.responses.length === 0 ? (
        <p className="muted">No responses recorded.</p>
      ) : (
        <ul className="plain">
          {question.responses.map((response) => (
            <li key={`${response.version}-${response.at}-${response.text}`}>
              <p>{response.text}</p>
              <small className="muted">
                {actorLabel(response.by, me)} · {formatWhen(response.at)} · v{response.version}
              </small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

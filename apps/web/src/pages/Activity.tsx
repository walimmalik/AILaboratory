import type { ActivityEntry } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, useState } from 'react';
import { useAssistant } from '../assistant.tsx';
import {
  actorLabel,
  formatWhen,
  isAgent,
  operationVerb,
  outcomeLabel,
  outcomeTone,
} from '../lib/format.ts';
import { useLive } from '../live.tsx';
import { activityQuery } from '../queries.ts';
import { useMe } from '../session.ts';

/** The lab's ledger: every change people and agents made, live. */
export function ActivityPage() {
  const { data: entries = [], isPending, error } = useQuery(activityQuery);
  const live = useLive();
  const [open, setOpen] = useState<string>();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>activity</b>
          </div>
          <h1>Activity</h1>
          <p className="lede">
            Every change in the lab, newest first, as it happens. Agent work is in{' '}
            <span className="agent-ink">violet</span>. Select a line for details.
          </p>
        </div>
      </div>

      <section className="block">
        <header>
          <h2>Ledger</h2>
          <span className={`state ${live.connected ? 'ok-ink' : 'warn-ink'}`}>
            {live.connected ? '● live' : '○ reconnecting'}
          </span>
        </header>
        <div className="body">
          {error && <p className="error-text">{error.message}</p>}
          {isPending ? (
            <p className="empty">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="empty">
              Nothing has happened yet. Changes by people and agents appear here live.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <Fragment key={entry.id}>
                      <Row
                        entry={entry}
                        fresh={live.fresh.has(entry.id)}
                        open={open === entry.id}
                        onToggle={() => setOpen(open === entry.id ? undefined : entry.id)}
                      />
                      {open === entry.id && <Details entry={entry} />}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Row({
  entry,
  fresh,
  open,
  onToggle,
}: {
  entry: ActivityEntry;
  fresh: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const me = useMe();
  return (
    <tr
      className={`clickable ${fresh ? 'fresh' : ''}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      aria-expanded={open}
    >
      <td className="when">{formatWhen(entry.at)}</td>
      <td className={isAgent(entry.actor) ? 'agent-ink' : undefined}>
        {actorLabel(entry.actor, me)}
      </td>
      <td>
        {operationVerb(entry.operationId)}{' '}
        {entry.recordIds.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && ', '}
            <Link
              to="/records/$id"
              params={{ id }}
              className="mono"
              onClick={(e) => e.stopPropagation()}
            >
              {entry.recordNames[id] ?? 'record'}
            </Link>
          </Fragment>
        ))}
        {entry.recordIds.length === 0 && inputLabel(entry) && <span>“{inputLabel(entry)}”</span>}
      </td>
      <td className={`mono ${outcomeTone(entry.outcome)}`}>{outcomeLabel(entry.outcome)}</td>
    </tr>
  );
}

function Details({ entry }: { entry: ActivityEntry }) {
  const assistant = useAssistant();
  const conversationId = conversationOf(entry);
  return (
    <tr className="details">
      <td colSpan={4}>
        <dl className="kv">
          {entry.error && (
            <>
              <dt>problem</dt>
              <dd className="crit-ink">{entry.error.message}</dd>
            </>
          )}
          {typeof (entry.input as { reason?: unknown })?.reason === 'string' && (
            <>
              <dt>reason</dt>
              <dd>{(entry.input as { reason: string }).reason}</dd>
            </>
          )}
          {entry.proposalId && (
            <>
              <dt>proposal</dt>
              <dd>
                <Link to="/proposals">see proposals</Link>
              </dd>
            </>
          )}
          {conversationId && (
            <>
              <dt>conversation</dt>
              <dd>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => assistant.show(conversationId)}
                >
                  open in the assistant
                </button>
              </dd>
            </>
          )}
          <dt>took</dt>
          <dd className="num">{entry.durationMs} ms</dd>
        </dl>
        <details className="tech">
          <summary>technical details</summary>
          <pre className="json">
            {JSON.stringify(
              {
                operation: entry.operationId,
                actor: entry.actor,
                input: entry.input,
                error: entry.error,
                id: entry.id,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </td>
    </tr>
  );
}

function inputLabel(entry: ActivityEntry): string | undefined {
  const { label, message } = (entry.input ?? {}) as { label?: unknown; message?: unknown };
  if (typeof label === 'string' && label) return label;
  // What someone asked the assistant.
  if (typeof message === 'string' && message) {
    return message.length > 80 ? `${message.slice(0, 79)}…` : message;
  }
  return undefined;
}

/** The assistant conversation behind an entry: the agent's session, or the conversation asked in. */
function conversationOf(entry: ActivityEntry): string | undefined {
  const ref = entry.actor.type === 'agent' ? entry.actor.sessionRef : undefined;
  if (ref?.startsWith('cnv_')) return ref;
  const id = (entry.input as { conversationId?: unknown } | undefined)?.conversationId;
  return typeof id === 'string' ? id : undefined;
}

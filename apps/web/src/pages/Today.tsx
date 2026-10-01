import type { ActivityEntry } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { actorLabel, formatWhen, isAgent, operationVerb } from '../lib/format.ts';
import { filteredActivityQuery, reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';

const SHOWN = 12;

/** Midnight today, where the page is read. */
function startOfToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/**
 * The home page (plan 004e R8, ADR 0053): what waits for you, then what you and agents working for
 * you did today, one line per record. The full ledger is on Activity.
 */
export function TodayPage() {
  const me = useMe();
  const review = useQuery(reviewQuery).data;
  const since = startOfToday();
  const today = useQuery(filteredActivityQuery({ mine: true, since }));
  const needsYou = review?.counts.needsYou ?? 0;
  const drafts = (review?.items ?? []).filter((i) => i.type === 'draft' && i.for === me?.user.id);
  const mentions = review?.counts.mentions ?? 0;
  const byRecord = touchedToday(today.data ?? []);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>today</b>
          </div>
          <h1>Today</h1>
          <p className="lede">
            {me?.lab.name} ·{' '}
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
      </div>

      <section className="block" aria-label="Waiting for you">
        <header>
          <h2>Waiting for you</h2>
        </header>
        <div className="body">
          {needsYou + drafts.length + mentions === 0 ? (
            <p className="empty">Nothing waits for you.</p>
          ) : (
            <ul className="plain">
              {needsYou > 0 && (
                <li className="agent-ink">
                  <Link to="/review">
                    {needsYou}{' '}
                    {needsYou === 1 ? 'change an agent proposed' : 'changes agents proposed'}
                  </Link>{' '}
                  {needsYou === 1 ? 'waits' : 'wait'} on you
                </li>
              )}
              {drafts.length > 0 && (
                <li>
                  <Link to="/review">
                    {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
                  </Link>{' '}
                  to confirm
                </li>
              )}
              {mentions > 0 && (
                <li>
                  <Link to="/review">
                    {mentions} library {mentions === 1 ? 'mention' : 'mentions'}
                  </Link>{' '}
                  to check
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      <section className="block" aria-label="Done today">
        <header>
          <h2>Done today</h2>
          <span className="state muted">by you and agents working for you</span>
        </header>
        <div className="body">
          {today.error && <p className="error-text">{today.error.message}</p>}
          {today.data && byRecord.length === 0 && <p className="empty">Nothing yet today.</p>}
          {byRecord.length > 0 && (
            <div className="table-wrap">
              <table className="dense">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>What was done</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {byRecord.slice(0, SHOWN).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to="/records/$id" params={{ id: r.id }} className="mono">
                          {r.name}
                        </Link>
                      </td>
                      <td>{r.verbs.join(', ')}</td>
                      <td className="when">
                        {formatWhen(r.last.at)}
                        <div className={isAgent(r.last.actor) ? 'agent-ink' : 'muted'}>
                          {actorLabel(r.last.actor, me)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            {byRecord.length > SHOWN && `${byRecord.length - SHOWN} more records. `}
            <Link to="/activity">Everything in the lab</Link>
          </p>
        </div>
      </section>
    </>
  );
}

interface Touched {
  id: string;
  name: string;
  verbs: string[];
  last: ActivityEntry;
}

/** Today's successful changes, one line per record, newest first. */
function touchedToday(entries: ActivityEntry[]): Touched[] {
  const records = new Map<string, Touched>();
  for (const entry of entries) {
    if (entry.outcome === 'failed') continue;
    for (const id of entry.recordIds) {
      const seen = records.get(id);
      const verb = operationVerb(entry.operationId);
      if (seen) {
        if (!seen.verbs.includes(verb)) seen.verbs.push(verb);
      } else {
        records.set(id, { id, name: entry.recordNames[id] ?? id, verbs: [verb], last: entry });
      }
    }
  }
  return [...records.values()];
}

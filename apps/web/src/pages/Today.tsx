import { type ActivityEntry, type RecordEnvelope, recordsList } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import {
  actorLabel,
  formatWhen,
  isAgent,
  isSeed,
  operationVerb,
  verbAlone,
} from '../lib/format.ts';
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
  const drafts = (review?.items ?? []).flatMap((i) =>
    i.type === 'draft' && i.for === me?.user.id ? [i] : [],
  );
  const mentions = review?.counts.mentions ?? 0;
  const touched = touchedToday(today.data ?? []);
  // A draft made today still waits on you: it is listed there, not under "Done today" (review
  // 2026-10-01 item 3), and the seed lab's unfinished drafts are one line of their own.
  const draftIds = new Set(drafts.map((i) => i.record.id));
  const madeToday = touched.filter((r) => draftIds.has(r.id));
  const madeTodayIds = new Set(madeToday.map((r) => r.id));
  const seedDrafts = drafts.filter((i) => isSeed(i.record.updatedBy));
  const earlierDrafts = drafts.filter(
    (i) => !isSeed(i.record.updatedBy) && !madeTodayIds.has(i.record.id),
  );
  const byRecord = touched.filter((r) => !draftIds.has(r.id));
  const shown = byRecord.slice(0, SHOWN);
  // Names first, codes as tags: the records are read once for their labels. A record deleted
  // since, or named by an old entry before it existed, gets no link.
  const ids = [...shown, ...madeToday].map((r) => r.id);
  const found = useQuery({
    queryKey: ['records', 'exist', ids],
    enabled: ids.length > 0,
    queryFn: async () =>
      new Map((await api.run(recordsList, { ids })).records.map((r) => [r.id, r] as const)),
  });
  const name = (r: Touched) => <RecordName touched={r} record={found.data?.get(r.id)} />;

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
              {madeToday.length > 0 && (
                <li>
                  <Link to="/review">
                    {madeToday.length} {madeToday.length === 1 ? 'draft' : 'drafts'} made today
                  </Link>{' '}
                  to confirm:
                  <ul className="plain today-drafts">
                    {madeToday.map((r) => (
                      <li key={r.id}>
                        {name(r)} <span className="muted">· {verbAlone(r.verb)} by </span>
                        <span className={isAgent(r.last.actor) ? 'agent-ink' : 'muted'}>
                          {actorLabel(r.last.actor, me)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {earlierDrafts.length > 0 && (
                <li>
                  <Link to="/review">
                    {earlierDrafts.length} earlier {earlierDrafts.length === 1 ? 'draft' : 'drafts'}
                  </Link>{' '}
                  to confirm
                </li>
              )}
              {seedDrafts.length > 0 && (
                <li className="muted">
                  {seedDrafts.length} {seedDrafts.length === 1 ? 'draft' : 'drafts'} imported from
                  the seed lab, waiting for values the seed did not have
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
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>{name(r)}</td>
                      <td>
                        {verbAlone(r.verb)}
                        {r.count > 1 && <span className="muted"> · {r.count} changes</span>}
                      </td>
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

/** A record's name, then its code as a tag; a record that no longer exists is its code alone. */
function RecordName({ touched, record }: { touched: Touched; record: RecordEnvelope | undefined }) {
  if (!record) return <span className="mono">{touched.name}</span>;
  return (
    <>
      <Link to="/records/$id" params={{ id: record.id }}>
        {record.label}
      </Link>{' '}
      <span className="mono muted">{record.name}</span>
    </>
  );
}

interface Touched {
  id: string;
  name: string;
  /** The latest thing done to it. */
  verb: string;
  count: number;
  last: ActivityEntry;
}

/** What ran today, one line per record, newest first: proposals wait under "Waiting for you". */
function touchedToday(entries: ActivityEntry[]): Touched[] {
  const records = new Map<string, Touched>();
  for (const entry of entries) {
    if (entry.outcome !== 'succeeded' && entry.outcome !== 'approved') continue;
    for (const id of entry.recordIds) {
      const seen = records.get(id);
      if (seen) seen.count++;
      else
        records.set(id, {
          id,
          name: entry.recordNames[id] ?? id,
          verb: operationVerb(entry.operationId),
          count: 1,
          last: entry,
        });
    }
  }
  return [...records.values()];
}

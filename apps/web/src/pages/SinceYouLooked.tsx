import { type RecordEnvelope, recordsDiff, recordsMarkSeen } from '@ailab/schema';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { actorLabel, formatWhen, isAgent, operationVerb, pathLabel } from '../lib/format.ts';
import { useMe } from '../session.ts';
import { renderValue } from './Value.tsx';

const SHOWN = 8;

/**
 * What changed since you last opened this record (plan 004e R8, ADR 0053), then marks it seen. The
 * comparison is read once per visit, so it stays on screen while you read even after it is marked.
 */
export function SinceYouLooked({ record }: { record: RecordEnvelope }) {
  const me = useMe();
  const person = me?.actor.type === 'user';
  const diff = useQuery({
    queryKey: ['since-you-looked', record.id],
    queryFn: () => api.run(recordsDiff, { id: record.id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    enabled: person,
  });
  const seen = useMutation({
    mutationFn: (version: number) => api.run(recordsMarkSeen, { id: record.id, version }),
  });
  const { mutate } = seen;
  // Marks the version the comparison was read at, once: a change that arrives live while the page
  // is open stays unseen until the next visit shows it.
  const shown = diff.data?.to;
  useEffect(() => {
    if (person && shown !== undefined) mutate(shown);
  }, [person, shown, mutate]);
  const [all, setAll] = useState(false);

  const data = diff.data;
  if (data?.since !== 'seen' || data.changes.length === 0) return null;
  const changes = all ? data.changes : data.changes.slice(0, SHOWN);
  const by = [...new Map(data.versions.map((v) => [JSON.stringify(v.actor), v])).values()];
  const via = [
    ...new Set(
      data.versions.flatMap((v) => (v.via && !v.via.startsWith('records.') ? [v.via] : [])),
    ),
  ];
  return (
    <section className="block" aria-label="Changed since you last looked">
      <header>
        <h2>Changed since you last looked</h2>
        <span className="state muted">
          v{data.from} to v{data.to} · {data.changes.length}{' '}
          {data.changes.length === 1 ? 'change' : 'changes'}
        </span>
      </header>
      <div className="body">
        <p className="muted">
          By{' '}
          {by.map((v, i) => (
            <span
              key={JSON.stringify(v.actor)}
              className={isAgent(v.actor) ? 'agent-ink' : undefined}
            >
              {i > 0 && ', '}
              {actorLabel(v.actor, me)}
            </span>
          ))}
          {via.length > 0 && <> ({via.map((id) => operationVerb(id)).join(', ')})</>}, last{' '}
          {formatWhen(data.versions.at(-1)?.at ?? record.updatedAt)}
        </p>
        <div className="table-wrap">
          <table className="review-fields">
            <tbody>
              {changes.map((c) => (
                <tr key={c.path}>
                  <th scope="row">{pathLabel(c.path)}</th>
                  <td>
                    {c.change === 'added' ? (
                      <span className="muted">added</span>
                    ) : (
                      <span className="was">{renderValue(c.before)}</span>
                    )}
                  </td>
                  <td>
                    {c.change === 'removed' ? (
                      <span className="muted">removed</span>
                    ) : (
                      <span className="now">{renderValue(c.after)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.changes.length > SHOWN && (
          <button type="button" className="link-btn" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${data.changes.length}`}
          </button>
        )}
      </div>
    </section>
  );
}

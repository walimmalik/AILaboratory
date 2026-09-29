import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { actorLabel, formatWhen, isAgent } from '../lib/format.ts';
import { recordsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { StatusChip } from './StatusChip.tsx';

type StatusFilter = 'current' | 'draft' | 'active' | 'archived';
const filters: [StatusFilter, string][] = [
  ['current', 'Current'],
  ['draft', 'Drafts'],
  ['active', 'Active'],
  ['archived', 'Archived'],
];

/** Every record in the lab, whatever its kind. Registry pages for each kind come with their plans. */
export function RecordsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('current');
  const deferred = useDeferredValue(search.trim());
  const {
    data: records = [],
    isPending,
    error,
  } = useQuery(
    recordsQuery({
      ...(deferred ? { search: deferred } : {}),
      ...(status === 'current' ? {} : { status }),
    }),
  );
  const me = useMe();
  const navigate = useNavigate();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>records</b>
          </div>
          <h1>Records</h1>
          <p className="lede">Everything the lab keeps track of, most recently changed first.</p>
        </div>
      </div>

      <section className="block">
        <header>
          <h2>All records</h2>
          <span className="state muted num">{records.length} shown</span>
        </header>
        <div className="body">
          <div className="toolbar">
            <input
              className="field grow"
              type="search"
              placeholder="Find by name or label, e.g. PLT-000345"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Find records"
            />
            <fieldset className="segmented">
              <legend className="sr-only">Status</legend>
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
          {error && <p className="error-text">{error.message}</p>}
          {isPending ? (
            <p className="empty">Loading…</p>
          ) : records.length === 0 ? (
            <p className="empty">
              {deferred
                ? 'No records match.'
                : 'No records yet. Registries arrive with the labware plan (007).'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Label</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Changed</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr
                      key={r.id}
                      className="clickable"
                      tabIndex={0}
                      onClick={() => navigate({ to: '/records/$id', params: { id: r.id } })}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && navigate({ to: '/records/$id', params: { id: r.id } })
                      }
                    >
                      <td className="q">{r.name}</td>
                      <td>{r.label}</td>
                      <td className="muted">{r.kind}</td>
                      <td>
                        <StatusChip record={r} />
                      </td>
                      <td className="when">{formatWhen(r.updatedAt)}</td>
                      <td className={isAgent(r.updatedBy) ? 'agent-ink' : undefined}>
                        {actorLabel(r.updatedBy, me)}
                      </td>
                    </tr>
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

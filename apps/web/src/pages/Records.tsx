import type { RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useDeferredValue, useState } from 'react';
import { actorLabel, formatWhen, isAgent } from '../lib/format.ts';
import { kindNoun } from '../lib/kinds.ts';
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

export interface Column {
  header: string;
  cell: (record: RecordEnvelope) => ReactNode;
  className?: string;
}

/** Every record in the lab, whatever its kind. Each registry also has its own page in the Library. */
export function RecordsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>all records</b>
          </div>
          <h1>All records</h1>
          <p className="lede">
            Everything the lab keeps track of, most recently changed first. Each registry also has
            its own page under Library.
          </p>
        </div>
      </div>
      <RecordList
        title="All records"
        columns={[{ header: 'Kind', cell: (r) => kindNoun(r.kind), className: 'muted' }]}
      />
    </>
  );
}

/**
 * A searchable list of records with a status filter. Registry pages pass their kind, their own
 * columns (after name and label), and optionally a filter of their own (`narrow`) with its buttons.
 */
export function RecordList({
  title,
  kind,
  columns = [],
  narrow,
  toolbar,
  placeholder = 'Find by name or label, e.g. LWT-0001',
  empty = 'Nothing here yet.',
}: {
  title: string;
  kind?: string;
  columns?: Column[];
  narrow?: ((record: RecordEnvelope) => boolean) | undefined;
  toolbar?: ReactNode;
  placeholder?: string;
  empty?: string;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('current');
  const deferred = useDeferredValue(search.trim());
  const {
    data = [],
    isPending,
    error,
  } = useQuery(
    recordsQuery({
      ...(kind ? { kind } : {}),
      ...(deferred ? { search: deferred } : {}),
      ...(status === 'current' ? {} : { status }),
    }),
  );
  const records = narrow ? data.filter(narrow) : data;
  const me = useMe();
  const navigate = useNavigate();
  const open = (id: string) => navigate({ to: '/records/$id', params: { id } });

  return (
    <section className="block">
      <header>
        <h2>{title}</h2>
        <span className="state muted num">{records.length} shown</span>
      </header>
      <div className="body">
        <div className="toolbar">
          <input
            className="field grow"
            type="search"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Find ${title.toLowerCase()}`}
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
        {toolbar}
        {error && <p className="error-text">{error.message}</p>}
        {isPending ? (
          <p className="empty">Loading…</p>
        ) : records.length === 0 ? (
          <p className="empty">{deferred ? 'Nothing matches.' : empty}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Label</th>
                  {columns.map((c) => (
                    <th key={c.header}>{c.header}</th>
                  ))}
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
                    onClick={() => open(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && open(r.id)}
                  >
                    <td className="q">{r.name}</td>
                    <td>{r.label}</td>
                    {columns.map((c) => (
                      <td key={c.header} className={c.className}>
                        {c.cell(r)}
                      </td>
                    ))}
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
  );
}

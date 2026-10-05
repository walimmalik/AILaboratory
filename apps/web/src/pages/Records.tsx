import type { RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useDeferredValue, useState } from 'react';
import { actorLabel, formatWhen, isAgent, proposalTouches } from '../lib/format.ts';
import { kindNoun } from '../lib/kinds.ts';
import { recordsQuery, reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { StatusChip } from './StatusChip.tsx';

export type StatusFilter = 'current' | 'draft' | 'active' | 'archived';
export interface RecordListFilters {
  search: string;
  status: StatusFilter;
}
const filters: [StatusFilter, string][] = [
  ['current', 'Current'],
  ['draft', 'Drafts'],
  ['active', 'Confirmed'],
  ['archived', 'Archived'],
];

export interface Column {
  header: string;
  cell: (record: RecordEnvelope) => ReactNode;
  className?: string;
  /** Whether a record has a value here; a column no shown record fills is left out (review 17). */
  filled?: (record: RecordEnvelope) => boolean;
  /** Left out on a phone, so the rows that stay keep one line each (review 2026-10-02, item 5). */
  secondary?: boolean;
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
  onSearch,
  searchAction,
  noMatch = 'Nothing matches.',
  filters: controlledFilters,
}: {
  title: string;
  kind?: string;
  columns?: Column[];
  narrow?: ((record: RecordEnvelope) => boolean) | undefined;
  toolbar?: ReactNode;
  placeholder?: string;
  empty?: string;
  /** Hears what is typed in the find box, for a page that searches more with the same words. */
  onSearch?: (text: string) => void;
  /** A button beside the find box that acts on the same words (search the documents' text). */
  searchAction?: ReactNode;
  /** What the list says when the find box matches nothing. */
  noMatch?: string;
  /** Optional route-owned filters; all other lists keep their local browsing state. */
  filters?: RecordListFilters & { onChange: (filters: RecordListFilters) => void };
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [localStatus, setLocalStatus] = useState<StatusFilter>('current');
  const search = controlledFilters?.search ?? localSearch;
  const status = controlledFilters?.status ?? localStatus;
  const setSearch = (next: string) =>
    controlledFilters ? controlledFilters.onChange({ search: next, status }) : setLocalSearch(next);
  const setStatus = (next: StatusFilter) =>
    controlledFilters ? controlledFilters.onChange({ search, status: next }) : setLocalStatus(next);
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
  const shownColumns = columns.filter((c) => !c.filled || records.some(c.filled));
  // Status says only what is unusual (a draft, an archived record, a change waiting).
  const review = useQuery(reviewQuery).data?.items ?? [];
  const showStatus = records.some(
    (r) =>
      r.status !== 'active' ||
      review.some((i) => i.type === 'change' && proposalTouches(i.proposal, r.id)),
  );
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
            onChange={(e) => {
              setSearch(e.target.value);
              onSearch?.(e.target.value);
            }}
            aria-label={`Find ${title.toLowerCase()}`}
          />
          {searchAction}
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
          <p className="empty">{deferred || narrow ? noMatch : empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="record-list">
              <thead>
                <tr>
                  <th>Name</th>
                  {shownColumns.map((c) => (
                    <th key={c.header} className={c.secondary ? 'secondary' : undefined}>
                      {c.header}
                    </th>
                  ))}
                  {showStatus && <th>Status</th>}
                  <th className="secondary">Changed</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        e.defaultPrevented ||
                        e.button !== 0 ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey ||
                        target.closest(
                          'a, button, input, select, textarea, label, summary, [contenteditable], [role="button"], [role="link"]',
                        ) ||
                        e.currentTarget.ownerDocument.getSelection()?.toString()
                      )
                        return;
                      open(r.id);
                    }}
                  >
                    {/* The name first, its code as a tag after it (plan 004f: codes are never prefixes). */}
                    <td className="record-name">
                      <Link to="/records/$id" params={{ id: r.id }}>
                        <span className="one-line" title={r.label}>
                          {r.label}
                        </span>{' '}
                        <span className="code">{r.name}</span>
                      </Link>
                    </td>
                    {shownColumns.map((c) => (
                      <td
                        key={c.header}
                        className={[c.className, c.secondary && 'secondary']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                    {showStatus && (
                      <td>
                        <StatusChip record={r} quiet />
                      </td>
                    )}
                    <td
                      className={`when secondary${isAgent(r.updatedBy) ? ' agent-ink' : ''}`}
                      title={`by ${actorLabel(r.updatedBy, me)}`}
                    >
                      {formatWhen(r.updatedAt)}
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

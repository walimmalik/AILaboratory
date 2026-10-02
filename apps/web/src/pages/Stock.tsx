import { formatQuantity, readableVolume } from '@ailab/domain';
import {
  type InventoryOverview,
  type InventoryRef,
  inventoryDiscard,
  inventoryMove,
  inventoryOverview,
  type LocationAttributes,
  type PlacePath,
  type RecordEnvelope,
} from '@ailab/schema';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Fragment, type ReactNode, useDeferredValue, useState } from 'react';
import { api } from '../api.ts';
import { formatDay } from '../lib/format.ts';
import { pathWords } from '../lib/inventory.ts';
import { recordsQuery } from '../queries.ts';
import { Head, page } from './AreaHead.tsx';

type Row = InventoryOverview['rows'][number];
type Batch = Row['batches'][number];
type TypeFilter = 'all' | 'reagents' | 'materials';
const typeFilters: [TypeFilter, string][] = [
  ['all', 'Everything'],
  ['reagents', 'Reagents and kits'],
  ['materials', 'Materials'],
];

/** Lots expiring within this many days read in warning ink. */
const SOON_DAYS = 90;

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const amountWords = (q: Row['amount']) => (q ? formatQuantity(readableVolume(q)) : undefined);

/** "2 lots · 3 containers": what the lab has of a thing. */
function haveWords(row: Row): string {
  const lots = row.batches.filter((b) => b.batch.kind === 'lot').length;
  const samples = row.batches.length - lots;
  const batches = [lots && plural(lots, 'lot'), samples && plural(samples, 'sample')]
    .filter(Boolean)
    .join(' · ');
  const containers = new Set(row.batches.flatMap((b) => b.containers.map((c) => c.container.id)));
  return containers.size ? `${batches} · ${plural(containers.size, 'container')}` : batches;
}

/** The innermost place of each container, the first named and the rest counted. */
function whereWords(row: Row): { text: string; title: string } | undefined {
  const paths = new Map<string, string>();
  for (const b of row.batches)
    for (const c of b.containers) {
      const last = c.path.at(-1);
      if (last) paths.set(last.label, pathWords(c.path));
    }
  const [first, ...rest] = [...paths.keys()];
  if (!first) return undefined;
  return {
    text: rest.length ? `${first} and ${plural(rest.length, 'more place')}` : first,
    title: [...paths.values()].join('\n'),
  };
}

function Expiry({ date, today }: { date: string | undefined; today: string }) {
  if (!date) return <span className="muted">—</span>;
  const days = daysUntil(date, today);
  if (days < 0) return <span className="crit-ink">expired {formatDay(date)}</span>;
  return (
    <span
      className={days <= SOON_DAYS ? 'warn-ink' : undefined}
      title={days <= SOON_DAYS ? `In ${plural(days, 'day')}` : undefined}
    >
      {formatDay(date)}
    </span>
  );
}

/** A record's name in agent ink while an agent's draft waits for a person. */
function RefLink({ item, children }: { item: InventoryRef; children?: ReactNode }) {
  return (
    <>
      <Link
        to="/records/$id"
        params={{ id: item.id }}
        className={item.agentDraft ? 'agent-ink' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {children ?? item.label}
      </Link>
      {item.status === 'draft' && (
        <span className={item.agentDraft ? 'agent-ink' : 'muted'}> · draft</span>
      )}
    </>
  );
}

/** Rooms, fridges and freezers as indented options, for filtering and for moving. */
function usePlaceOptions() {
  const locations = useQuery(recordsQuery({ kind: 'location' })).data ?? [];
  const parentOf = (r: RecordEnvelope) => (r.attributes as Partial<LocationAttributes>).parent;
  const ids = new Set(locations.map((l) => l.id));
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const l of locations
      .filter((l) => (parent ? parentOf(l) === parent : !ids.has(parentOf(l) ?? '')))
      .sort((a, b) => a.label.localeCompare(b.label))) {
      out.push({ id: l.id, label: l.label, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

function PlaceSelect({
  value,
  onChange,
  label,
  any,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
  any: string;
}) {
  const options = usePlaceOptions();
  return (
    <select
      className="field"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{any}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {'  '.repeat(o.depth)}
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Inventory (plan 004f N2, N3): every reagent and material the lab has, with its lots or samples,
 * the containers holding them, where they are, how much is left and the earliest expiry. The
 * same list an agent reads with `inventory.overview`.
 */
export function StockPage() {
  const sent = useSearch({ strict: false }) as { find?: string };
  const [text, setText] = useState(sent.find ?? '');
  const [type, setType] = useState<TypeFilter>('all');
  const [place, setPlace] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<ReadonlyMap<string, InventoryRef>>(new Map());
  const [said, setSaid] = useState<string>();
  const search = useDeferredValue(text.trim());
  const today = localDay(new Date());
  const overview = useQuery({
    queryKey: ['inventory', 'overview', { search, type, place, today }],
    queryFn: () =>
      api.run(inventoryOverview, {
        today,
        ...(search ? { text: search } : {}),
        ...(type === 'all' ? {} : { type }),
        ...(place ? { place } : {}),
      }),
    placeholderData: keepPreviousData,
  });
  const rows = overview.data?.rows ?? [];
  const notInStock = overview.data?.notInStock ?? [];
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const pick = (item: InventoryRef) => {
    setSaid(undefined);
    setPicked((now) => {
      const next = new Map(now);
      if (!next.delete(item.id)) next.set(item.id, item);
      return next;
    });
  };

  return (
    <>
      <Head
        page={page('inventory')}
        lede="What the lab has, where it is, how much is left and until when. Open a row for its lots or samples and the containers holding them."
      />
      <section className="block stock">
        <header>
          <h2>In stock</h2>
          <span className="state muted num">{plural(rows.length, 'thing')}</span>
        </header>
        <div className="body">
          <div className="toolbar">
            <input
              className="field grow"
              type="search"
              placeholder="Find by name, e.g. staurosporine or DMSO"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Find in inventory"
            />
            <PlaceSelect value={place} onChange={setPlace} label="Place" any="All places" />
            <fieldset className="segmented">
              <legend className="sr-only">Type</legend>
              {typeFilters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={type === value}
                  onClick={() => setType(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
          {picked.size > 0 ? (
            <BulkBar
              picked={picked}
              onDone={(message) => {
                setPicked(new Map());
                setSaid(message);
              }}
            />
          ) : (
            said && (
              <p className="muted" role="status">
                {said}
              </p>
            )
          )}
          {overview.error && <p className="error-text">{overview.error.message}</p>}
          {overview.isPending ? (
            <p className="empty">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="empty">
              {search || place || type !== 'all'
                ? 'Nothing in stock matches.'
                : 'Nothing is in stock yet. Register a delivery of lots, or load the seed lab.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>What it is</th>
                    <th className="have">Have</th>
                    <th>Left</th>
                    <th>Where</th>
                    <th title="The earliest expiry among its lots">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const id = row.thing.id;
                    const isOpen = open.has(id);
                    const where = whereWords(row);
                    return (
                      <Fragment key={id}>
                        <tr className="clickable thing" onClick={() => toggle(id)}>
                          <td>
                            <button
                              type="button"
                              className="disclosure"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Close' : 'Open'} ${row.thing.label}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(id);
                              }}
                            >
                              {isOpen ? '▾' : '▸'}
                            </button>
                            <RefLink item={row.thing} />
                            <div className="muted small">
                              {row.category}
                              {row.linked.map((l) => (
                                <Fragment key={l.id}>
                                  {' · '}
                                  <RefLink item={l} />
                                </Fragment>
                              ))}
                            </div>
                          </td>
                          <td className="have">{haveWords(row)}</td>
                          <td className="num">{amountWords(row.amount) ?? '—'}</td>
                          <td title={where?.title}>
                            {where?.text ?? (
                              <span className="muted" title="No container of it is recorded">
                                —
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <Expiry date={row.earliestExpiry} today={today} />
                          </td>
                        </tr>
                        {isOpen &&
                          row.batches.map((b) => (
                            <BatchRows
                              key={b.batch.id}
                              batch={b}
                              today={today}
                              picked={picked}
                              onPick={pick}
                            />
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!place && notInStock.length > 0 && (
            <details className="not-in-stock">
              <summary className="not-in-stock-head">
                Not in stock <span className="muted num">{notInStock.length}</span>
              </summary>
              <p className="muted small">
                Reagents and materials the lab knows with no lot or sample in a container.
              </p>
              <ul className="not-in-stock-list">
                {notInStock.map((t) => (
                  <li key={t.id} className="not-in-stock-item">
                    <RefLink item={t} /> <span className="muted small">{t.type}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted small by-kind">
            Lists by kind: <Link to="/reagents">reagents</Link> · <Link to="/lots">lots</Link> ·{' '}
            <Link to="/entities">materials</Link> · <Link to="/samples">samples</Link>
          </p>
        </div>
      </section>
    </>
  );
}

/** The innermost place first, the rooms around it below in small type. */
function PlaceWords({ path }: { path: PlacePath }) {
  const here = path.at(-1);
  if (!here) return <span className="muted">place not recorded</span>;
  return (
    <>
      {here.position ? `${here.name} ${here.position}` : here.label}
      {path.length > 1 && <div className="muted small">{pathWords(path.slice(0, -1))}</div>}
    </>
  );
}

/** A lot or sample under its row: one line per container holding it, each one pickable. */
function BatchRows({
  batch,
  today,
  picked,
  onPick,
}: {
  batch: Batch;
  today: string;
  picked: ReadonlyMap<string, InventoryRef>;
  onPick: (container: InventoryRef) => void;
}) {
  const name = (
    <>
      {batch.batch.kind === 'lot' ? 'Lot ' : 'Sample '}
      <RefLink item={batch.batch}>{batch.number ?? batch.batch.label}</RefLink>
      {batch.state && <span className="muted"> · {batch.state}</span>}
    </>
  );
  if (batch.containers.length === 0)
    return (
      <tr className="batch">
        <td className="batch-name">{name}</td>
        <td className="have muted">not in a recorded container</td>
        <td className="num">{amountWords(batch.amount) ?? '—'}</td>
        <td />
        <td className="num">
          <Expiry date={batch.expiry} today={today} />
        </td>
      </tr>
    );
  return batch.containers.map((c, i) => (
    <tr key={c.container.id} className="batch">
      <td className="batch-name">{i === 0 ? name : null}</td>
      <td className="have">
        <label className="pick">
          <input
            type="checkbox"
            checked={picked.has(c.container.id)}
            onChange={() => onPick(c.container)}
            aria-label={`Pick ${c.container.name}`}
          />
          <RefLink item={c.container}>{c.container.name}</RefLink>
        </label>{' '}
        <span className="muted">{plural(c.wells, 'well')}</span>
      </td>
      <td className="num">{amountWords(c.amount) ?? '—'}</td>
      <td>
        <PlaceWords path={c.path} />
      </td>
      <td className="num">{i === 0 ? <Expiry date={batch.expiry} today={today} /> : null}</td>
    </tr>
  ));
}

/** Move or discard the picked containers, one operation each, as Scan does for one. */
function BulkBar({
  picked,
  onDone,
}: {
  picked: ReadonlyMap<string, InventoryRef>;
  onDone: (message?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const items = [...picked.values()];
  const names = items.map((c) => c.name).join(', ');
  const why = reason.trim() ? { reason: reason.trim() } : {};
  const finish = async (said: string) => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    await queryClient.invalidateQueries({ queryKey: ['records'] });
    onDone(said);
  };
  const move = useMutation({
    mutationFn: async () => {
      for (const c of items)
        await api.run(inventoryMove, {
          container: c.id,
          expectedVersion: c.version,
          to: { location: to },
          ...why,
        });
    },
    onSuccess: () => finish(`Moved ${plural(items.length, 'container')}: ${names}.`),
    onError: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
  const discard = useMutation({
    mutationFn: async () => {
      for (const c of items)
        await api.run(inventoryDiscard, { container: c.id, expectedVersion: c.version, ...why });
    },
    onSuccess: () => finish(`Discarded ${plural(items.length, 'container')}: ${names}.`),
    onError: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
  const running = move.isPending || discard.isPending;
  const error = move.error ?? discard.error;
  return (
    <fieldset className="bulk">
      <legend className="sr-only">Picked containers</legend>
      <p className="bulk-picked">
        <b>{plural(items.length, 'container')} picked</b> <span className="muted">{names}</span>
      </p>
      {confirming ? (
        <div className="toolbar">
          <span>
            Discard {plural(items.length, 'container')}? Their wells are emptied in the ledger; they
            stay readable with their history.
          </span>
          <button
            type="button"
            className="btn danger"
            disabled={running}
            onClick={() => discard.mutate()}
          >
            Discard
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep them
          </button>
        </div>
      ) : (
        <form
          className="toolbar"
          aria-label="Move picked"
          onSubmit={(e) => {
            e.preventDefault();
            move.mutate();
          }}
        >
          <PlaceSelect value={to} onChange={setTo} label="Move to" any="Move to…" />
          <input
            className="field grow"
            aria-label="Why"
            placeholder="Why (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={running || !to}>
            Move
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Discard…
          </button>
          <button type="button" className="btn" onClick={() => onDone()}>
            Clear
          </button>
        </form>
      )}
      {error && <p className="error-text">{error.message}</p>}
    </fieldset>
  );
}

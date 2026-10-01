import {
  type LiquidClassAttributes,
  type LiquidTypeAttributes,
  type LotAttributes,
  liquidsSearchClasses,
  type ProductAttributes,
  type RecordEnvelope,
  reagentsSearch,
  type StorageBand,
  type VerificationAttributes,
} from '@ailab/schema';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { type KindPage, libraryPages } from '../lib/kinds.ts';
import {
  cellWords,
  classMatrix,
  type MatrixClass,
  platformWords,
  shortLabel,
  storageWords,
  volumeWords,
} from '../lib/liquids.ts';
import { recordQuery, recordsQuery } from '../queries.ts';
import { Head, useLabels } from './Instruments.tsx';
import { NewRecordButton } from './NewRecord.tsx';
import { RecordList } from './Records.tsx';

const page = (kind: string) => libraryPages.find((p) => p.kind === kind) as KindPage;
const words = (id: string) => id.replaceAll('_', ' ');
const today = () => new Date().toISOString().slice(0, 10);

const summariesQuery = {
  queryKey: ['reagents', 'search'],
  queryFn: async () =>
    new Map((await api.run(reagentsSearch, { limit: 500 })).products.map((p) => [p.product.id, p])),
};

type StorageFilter = StorageBand | 'any';
const storageFilters: [StorageFilter, string][] = [
  ['any', 'Any'],
  ['room', 'Room'],
  ['fridge', 'Fridge'],
  ['freezer', 'Freezer'],
  ['deep_freezer', '−80'],
];

/** The reagent library (plan 009c): products with their storage, lots in date and next expiry. */
export function ReagentsPage() {
  const summaries = useQuery(summariesQuery).data;
  const vendors = useLabels('vendor');
  const [storage, setStorage] = useState<StorageFilter>('any');
  const [inDate, setInDate] = useState(false);
  const of = (r: RecordEnvelope) => r.attributes as Partial<ProductAttributes>;
  const summary = (r: RecordEnvelope) => summaries?.get(r.id);
  const filtered = storage !== 'any' || inDate;
  return (
    <>
      <Head
        page={page('product')}
        lede="What the lab buys and makes: reagents, kits and lab-made solutions, with how they are stored and handled, and their lots."
        actions={<NewRecordButton kind="product" />}
      />
      <RecordList
        title="Reagents"
        kind="product"
        placeholder="Find by name, e.g. BSA or PRD-0001"
        empty="No reagents yet. Ask the assistant to draft one from a catalog number or datasheet, or load the seed lab."
        narrow={
          filtered
            ? (r) =>
                (storage === 'any' || summary(r)?.storage === storage) &&
                (!inDate || (summary(r)?.lots.inDate ?? 0) > 0)
            : undefined
        }
        toolbar={
          <div className="toolbar">
            <fieldset className="segmented">
              <legend className="sr-only">Storage</legend>
              {storageFilters.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={storage === value}
                  onClick={() => setStorage(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <fieldset className="segmented">
              <legend className="sr-only">Lots</legend>
              <button type="button" aria-pressed={!inDate} onClick={() => setInDate(false)}>
                All
              </button>
              <button type="button" aria-pressed={inDate} onClick={() => setInDate(true)}>
                Has a lot in date
              </button>
            </fieldset>
          </div>
        }
        columns={[
          {
            header: 'Type',
            cell: (r) =>
              of(r).origin === 'made'
                ? 'made in the lab'
                : of(r).category
                  ? words(of(r).category as string)
                  : '—',
          },
          { header: 'Vendor', cell: (r) => vendors.get(of(r).vendor ?? '') ?? '—' },
          {
            header: 'Storage',
            cell: (r) => {
              const band = summary(r)?.storage;
              return band ? storageWords[band] : '—';
            },
            className: 'muted',
          },
          {
            header: 'Lots in date',
            cell: (r) => {
              const lots = summary(r)?.lots;
              if (!lots) return '…';
              return lots.count === 0 ? 'none' : `${lots.inDate} of ${lots.count}`;
            },
            className: 'num',
          },
          {
            header: 'Next expiry',
            cell: (r) => summary(r)?.lots.nextExpiry ?? '—',
            className: 'num',
          },
        ]}
      />
    </>
  );
}

const lotStatusWords: Record<LotAttributes['status'], string> = {
  unopened: 'unopened',
  opened: 'opened',
  quarantined: 'quarantined',
  expired: 'expired',
  used_up: 'used up',
};

/** Past its expiry: the date in warning ink. */
function Expiry({ date }: { date: string | undefined }) {
  if (!date) return '—';
  return date < today() ? (
    <span className="warn-ink" title="Past its expiry">
      {date}, past
    </span>
  ) : (
    date
  );
}

/** Lots (plan 009c): each batch of a product with its status and expiry. */
export function LotsPage() {
  const products = useLabels('product');
  const of = (r: RecordEnvelope) => r.attributes as Partial<LotAttributes>;
  return (
    <>
      <Head
        page={page('lot')}
        lede="Each batch the lab has received or made, with its status and expiry. Certificate values are on each lot."
        actions={<NewRecordButton kind="lot" />}
      />
      <RecordList
        title="Lots"
        kind="lot"
        placeholder="Find by product or lot number, e.g. BSA or LOT-0001"
        empty="No lots yet. Record one when a delivery arrives, or ask the assistant to."
        columns={[
          { header: 'Product', cell: (r) => products.get(of(r).product ?? '') ?? '…' },
          { header: 'Lot number', cell: (r) => of(r).lotNumber ?? '—', className: 'mono' },
          {
            header: 'Lot status',
            cell: (r) => {
              const status = of(r).status;
              return status ? lotStatusWords[status] : '—';
            },
          },
          { header: 'Expiry', cell: (r) => <Expiry date={of(r).expiry} />, className: 'num' },
        ]}
      />
    </>
  );
}

/** Liquid types (plan 009): how a liquid behaves when pipetted, on any instrument. */
export function LiquidTypesPage() {
  const of = (r: RecordEnvelope) => r.attributes as Partial<LiquidTypeAttributes>;
  return (
    <>
      <Head
        page={page('liquid_type')}
        lede="How liquids behave when pipetted, whatever the instrument. Each product has one, and it picks the liquid class on every instrument."
      />
      <RecordList
        title="Liquid types"
        kind="liquid_type"
        placeholder="Find by name, e.g. DMSO or LQT-0001"
        empty="No liquid types yet. Load the seed lab."
        columns={[
          { header: 'Behaves like', cell: (r) => (of(r).base ? words(of(r).base as string) : '—') },
          { header: 'Notes', cell: (r) => of(r).notes ?? '', className: 'muted' },
        ]}
      />
    </>
  );
}

/** A few records by ID, fetched one by one (for IDs across several kinds). */
function useRecordsById(ids: string[]) {
  const results = useQueries({ queries: ids.map((id) => recordQuery(id)) });
  const found = new Map<string, RecordEnvelope>();
  results.forEach((r, i) => {
    if (r.data) found.set(ids[i] as string, r.data);
  });
  return found;
}

/**
 * Liquid types against the lab's pipetting devices (plan 009, Screens): each cell says how many
 * classes serve the liquid on that device and whether one is verified; gaps are in agent ink.
 */
function ClassMatrix() {
  const found = useQuery({
    queryKey: ['liquids', 'classes'],
    queryFn: () => api.run(liquidsSearchClasses, { limit: 1000 }),
  });
  const types = (useQuery(recordsQuery({ kind: 'liquid_type' })).data ?? []).toSorted((a, b) =>
    a.label.localeCompare(b.label),
  );
  const classes: MatrixClass[] = (found.data?.classes ?? []).map((c) => ({
    record: c.liquidClass,
    attributes: c.liquidClass.attributes as LiquidClassAttributes,
    verified: c.verified,
  }));
  const ids = [
    ...new Set(
      classes.flatMap((c) =>
        [c.attributes.instrumentKind, c.attributes.device, c.attributes.sourceLabware].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    ),
  ].sort();
  const byId = useRecordsById(ids);
  const rows = classMatrix(
    classes,
    types.map((t) => t.id),
    (id) => byId.get(id)?.label ?? '…',
    (id) => {
      const record = byId.get(id);
      return record ? shortLabel(record) : '…';
    },
  );
  const [picked, setPicked] = useState<{ row: string; type: string }>();
  const pickedRow = rows.find((r) => r.key === picked?.row);
  const pickedCell = picked ? pickedRow?.cells.get(picked.type) : undefined;
  const pickedType = types.find((t) => t.id === picked?.type);
  return (
    <section className="block" aria-label="Classes by device and liquid type">
      <header>
        <h2>Classes by device and liquid type</h2>
        <span className="state muted">
          {found.data ? `${found.data.total} classes` : 'Loading…'}
        </span>
      </header>
      <div className="body">
        {found.error && <p className="error-text">{found.error.message}</p>}
        {found.data && rows.length === 0 ? (
          <p className="empty">No liquid classes yet. Load the seed lab for the vendor defaults.</p>
        ) : (
          <div className="table-wrap">
            <table className="class-matrix">
              <thead>
                <tr>
                  <th>Device</th>
                  {types.map((t) => (
                    <th key={t.id}>{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="device" title={row.title}>
                      {row.label}
                    </td>
                    {types.map((t) => {
                      const cell = row.cells.get(t.id);
                      const { text, tone } = cellWords(cell);
                      const ink = tone === 'agent' ? 'agent-ink' : (tone ?? '');
                      const here = picked?.row === row.key && picked.type === t.id;
                      return (
                        <td key={t.id} className={`nowrap ${ink}`}>
                          {cell && cell.classes.length > 0 ? (
                            <button
                              type="button"
                              className={`link-btn ${ink}`}
                              aria-pressed={here}
                              aria-label={`${text}: ${row.title}, ${t.label}`}
                              onClick={() =>
                                setPicked(here ? undefined : { row: row.key, type: t.id })
                              }
                            >
                              {text}
                            </button>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pickedRow && pickedCell && (
          <section className="matrix-pick" aria-label="Classes in the selected cell">
            <h3>
              {pickedType?.label} on {pickedRow.title}
            </h3>
            <ul className="plain">
              {pickedCell.classes.map((c) => (
                <li key={c.record.id}>
                  <Link to="/records/$id" params={{ id: c.record.id }}>
                    {c.record.label}
                  </Link>
                  <span className="muted">
                    {' '}
                    {[
                      volumeWords(c.attributes.volume),
                      c.attributes.labDefault ? 'lab default' : undefined,
                      c.verified ? 'verified' : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {c.record.status !== 'active' && <span className="agent-ink"> · draft</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="muted">
          Drafts, in agent ink, wait for your review; only confirmed classes are used for transfers.
          A class counts as verified only after a real check in this lab. Select a cell to list its
          classes.
        </p>
      </div>
    </section>
  );
}

/** Liquid classes (plan 009c): the matrix, then every class with where it runs. */
export function LiquidClassesPage() {
  const models = useLabels('instrument_kind');
  const types = useLabels('liquid_type');
  const of = (r: RecordEnvelope) => r.attributes as Partial<LiquidClassAttributes>;
  return (
    <>
      <Head
        page={page('liquid_class')}
        lede="How each instrument pipettes each kind of liquid. The lab's default for a liquid type on a device is used unless a step or product names another."
      />
      <ClassMatrix />
      <RecordList
        title="Liquid classes"
        kind="liquid_class"
        placeholder="Find by name, e.g. Water or LQC-0001"
        empty="No liquid classes yet. Load the seed lab for the vendor defaults."
        columns={[
          {
            header: 'Instrument model',
            cell: (r) => models.get(of(r).instrumentKind ?? '') ?? '…',
          },
          {
            header: 'For',
            cell: (r) => (of(r).liquidTypes ?? []).map((t) => types.get(t) ?? '…').join(', '),
          },
          { header: 'Volume', cell: (r) => volumeWords(of(r).volume), className: 'num' },
          {
            header: 'Settings',
            cell: (r) => {
              const platform = of(r).settings?.platform;
              return platform ? platformWords[platform] : '—';
            },
            className: 'muted',
          },
          {
            header: 'Default',
            cell: (r) => (of(r).labDefault ? 'lab default' : ''),
            className: 'muted',
          },
        ]}
      />
    </>
  );
}

/** Beside a product: its lots, soonest expiry first. */
export function ProductBlocks({ record }: { record: RecordEnvelope }) {
  const lots = (useQuery(recordsQuery({ kind: 'lot' })).data ?? [])
    .filter((l) => (l.attributes as Partial<LotAttributes>).product === record.id)
    .map((l) => ({ record: l, attributes: l.attributes as LotAttributes }))
    .sort((a, b) => (a.attributes.expiry ?? '9999').localeCompare(b.attributes.expiry ?? '9999'));
  return (
    <section className="block" aria-label="Lots">
      <header>
        <h2>Lots</h2>
        <span className="state muted num">{lots.length}</span>
      </header>
      <div className="body">
        {lots.length === 0 ? (
          <p className="muted">
            No lots yet. Record one when it arrives (<Link to="/lots">Lots</Link>).
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Status</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.record.id}>
                    <td className="mono">
                      <Link to="/records/$id" params={{ id: l.record.id }}>
                        {l.attributes.lotNumber}
                      </Link>
                    </td>
                    <td>{lotStatusWords[l.attributes.status]}</td>
                    <td className="num">
                      <Expiry date={l.attributes.expiry} />
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

/** Beside a liquid class: its checks, latest first. Demo runs never make it verified. */
export function LiquidClassBlocks({ record }: { record: RecordEnvelope }) {
  const checks = (useQuery(recordsQuery({ kind: 'liquid_class_verification' })).data ?? [])
    .map((c) => ({ record: c, attributes: c.attributes as VerificationAttributes }))
    .filter((c) => c.attributes.liquidClass === record.id)
    .sort((a, b) => b.attributes.date.localeCompare(a.attributes.date));
  return (
    <section className="block" aria-label="Checks">
      <header>
        <h2>Checks</h2>
        <span className="state muted num">{checks.length}</span>
      </header>
      <div className="body">
        {checks.length === 0 ? (
          <p className="muted">
            Not checked in this lab yet. Record a gravimetric or dye check to verify it.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>CV</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.record.id}>
                    <td className="num">
                      <Link to="/records/$id" params={{ id: c.record.id }}>
                        {c.attributes.date}
                      </Link>
                    </td>
                    <td>{c.attributes.method}</td>
                    <td className="num">{c.attributes.cv}%</td>
                    <td className="muted">{c.attributes.demo ? 'demo, does not count' : ''}</td>
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

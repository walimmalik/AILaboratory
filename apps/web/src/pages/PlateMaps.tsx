import {
  type LayoutAttributes,
  layoutsPreview,
  type PlateMapAttributes,
  type PlatePlan,
  platemapsExport,
  platemapsWells,
  type RecordEnvelope,
  type WellPlan,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type CSSProperties, Fragment, useState } from 'react';
import { api } from '../api.ts';
import { fileOf } from '../lib/files.ts';
import { type KindPage, libraryPages } from '../lib/kinds.ts';
import {
  describeWell,
  plateGrid,
  pointsBySubject,
  roleClass,
  roleCounts,
  roleText,
  shade,
  subjectCount,
} from '../lib/platemaps.ts';
import { recordQuery } from '../queries.ts';
import { FileCard } from './FileCard.tsx';
import { Head, useLabels } from './Instruments.tsx';
import { RecordList } from './Records.tsx';

/**
 * Layout and plate map screens (plan 014b). The plate comes first: roles by tone, a series as a
 * gradient, one plate at a time with a strip of all of them, and a well's details on demand.
 */

const page = (kind: string) => libraryPages.find((p) => p.kind === kind) as KindPage;
const layoutOf = (r: RecordEnvelope) => r.attributes as LayoutAttributes;
const mapOf = (r: RecordEnvelope) => r.attributes as PlateMapAttributes;

export function LayoutsPage() {
  return (
    <>
      <Head
        page={page('layout')}
        lede="The lab's plate patterns: where samples, controls and standards go, replicates and placement. A plate map applies one to real samples."
      />
      <RecordList
        title="Layouts"
        kind="layout"
        placeholder="Find by title or name, e.g. ELISA or LYT-0001"
        empty="No layouts yet. Ask the assistant to draft one, e.g. “our ELISA 96: standards in columns 1 and 2, blanks H1:H2, samples in duplicate”."
        columns={[
          { header: 'Wells', cell: (r) => layoutOf(r).wells, className: 'num' },
          { header: 'Holds', cell: (r) => `${roleText(layoutOf(r).subjectRole).toLowerCase()}s` },
          { header: 'For', cell: (r) => layoutOf(r).assays?.join(', ') ?? '—', className: 'muted' },
        ]}
      />
    </>
  );
}

export function PlateMapsPage() {
  const layouts = useLabels('layout');
  return (
    <>
      <Head
        page={page('plate_map')}
        lede="Real samples and compounds placed on plates by a layout, ready for the transfer plan."
      />
      <RecordList
        title="Plate maps"
        kind="plate_map"
        placeholder="Find by title or name, e.g. IL-6 or PMP-0001"
        empty="No plate maps yet. Ask the assistant to place an experiment's samples with one of the lab's layouts."
        columns={[
          {
            header: 'Layout',
            cell: (r) => layouts.get(mapOf(r).layout.id) ?? mapOf(r).layout.id,
          },
          { header: 'Placing', cell: (r) => mapOf(r).subjects.length, className: 'num' },
        ]}
      />
    </>
  );
}

/** Plates with a strip to move between them, the plate itself, its key and a well's details. */
export function PlateView({ plates, title }: { plates: PlatePlan[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<WellPlan>();
  const [pointed, setPointed] = useState<string>();
  const plate = plates[Math.min(index, plates.length - 1)];
  if (!plate) return <p className="empty">No plates yet: nothing is placed.</p>;
  const grid = plateGrid(plate.wells.length);
  const byWell = new Map(plate.wells.map((w) => [w.well, w]));
  const points = pointsBySubject(plate);
  const text = (w: WellPlan) => describeWell(w, w.subject ? points.get(w.subject) : undefined);
  return (
    <div className="plate-wrap">
      {plates.length > 1 && (
        <nav className="plate-strip" aria-label="Plates">
          {plates.map((p, i) => (
            <button
              key={p.plate}
              type="button"
              className="btn"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setPicked(undefined);
              }}
            >
              Plate {p.plate}
              <span className="muted num"> · {subjectCount(p)}</span>
            </button>
          ))}
        </nav>
      )}
      <ul className="legend" aria-label="Key">
        {roleCounts(plate).map(({ role, count }) => (
          <li key={role}>
            <i className={roleClass(role)} />
            {roleText(role)} <span className="muted num">{count}</span>
          </li>
        ))}
      </ul>
      <fieldset
        className={`plate${grid.columns > 12 ? ' dense' : ''}`}
        aria-label={`${title}, plate ${plate.plate}`}
        style={{ '--cols': grid.columns } as CSSProperties}
      >
        <span className="axis" />
        {Array.from({ length: grid.columns }, (_, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
          <span key={c} className="axis">
            {c + 1}
          </span>
        ))}
        {grid.rowLabels.map((row) => (
          <Fragment key={row}>
            <span className="axis">{row}</span>
            {Array.from({ length: grid.columns }, (_, c) => {
              const name = `${row}${c + 1}`;
              const w = byWell.get(name) ?? { well: name, role: 'empty' };
              const level = shade(w, w.subject ? (points.get(w.subject) ?? 0) : 0);
              return (
                <button
                  key={name}
                  type="button"
                  className={`well ${roleClass(w.role)} shade-${level}${w.override ? ' override' : ''}`}
                  aria-pressed={picked?.well === name}
                  aria-label={text(w)}
                  onClick={() => setPicked(w)}
                  onMouseEnter={() => setPointed(name)}
                  onFocus={() => setPointed(name)}
                  onMouseLeave={() => setPointed(undefined)}
                  onBlur={() => setPointed(undefined)}
                />
              );
            })}
          </Fragment>
        ))}
      </fieldset>
      <p className="hover-info" aria-live="polite">
        {pointed
          ? text(byWell.get(pointed) ?? { well: pointed, role: 'empty' })
          : 'Point at a well to see what goes in; select it for details.'}
      </p>
      {picked && (
        <WellDetail
          well={picked}
          points={picked.subject ? points.get(picked.subject) : undefined}
        />
      )}
    </div>
  );
}

function WellDetail({ well, points }: { well: WellPlan; points: number | undefined }) {
  const linked = well.subject && /^[a-z]+_[0-9A-Z]{26}$/.test(well.subject);
  return (
    <div className="well-detail">
      <h3>
        {well.well}: {roleText(well.role)}
      </h3>
      <p>
        {linked ? (
          <Link to="/records/$id" params={{ id: well.subject as string }}>
            {well.label ?? well.subject}
          </Link>
        ) : (
          (well.label ?? 'Nothing named')
        )}
        {well.point && `, point ${well.point}${points ? ` of ${points}` : ''}`}
        {well.replicate && `, replicate ${well.replicate}`}
      </p>
      {well.override && <p className="muted">Changed by hand; it stays when the map is rebuilt.</p>}
    </div>
  );
}

/** A layout's plate as it comes out full, and how many plates a number of subjects needs. */
export function LayoutBlocks({ record }: { record: RecordEnvelope }) {
  const a = layoutOf(record);
  const [subjects, setSubjects] = useState<number>();
  const capacity = useQuery({
    queryKey: ['record', record.id, 'preview', record.version, 1],
    queryFn: () => api.run(layoutsPreview, { layout: record.id, subjects: 1, seed: 1 }),
    retry: false,
  });
  const perPlate = capacity.data?.perPlate;
  const n = subjects ?? perPlate;
  const preview = useQuery({
    queryKey: ['record', record.id, 'preview', record.version, n],
    queryFn: () => api.run(layoutsPreview, { layout: record.id, subjects: n ?? 0, seed: 1 }),
    enabled: n !== undefined,
    retry: false,
  });
  const error = capacity.error ?? preview.error;
  return (
    <section className="block" aria-label="Plate">
      <header>
        <h2>Plate</h2>
        <span className="state muted num">
          {perPlate !== undefined &&
            `${perPlate} ${roleText(a.subjectRole).toLowerCase()}s per plate`}
        </span>
      </header>
      <div className="body">
        {error && <p className="error-text">{error.message}</p>}
        <label className="try-count">
          Try with{' '}
          <input
            type="number"
            min={0}
            max={5000}
            className="field num"
            value={n ?? ''}
            onChange={(e) =>
              setSubjects(e.target.value === '' ? undefined : Number(e.target.value))
            }
            aria-label={`Number of ${roleText(a.subjectRole).toLowerCase()}s`}
          />{' '}
          {roleText(a.subjectRole).toLowerCase()}s
          {preview.data && (
            <span className="muted">
              {' '}
              → {preview.data.plates} plate{preview.data.plates === 1 ? '' : 's'}
            </span>
          )}
        </label>
        {preview.data && <PlateView plates={preview.data.wells} title={record.label} />}
        {a.strategy && a.strategy !== 'in_order' && (
          <p className="muted">
            Shown with one fixed seed; each plate map keeps its own, so its wells differ.
          </p>
        )}
      </div>
    </section>
  );
}

/** A plate map's plates, what it places, and the CSV to save. */
export function PlateMapBlocks({ record }: { record: RecordEnvelope }) {
  const a = mapOf(record);
  const layout = useQuery(recordQuery(a.layout.id));
  const wells = useQuery({
    queryKey: ['record', record.id, 'wells', record.version],
    queryFn: () => api.run(platemapsWells, { id: record.id }),
    retry: false,
  });
  const exported = useQuery({
    queryKey: ['record', record.id, 'export', record.version],
    queryFn: () => api.run(platemapsExport, { id: record.id }),
    retry: false,
  });
  const file = exported.data ? fileOf(platemapsExport.id, exported.data) : undefined;
  const plates = wells.data?.plates ?? [];
  return (
    <section className="block" aria-label="Plates">
      <header>
        <h2>Plates</h2>
        <span className="state muted num">
          {wells.data &&
            `${a.subjects.length} placed on ${plates.length} plate${plates.length === 1 ? '' : 's'}`}
        </span>
      </header>
      <div className="body">
        <p className="muted">
          Follows{' '}
          <Link to="/records/$id" params={{ id: a.layout.id }}>
            {layout.data ? `${layout.data.name} ${layout.data.label}` : a.layout.id}
          </Link>{' '}
          version {a.layout.version}
          {a.seed !== undefined && <>, seed {a.seed}</>}.
        </p>
        {wells.error && <p className="error-text">{wells.error.message}</p>}
        {wells.data && <PlateView plates={plates} title={record.label} />}
        {(wells.data?.staleOverrides.length ?? 0) > 0 && (
          <p className="warn-text">
            {wells.data?.staleOverrides.length} hand edit
            {wells.data?.staleOverrides.length === 1 ? ' no longer lands' : 's no longer land'} on a
            plate.
          </p>
        )}
        {file && <FileCard file={file} />}
      </div>
    </section>
  );
}

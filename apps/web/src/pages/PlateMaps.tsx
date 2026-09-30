import {
  type LayoutAttributes,
  layoutsPreview,
  layoutsSaveFromMap,
  type PlateMapAttributes,
  type PlatePlan,
  platemapsExport,
  platemapsOverride,
  platemapsWells,
  type RecordEnvelope,
  type WellPlan,
  WellRole,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type CSSProperties, type FormEvent, Fragment, useState } from 'react';
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

/** A well on a plate of a map, as selections hold it: "1:A1". */
export const wellKey = (plate: number, well: string) => `${plate}:${well}`;

/**
 * Plates with a strip to move between them, the plate itself, its key and a well's details. With
 * `onToggle`, selecting a well (or a row or column label) adds it to or takes it from `selected`.
 */
export function PlateView({
  plates,
  title,
  selected,
  onToggle,
}: {
  plates: PlatePlan[];
  title: string;
  selected?: ReadonlySet<string>;
  onToggle?: (keys: string[]) => void;
}) {
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
        {Array.from({ length: grid.columns }, (_, c) =>
          onToggle ? (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={c}
              type="button"
              className="axis"
              aria-label={`Select column ${c + 1}`}
              onClick={() =>
                onToggle(grid.rowLabels.map((r) => wellKey(plate.plate, `${r}${c + 1}`)))
              }
            >
              {c + 1}
            </button>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
            <span key={c} className="axis">
              {c + 1}
            </span>
          ),
        )}
        {grid.rowLabels.map((row) => (
          <Fragment key={row}>
            {onToggle ? (
              <button
                type="button"
                className="axis"
                aria-label={`Select row ${row}`}
                onClick={() =>
                  onToggle(
                    Array.from({ length: grid.columns }, (_, c) =>
                      wellKey(plate.plate, `${row}${c + 1}`),
                    ),
                  )
                }
              >
                {row}
              </button>
            ) : (
              <span className="axis">{row}</span>
            )}
            {Array.from({ length: grid.columns }, (_, c) => {
              const name = `${row}${c + 1}`;
              const w = byWell.get(name) ?? { well: name, role: 'empty' };
              const level = shade(w, w.subject ? (points.get(w.subject) ?? 0) : 0);
              const chosen = selected?.has(wellKey(plate.plate, name));
              return (
                <button
                  key={name}
                  type="button"
                  className={`well ${roleClass(w.role)} shade-${level}${w.override ? ' override' : ''}${chosen ? ' chosen' : ''}`}
                  aria-pressed={onToggle ? chosen : picked?.well === name}
                  aria-label={text(w)}
                  onClick={() => {
                    setPicked(w);
                    onToggle?.([wellKey(plate.plate, name)]);
                  }}
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
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // A row or column label adds all its wells, or takes them all out when all are chosen.
  const toggle = (keys: string[]) =>
    setSelected((current) => {
      const next = new Set(current);
      const all = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });
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
        {wells.data && (
          <PlateView
            plates={plates}
            title={record.label}
            {...(editing ? { selected, onToggle: toggle } : {})}
          />
        )}
        {editing ? (
          <EditBar
            record={record}
            plates={plates}
            selected={selected}
            onClear={() => setSelected(new Set())}
            onDone={() => {
              setEditing(false);
              setSelected(new Set());
            }}
          />
        ) : (
          record.status !== 'archived' && (
            <div className="actions">
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Change wells
              </button>
              <SaveAsLayout record={record} />
            </div>
          )
        )}
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

/** Roles offered for hand edits, in the order people reach for them. */
const EDIT_ROLES = WellRole.options;

/**
 * Hand edits (M5): the chosen wells get a role and, optionally, one of the map's subjects or control
 * records, with why. Hand edits on chosen wells can be undone, so they follow the layout again.
 */
function EditBar({
  record,
  plates,
  selected,
  onClear,
  onDone,
}: {
  record: RecordEnvelope;
  plates: PlatePlan[];
  selected: ReadonlySet<string>;
  onClear: () => void;
  onDone: () => void;
}) {
  const a = mapOf(record);
  const queryClient = useQueryClient();
  const [role, setRole] = useState<WellRole>('blank');
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const keys = [...selected].map((k) => {
    const [plate, well] = k.split(':');
    return { plate: Number(plate), well: well as string };
  });
  const edited = keys.filter((k) =>
    (a.overrides ?? []).some((o) => o.plate === k.plate && o.well === k.well),
  );
  const names = new Map<string, string>();
  for (const p of plates)
    for (const w of p.wells)
      if (w.subject && w.label && !names.has(w.subject)) names.set(w.subject, w.label);
  const records = [
    ...new Set([...a.subjects.map((s) => s.record), ...(a.controls ?? []).map((c) => c.record)]),
  ];
  const save = useMutation({
    mutationFn: (clear: boolean) =>
      api.run(platemapsOverride, {
        id: record.id,
        expectedVersion: record.version,
        ...(clear
          ? { clear: edited }
          : {
              overrides: keys.map((k) => ({
                ...k,
                role,
                ...(subject ? { subject } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              })),
            }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['record', record.id] });
      onClear();
      setNote('');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(false);
  };
  return (
    <form className="edit-bar" aria-label="Change wells" onSubmit={submit}>
      <p className="edit-hint">
        {keys.length === 0
          ? 'Select wells, or a row or column label, to change them.'
          : `${keys.length} well${keys.length === 1 ? '' : 's'} selected.`}
      </p>
      {keys.length > 0 && (
        <div className="edit-fields">
          <label>
            Make them
            <select
              className="field"
              value={role}
              onChange={(e) => setRole(e.target.value as WellRole)}
            >
              {EDIT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleText(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Holding
            <select className="field" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Nothing named</option>
              {records.map((id) => (
                <option key={id} value={id}>
                  {names.get(id) ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Why
            <input
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. spare wells for a repeat"
            />
          </label>
        </div>
      )}
      {save.error && <p className="error-text">{save.error.message}</p>}
      <div className="actions">
        {keys.length > 0 && (
          <button type="submit" className="btn primary" disabled={save.isPending}>
            Change {keys.length} well{keys.length === 1 ? '' : 's'}
          </button>
        )}
        {edited.length > 0 && (
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => save.mutate(true)}
          >
            Undo {edited.length} hand edit{edited.length === 1 ? '' : 's'}
          </button>
        )}
        {keys.length > 0 && (
          <button type="button" className="btn" onClick={onClear}>
            Clear selection
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
      </div>
    </form>
  );
}

/** Saves the map's pattern, with its hand edits, as a new layout draft (P3). */
function SaveAsLayout({ record }: { record: RecordEnvelope }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(`${record.label} layout`);
  const save = useMutation({
    mutationFn: () => api.run(layoutsSaveFromMap, { map: record.id, label: label.trim() }),
    onSuccess: (layout) => navigate({ to: '/records/$id', params: { id: layout.id } }),
  });
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Save as layout
      </button>
    );
  return (
    <form
      className="edit-fields"
      aria-label="Save as layout"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Layout name
        <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="submit" className="btn primary" disabled={save.isPending || !label.trim()}>
        Save
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {save.error && <p className="error-text">{save.error.message}</p>}
    </form>
  );
}

import {
  type CapabilityProvider,
  type Configuration,
  type EquipmentKindAttributes,
  type EquipmentNode,
  type InstrumentAttributes,
  type InstrumentKindAttributes,
  instrumentsResolve,
  type RecordEnvelope,
  type WorkcellAttributes,
  workcellsOfInstrument,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import {
  capabilityLabel,
  type DeckView,
  deckView,
  limitWords,
  statusLamp,
  statusWords,
} from '../lib/instruments.ts';
import { recordQuery, recordsQuery } from '../queries.ts';
import { Head, page } from './AreaHead.tsx';
import { RecordList } from './Records.tsx';
import { LinkedName } from './Value.tsx';

const words = (id: string) => id.replaceAll('_', ' ');
const capabilityList = (providers: CapabilityProvider[] | undefined) =>
  providers && providers.length > 0
    ? [...new Set(providers.map((p) => capabilityLabel(p.capability).toLowerCase()))].join(', ')
    : '—';

/** Labels of records by ID, for list columns. */
export function useLabels(kind: string) {
  const records = useQuery(recordsQuery({ kind })).data ?? [];
  return new Map(records.map((r) => [r.id, r.label]));
}

/** The lab's registered instruments (plan 008c): status lamp, model, room, calibration due. */
export function InstrumentsPage() {
  const models = useLabels('instrument_kind');
  const of = (r: RecordEnvelope) => r.attributes as Partial<InstrumentAttributes>;
  return (
    <>
      <Head
        page={page('instrument')}
        lede="The lab's instruments: what each one is, where it stands, what is installed on it and whether it is ready."
      />
      <RecordList
        title="Instruments"
        kind="instrument"
        placeholder="Find by name, e.g. Flex 1 or INS-0001"
        empty="No instruments yet. Ask the assistant to register one, or load the seed lab."
        columns={[
          {
            header: 'Short name',
            secondary: true,
            cell: (r) => of(r).shortName ?? '—',
            className: 'mono',
          },
          {
            header: 'Availability',
            filled: (r) => !!of(r).status,
            cell: (r) => {
              const status = of(r).status;
              return status ? (
                <span className="nowrap">
                  <span className={`lamp ${statusLamp(status)}`} />
                  {statusWords[status]}
                </span>
              ) : (
                '—'
              );
            },
          },
          { header: 'Model', cell: (r) => models.get(of(r).kind ?? '') ?? '…' },
          { header: 'Room', cell: (r) => of(r).room ?? '—', className: 'muted', secondary: true },
          {
            header: 'Calibration due',
            cell: (r) => of(r).calibrationDue ?? '—',
            filled: (r) => !!of(r).calibrationDue,
            className: 'num',
          },
        ]}
      />
    </>
  );
}

/** Instrument models (plan 008): what each model can do and what can be mounted on it. */
export function InstrumentModelsPage() {
  const vendors = useLabels('vendor');
  const of = (r: RecordEnvelope) => r.attributes as Partial<InstrumentKindAttributes>;
  return (
    <>
      <Head
        page={page('instrument_kind')}
        lede="The models the lab's instruments are, and manual stations worked by a person. Each says what it can do by itself and where equipment is mounted."
      />
      <RecordList
        title="Instrument models"
        kind="instrument_kind"
        placeholder="Find by name, e.g. STAR or INK-0001"
        empty="No instrument models yet. Load the seed lab, or ask the assistant to add one from a datasheet."
        columns={[
          { header: 'Type', cell: (r) => (of(r).category ? words(of(r).category as string) : '—') },
          {
            header: 'Manufacturer',
            cell: (r) =>
              vendors.get(of(r).manufacturer ?? '') ??
              (of(r).performedBy === 'person' ? 'worked by a person' : '—'),
          },
          {
            header: 'Can do by itself',
            cell: (r) => capabilityList(of(r).capabilities),
            className: 'muted',
          },
        ]}
      />
    </>
  );
}

/** Equipment kinds (plan 008): pipettes, heads, grippers, modules, carriers, adapters. */
export function EquipmentPage() {
  const vendors = useLabels('vendor');
  const of = (r: RecordEnvelope) => r.attributes as Partial<EquipmentKindAttributes>;
  return (
    <>
      <Head
        page={page('equipment_kind')}
        lede="Parts that are mounted on instruments: pipettes, heads, grippers, modules, carriers and adapters. What an instrument can do comes from what is mounted on it."
      />
      <RecordList
        title="Equipment"
        kind="equipment_kind"
        placeholder="Find by name, e.g. heater-shaker or EQK-0001"
        empty="No equipment yet. Load the seed lab, or ask the assistant to add some."
        columns={[
          { header: 'Type', cell: (r) => (of(r).role ? words(of(r).role as string) : '—') },
          { header: 'Manufacturer', cell: (r) => vendors.get(of(r).manufacturer ?? '') ?? '—' },
          { header: 'Adds', cell: (r) => capabilityList(of(r).capabilities), className: 'muted' },
        ]}
      />
    </>
  );
}

/** Workcells (plan 008d): instruments that work together, each mapped to the digital twin. */
export function WorkcellsPage() {
  const of = (r: RecordEnvelope) => r.attributes as Partial<WorkcellAttributes>;
  return (
    <>
      <Head
        page={page('workcell')}
        lede="Instruments that work together, such as the FlexPod and what stands around it. Where things stand and how plates move is in the digital twin."
      />
      <RecordList
        title="Workcells"
        kind="workcell"
        placeholder="Find by name, e.g. FlexPod or WCL-0001"
        empty="No workcells yet. Ask the assistant to draft one from the lab's instruments, or load the seed lab."
        columns={[
          {
            header: 'Instruments',
            cell: (r) => of(r).members?.length ?? 0,
            className: 'num',
          },
          {
            header: 'Also used by hand',
            cell: (r) => of(r).members?.filter((m) => m.byHand).length ?? 0,
            className: 'num',
          },
        ]}
      />
    </>
  );
}

/** Beside a workcell: its instruments in plain words, what each can do and whether it is free. */
export function WorkcellBlocks({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as Partial<WorkcellAttributes>;
  const instruments = new Map(
    (useQuery(recordsQuery({ kind: 'instrument' })).data ?? []).map((r) => [r.id, r]),
  );
  const models = new Map(
    (useQuery(recordsQuery({ kind: 'instrument_kind' })).data ?? []).map((r) => [r.id, r]),
  );
  const members = a.members ?? [];
  return (
    <section className="block" aria-label="Instruments in this workcell">
      <header>
        <h2>Instruments</h2>
        <span className="state muted">
          {members.length} in the workcell · {members.filter((m) => m.byHand).length} also by hand
        </span>
      </header>
      <div className="body">
        <div className="table-wrap">
          <table>
            <tbody>
              {members.map((m) => {
                const instrument = instruments.get(m.instrument);
                const ia = instrument?.attributes as Partial<InstrumentAttributes> | undefined;
                const model = models.get(ia?.kind ?? '');
                const status = ia?.status;
                return (
                  <tr key={m.instrument}>
                    <td>
                      <Link to="/records/$id" params={{ id: m.instrument }}>
                        {instrument?.label ?? m.instrument}
                      </Link>
                    </td>
                    <td className="muted">
                      {capabilityList(
                        (model?.attributes as Partial<InstrumentKindAttributes> | undefined)
                          ?.capabilities,
                      )}
                    </td>
                    <td className="nowrap">
                      {status ? (
                        <>
                          <span className={`lamp ${statusLamp(status)}`} />
                          {statusWords[status]}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="muted">{m.byHand ? 'also by hand' : 'workcell only'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Positions, the robot's reach and move times come from the digital twin. The 3D view
          arrives with the twin connection.
        </p>
        <details className="tech">
          <summary>technical details</summary>
          <p className="mono">twin workcell: {a.twin ?? 'not named'}</p>
          <ul className="mono">
            {members.map((m) => (
              <li key={m.instrument}>
                {instruments.get(m.instrument)?.name ?? m.instrument} →{' '}
                {m.twinDevice ?? 'no twin device'}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

/** The workcell an instrument is in, or that it stands alone. */
function WorkcellLine({ instrument }: { instrument: string }) {
  const where = useQuery({
    queryKey: ['record', instrument, 'workcell'],
    queryFn: () => api.run(workcellsOfInstrument, { instrument }),
  }).data;
  if (!where) return null;
  return (
    <p className="muted">
      {where.active ? (
        <>
          In{' '}
          <Link to="/records/$id" params={{ id: where.active.id }}>
            {where.active.label}
          </Link>
          {where.active.member.byHand
            ? ', and can be used by hand when the workcell is not using it.'
            : ', used by the workcell only.'}
        </>
      ) : (
        'Stands alone: not in a confirmed workcell.'
      )}
    </p>
  );
}

/**
 * Beside a registered instrument: its deck from above with what is mounted where, and what it can
 * do now with its limits, both from resolving its current configuration.
 */
export function InstrumentBlocks({ record }: { record: RecordEnvelope }) {
  const attributes = record.attributes as Partial<InstrumentAttributes>;
  const model = useQuery({
    ...recordQuery(attributes.kind ?? ''),
    enabled: !!attributes.kind,
  }).data;
  const equipment = useLabels('equipment_kind');
  const resolved = useQuery({
    queryKey: ['record', record.id, 'resolved', record.version],
    queryFn: () => api.run(instrumentsResolve, { instrument: record.id }),
    retry: false,
  });
  if (resolved.error) {
    return (
      <section className="block" aria-label="Deck">
        <header>
          <h2>Deck</h2>
        </header>
        <div className="body">
          <p className="muted">Can't work out the configuration: {resolved.error.message}</p>
        </div>
      </section>
    );
  }
  const result = resolved.data;
  const byPart =
    new Set(result?.capabilities.map((c) => (c.performedBy === 'person' ? 'person' : c.node)))
      .size > 1;
  if (!result || !model) return null;
  const nodes = new Map((attributes.configuration?.equipment ?? []).map((n) => [n.id, n]));
  const nodeLabel = (id: string) => {
    if (id === 'instrument') return record.label;
    const node = nodes.get(id);
    return node?.label ?? equipment.get(node?.kind ?? '') ?? id;
  };
  const mounts = (model.attributes as Partial<InstrumentKindAttributes>).mounts ?? [];
  const views = mounts.map((m) => deckView(m, result.claims));
  const errors = result.issues.filter((i) => i.severity === 'error');
  return (
    <>
      {/* An instrument with no mounts (a sealer, a peeler) has no deck to draw. */}
      {(views.length > 0 || errors.length > 0) && (
        <section className="block" aria-label="Deck">
          <header>
            <h2>Deck</h2>
            <span className="state muted">{model.label} · from above, not to scale</span>
          </header>
          <div className="body">
            {errors.length > 0 && (
              <ul className="error-text">
                {errors.map((e) => (
                  <li key={`${e.rule}-${e.node}`}>{e.message}</li>
                ))}
              </ul>
            )}
            <div className="decks">
              {views.map((view) => (
                <MountDrawing key={view.mount} view={view} label={nodeLabel} />
              ))}
            </div>
          </div>
        </section>
      )}
      <section className="block" aria-label="What it can do">
        <header>
          <h2>What it can do</h2>
          <span className="state muted">with what is installed now</span>
        </header>
        <div className="body">
          {result.capabilities.length === 0 ? (
            <p className="muted">Nothing yet: install equipment that brings capabilities.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {result.capabilities.map((c) => (
                    <tr key={`${c.node}-${c.capability}`}>
                      <td>{capabilityLabel(c.capability)}</td>
                      <td className="muted">{limitWords(c.limits) || '—'}</td>
                      {/* Which part does it, only when more than one part does something. */}
                      {byPart && (
                        <td className="muted">
                          {c.performedBy === 'person' ? 'by a person' : nodeLabel(c.node)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.sites.length > 0 && (
            <p className="muted">
              {result.sites.length === 1
                ? '1 place for labware.'
                : `${result.sites.length} places for labware.`}{' '}
              <Link to="/instrument-models">Instrument models</Link> say what each one offers.
            </p>
          )}
          <WorkcellLine instrument={record.id} />
        </div>
      </section>
    </>
  );
}

const CELL = { w: 150, h: 44, gap: 6, rail: 14 };

/** One mount from above: slots as a grid, a rail as its tracks, what is on each named. */
function MountDrawing({ view, label }: { view: DeckView; label: (node: string) => string }) {
  const rail = view.columns > 16;
  const cw = rail ? CELL.rail : CELL.w;
  const gap = rail ? 0 : CELL.gap;
  const width = view.columns * cw + (view.columns - 1) * gap;
  const height = view.rows * CELL.h + (view.rows - 1) * gap;
  return (
    <figure className="drawing deck-view">
      <svg
        viewBox={`-1 -1 ${width + 2} ${height + 2}`}
        style={{ width: width + 2 }}
        role="img"
        aria-label={view.label}
      >
        {view.cells.map((cell) => {
          const x = cell.column * (cw + gap);
          const y = cell.row * (CELL.h + gap);
          const w = cell.span * cw + (cell.span - 1) * gap;
          const name = cell.node ? label(cell.node) : undefined;
          return (
            <g key={`${cell.place}-${cell.column}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={CELL.h}
                rx={3}
                className={cell.node ? 'occupied' : 'free'}
              />
              <text x={x + 5} y={y + 14} className="place">
                {cell.place}
              </text>
              {name && (
                <text x={x + 5} y={y + 32} className="what">
                  {name.length * 6 > w - 8
                    ? `${name.slice(0, Math.max(3, Math.floor((w - 8) / 6) - 1))}…`
                    : name}
                  <title>{name}</title>
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>{view.label}</figcaption>
    </figure>
  );
}

/**
 * What is installed on an instrument, for its configuration section: each piece by its kind's name,
 * where it sits, and what is attached to it, indented under it.
 */
export function InstalledEquipment({
  configuration,
}: {
  configuration: Configuration | undefined;
}) {
  const nodes = configuration?.equipment ?? [];
  if (nodes.length === 0) return <span className="muted">nothing installed</span>;
  const where = (n: EquipmentNode) =>
    n.placement.on === 'slot'
      ? `in slot ${n.placement.slot}`
      : n.placement.on === 'rail'
        ? `on the deck from track ${n.placement.track}`
        : `at ${n.mount.replaceAll('-', ' ')}`;
  const branch = (parent: string | undefined): ReactNode => {
    const children = nodes.filter((n) => n.parent === parent);
    if (children.length === 0) return null;
    return (
      <ul className="equipment-tree">
        {children.map((n) => (
          <li key={n.id}>
            <LinkedName id={n.kind} />
            {n.label && <span> “{n.label}”</span>}
            <span className="muted"> {where(n)}</span>
            {n.item && (
              <span>
                {' '}
                · <LinkedName id={n.item} />
              </span>
            )}
            {branch(n.id)}
          </li>
        ))}
      </ul>
    );
  };
  return branch(undefined);
}

import {
  type Connection,
  type PlateMapAttributes,
  platemapsWells,
  type RecordEnvelope,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { formatShortDay, isAgent } from '../lib/format.ts';
import { recordQuery, recordsQuery } from '../queries.ts';
import { ExperimentTransfers } from './DesignBlocks.tsx';
import { MemoryAppliedTab, MemoryEvidenceTab } from './LabNotes.tsx';
import { PlateView } from './PlateMaps.tsx';

/**
 * Tabs a kind adds to its record page (plan 004f N4), between Overview and History: more about
 * one record than its Overview holds. A module adds its kind's tabs here.
 */
export interface KindTab {
  id: string;
  label: string;
  /** The number beside the label, from the links into the record when they tell it. */
  count?: (record: RecordEnvelope, usedIn: readonly Connection[]) => number | undefined;
  render: (record: RecordEnvelope) => ReactNode;
}

const mapsVia = (relation: string) => (_: RecordEnvelope, usedIn: readonly Connection[]) =>
  usedIn.filter((c) => c.other.kind === 'plate_map' && c.relation === relation).length;

export const kindTabs: Partial<Record<string, KindTab[]>> = {
  // A plate map lives in its experiment and on its layout (N5).
  experiment: [
    {
      id: 'plates',
      label: 'Plates',
      count: mapsVia('part_of'),
      render: (r) => <ExperimentPlates record={r} />,
    },
    {
      id: 'transfers',
      label: 'Transfers',
      count: (_, usedIn) =>
        usedIn.filter((c) => c.other.kind === 'transfer_plan' && c.relation === 'part_of').length,
      render: (r) => <ExperimentTransfers record={r} />,
    },
  ],
  // A memory's evidence and where it filled values (plan 005, M11, M17).
  memory: [
    { id: 'evidence', label: 'Evidence', render: (r) => <MemoryEvidenceTab record={r} /> },
    { id: 'applied', label: 'Applied in', render: (r) => <MemoryAppliedTab record={r} /> },
  ],
  layout: [
    {
      id: 'plates',
      label: 'Plates made from it',
      count: mapsVia('follows'),
      render: (r) => <LayoutPlates record={r} />,
    },
  ],
};

const mapOf = (r: RecordEnvelope) => r.attributes as PlateMapAttributes;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** A draft an agent made reads in agent ink until a person confirms it. */
const ink = (r: RecordEnvelope) =>
  r.status === 'draft' && isAgent(r.updatedBy) ? 'agent-ink' : undefined;

function usePlateMaps(match: (map: PlateMapAttributes) => boolean) {
  const maps = useQuery(recordsQuery({ kind: 'plate_map' }));
  return { ...maps, data: (maps.data ?? []).filter((m) => match(mapOf(m))) };
}

/** An experiment's plate maps, each with its plates, so the design reads on its own page. */
function ExperimentPlates({ record }: { record: RecordEnvelope }) {
  const maps = usePlateMaps((m) => m.experiment === record.id);
  if (maps.isPending) return <p className="empty">Loading…</p>;
  if (maps.data.length === 0)
    return (
      <section className="block" aria-label="Plates">
        <header>
          <h2>Plates</h2>
        </header>
        <div className="body">
          <p className="empty">
            No plate maps for this experiment yet. Ask the assistant to place its samples with one
            of the lab's layouts.
          </p>
        </div>
      </section>
    );
  return (
    <>
      {maps.data.map((m) => (
        <MapPlates key={m.id} map={m} />
      ))}
    </>
  );
}

function MapPlates({ map }: { map: RecordEnvelope }) {
  const a = mapOf(map);
  const layout = useQuery(recordQuery(a.layout.id)).data;
  const wells = useQuery({
    queryKey: ['record', map.id, 'wells', map.version],
    queryFn: () => api.run(platemapsWells, { id: map.id }),
    retry: false,
  });
  const plates = wells.data?.plates ?? [];
  return (
    <section className="block" aria-label={map.label}>
      <header>
        {/* A record's name, not a section label: it keeps its own case (review 2026-10-02). */}
        <h2 className="named">
          <Link to="/records/$id" params={{ id: map.id }} className={ink(map)}>
            {map.label}
          </Link>{' '}
          <span className="code">{map.name}</span>
        </h2>
        <span className="state muted num">
          {wells.data &&
            `${plural(a.subjects.length, 'thing')} placed on ${plural(plates.length, 'plate')}`}
          {map.status === 'draft' && ' · draft'}
        </span>
      </header>
      <div className="body">
        <p className="muted">
          Follows{' '}
          <Link to="/records/$id" params={{ id: a.layout.id }}>
            {layout?.label ?? 'its layout'}
          </Link>
          .
        </p>
        {wells.error && <p className="error-text">{wells.error.message}</p>}
        {wells.data && <PlateView plates={plates} title={map.label} />}
      </div>
    </section>
  );
}

/** The plate maps made from a layout: what each is for and what it places. */
function LayoutPlates({ record }: { record: RecordEnvelope }) {
  const maps = usePlateMaps((m) => m.layout.id === record.id);
  const experiments = useQuery(recordsQuery({ kind: 'experiment' })).data ?? [];
  const names = new Map(experiments.map((e) => [e.id, e] as const));
  return (
    <section className="block" aria-label="Plates made from it">
      <header>
        <h2>Plates made from it</h2>
        <span className="state muted num">{maps.data.length}</span>
      </header>
      <div className="body">
        {maps.isPending ? (
          <p className="empty">Loading…</p>
        ) : maps.data.length === 0 ? (
          <p className="empty">No plate maps follow this layout yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plate map</th>
                  <th>For</th>
                  <th>Places</th>
                  <th>Layout version</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {maps.data.map((m) => {
                  const a = mapOf(m);
                  const experiment = a.experiment ? names.get(a.experiment) : undefined;
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link to="/records/$id" params={{ id: m.id }} className={ink(m)}>
                          {m.label}
                        </Link>{' '}
                        <span className="code">{m.name}</span>
                        {m.status === 'draft' && <span className="muted"> · draft</span>}
                      </td>
                      <td>
                        {a.experiment ? (
                          <Link to="/records/$id" params={{ id: a.experiment }}>
                            {experiment?.label ?? 'its experiment'}
                          </Link>
                        ) : (
                          (a.purpose ?? <span className="muted">—</span>)
                        )}
                      </td>
                      <td className="num">{a.subjects.length}</td>
                      <td className="num">{a.layout.version}</td>
                      <td className="when">{formatShortDay(m.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

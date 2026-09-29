import type { LabwareFamily, LabwareTypeAttributes, RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatValue } from '../lib/format.ts';
import type { KindPage } from '../lib/kinds.ts';
import { libraryPages } from '../lib/kinds.ts';
import { recordsQuery } from '../queries.ts';
import { RecordList } from './Records.tsx';

const page = (kind: string) => libraryPages.find((p) => p.kind === kind) as KindPage;

function Head({ page, lede }: { page: KindPage; lede: string }) {
  return (
    <div className="page-head">
      <div>
        <div className="crumbs">
          lab / library / <b>{page.title.toLowerCase()}</b>
        </div>
        <h1>{page.title}</h1>
        <p className="lede">{lede}</p>
      </div>
    </div>
  );
}

const familyWords: Record<LabwareFamily, string> = {
  plate: 'plate',
  reservoir: 'reservoir',
  tube: 'tube',
  rack: 'rack',
  tip_rack: 'tip rack',
  lid: 'lid',
};
const families: [LabwareFamily | 'all', string][] = [
  ['all', 'All'],
  ['plate', 'Plates'],
  ['reservoir', 'Reservoirs'],
  ['tube', 'Tubes'],
  ['rack', 'Racks'],
  ['tip_rack', 'Tip racks'],
  ['lid', 'Lids'],
];

const labwareOf = (r: RecordEnvelope) => r.attributes as Partial<LabwareTypeAttributes>;

/** "plate · 96 wells", "tip rack · 96 tips", "tube". */
export function labwareFormat(a: Partial<LabwareTypeAttributes>): string {
  const family = a.family ? familyWords[a.family] : 'unknown';
  const wells = a.wells;
  const count = !wells
    ? undefined
    : wells.layout === 'grid'
      ? wells.rows * wells.columns
      : wells.wells.length;
  if (count === undefined || a.family === 'tube' || a.family === 'lid') return family;
  const unit = a.family === 'tip_rack' ? 'tips' : a.family === 'rack' ? 'positions' : 'wells';
  return `${family} · ${count} ${count === 1 ? unit.replace(/s$/, '') : unit}`;
}

/** The labware library (plan 007b): every plate, reservoir, tube, rack, tip rack and lid type. */
export function LabwarePage() {
  const [family, setFamily] = useState<LabwareFamily | 'all'>('all');
  const vendors = useQuery(recordsQuery({ kind: 'vendor' })).data ?? [];
  const vendorName = new Map(vendors.map((v) => [v.id, v.label]));
  return (
    <>
      <Head
        page={page('labware_type')}
        lede="The kinds of plates, reservoirs, tubes, racks and tip racks the lab uses, with their geometry and volumes. Physical plates and what is in them come with inventory."
      />
      <RecordList
        title="Labware types"
        kind="labware_type"
        placeholder="Find by name, e.g. Corning 3590 or LWT-0001"
        empty="No labware yet. Ask the assistant to add one, or load the seed lab."
        narrow={family === 'all' ? undefined : (r) => labwareOf(r).family === family}
        toolbar={
          <fieldset className="segmented">
            <legend className="sr-only">Family</legend>
            {families.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={family === value}
                onClick={() => setFamily(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        }
        columns={[
          { header: 'Type', cell: (r) => labwareFormat(labwareOf(r)) },
          {
            header: 'Manufacturer',
            cell: (r) => {
              const id = labwareOf(r).manufacturer;
              return id ? (vendorName.get(id) ?? '…') : '—';
            },
          },
          {
            header: 'Catalog no.',
            cell: (r) => labwareOf(r).catalogNumber ?? '—',
            className: 'mono',
          },
          {
            header: 'Max volume',
            cell: (r) => formatValue(labwareOf(r).maxVolume),
            className: 'num',
          },
        ]}
      />
    </>
  );
}

/** Manufacturers and suppliers, shared by labware, instruments and reagents. */
export function VendorsPage() {
  return (
    <>
      <Head
        page={page('vendor')}
        lede="Manufacturers and suppliers. Labware, instruments and reagents point to them."
      />
      <RecordList
        title="Vendors"
        kind="vendor"
        placeholder="Find by name, e.g. Corning"
        empty="No vendors yet. They are added with the labware that names them."
        columns={[
          {
            header: 'Website',
            cell: (r) => (r.attributes as { website?: string }).website ?? '—',
            className: 'muted',
          },
        ]}
      />
    </>
  );
}

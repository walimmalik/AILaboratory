import type { LabwareTypeAttributes, VendorAttributes } from '@ailab/schema';
import {
  amount,
  capital,
  count,
  facts,
  type OverviewBuilder,
  parts,
  words,
} from '../records/overview.ts';

/** What a labware type is in two or three words: "384-well plate", "tube, 1.5 mL", "tip rack". */
export function labwareNoun(a: LabwareTypeAttributes): string {
  const grid = a.wells?.layout === 'grid' ? a.wells.rows * a.wells.columns : undefined;
  if ((a.family === 'plate' || a.family === 'reservoir') && grid && grid > 1) {
    return `${grid}-well ${a.family}`;
  }
  if (a.family === 'rack' && grid) return `rack for ${grid} tubes`;
  if (a.family === 'tip_rack' && grid) return `rack of ${grid} tips`;
  return a.maxVolume ? `${words(a.family)}, ${amount(a.maxVolume)}` : words(a.family);
}

const labwareType: OverviewBuilder = async (record, read) => {
  const a = record.attributes as LabwareTypeAttributes;
  const [maker, held] = await Promise.all([
    read.get(a.manufacturer),
    read.linking(record.id, 'is_a').then((list) => list.filter((r) => r.kind === 'container')),
  ]);
  const working = a.workingVolume;
  return {
    identity: parts(
      capital(labwareNoun(a)),
      maker && {
        text: a.catalogNumber ? `${maker.label} ${a.catalogNumber}` : maker.label,
        record: maker.id,
      },
      a.sterile === true && 'sterile',
    ),
    facts: facts(
      {
        label: 'in the lab',
        value:
          held.length === 0
            ? 'none registered'
            : count(held.length, a.family === 'tube' ? 'tube' : 'container'),
      },
      a.maxVolume && {
        label: a.family === 'tip_rack' ? 'tip holds' : 'well holds',
        value: amount(a.maxVolume),
        ...(working?.min || working?.max
          ? {
              detail: `working ${[working.min, working.max].flatMap((v) => (v ? [amount(v)] : [])).join(' to ')}`,
            }
          : {}),
        field: 'maxVolume',
      },
      a.deadVolume && { label: 'dead volume', value: amount(a.deadVolume), field: 'deadVolume' },
      (a.material || a.color) && {
        label: 'material',
        value: [a.color, a.material].filter(Boolean).join(' '),
        field: 'material',
      },
      a.surface && { label: 'surface', value: a.surface, field: 'surface' },
      a.pack && a.pack !== 'see vendor' && { label: 'sold as', value: a.pack, field: 'pack' },
    ),
  };
};

/** What the lab has from a vendor: products it sells, labware and instruments it makes. */
const vendor: OverviewBuilder = async (record, read) => {
  const a = record.attributes as VendorAttributes;
  const [sold, made] = await Promise.all([
    read.linking(record.id, 'sold_by'),
    read.linking(record.id, 'made_by'),
  ]);
  const labware = made.filter((r) => r.kind === 'labware_type').length;
  const instruments = made.filter((r) => r.kind !== 'labware_type').length;
  const host = a.website ? new URL(a.website).host.replace(/^www\./, '') : undefined;
  const nothing = sold.length + made.length === 0;
  return {
    identity: parts('Vendor', host),
    facts: facts(
      sold.length > 0 && { label: 'reagents', value: count(sold.length, 'product') },
      labware > 0 && { label: 'labware', value: count(labware, 'type') },
      instruments > 0 && { label: 'instruments and equipment', value: count(instruments, 'model') },
      nothing && { label: 'in the library', value: 'nothing linked to it yet' },
      a.website && { label: 'website', value: host ?? a.website, field: 'website' },
    ),
  };
};

export const labwareOverviews: Record<string, OverviewBuilder> = {
  labware_type: labwareType,
  vendor,
};

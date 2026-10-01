import type { VendorAttributes } from '@ailab/schema';
import { count, facts, type OverviewBuilder, parts } from '../records/overview.ts';

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

export const labwareOverviews: Record<string, OverviewBuilder> = { vendor };

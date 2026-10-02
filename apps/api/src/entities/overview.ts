import { readableVolume } from '@ailab/domain';
import {
  type EntityAttributes,
  type EntityKindAttributes,
  type InventoryOverview,
  inventoryOverview,
  inventoryWhereIs,
  type OverviewFact,
  type Quantity,
} from '@ailab/schema';
import { whereFact } from '../inventory/overview.ts';
import {
  amount,
  capital,
  count,
  facts,
  type OverviewBuilder,
  parts,
  words,
} from '../records/overview.ts';

const entity: OverviewBuilder = async (record, read) => {
  const a = record.attributes as EntityAttributes;
  const [kind, samples, stock] = await Promise.all([
    read.get(a.entityKind),
    read.linking(record.id, 'is_a').then((list) => list.filter((r) => r.kind === 'sample')),
    // The Stock list's own row, so the record and Inventory say the same (with a named product's lots).
    read
      .run(inventoryOverview, { text: record.name })
      .then((o) => o.rows.find((r) => r.thing.id === record.id)),
  ]);
  const fields = (kind?.attributes as EntityKindAttributes | undefined)?.fields ?? [];
  const vendor = typeof a.fields.vendor === 'string' ? await read.get(a.fields.vendor) : undefined;
  const catalog = typeof a.fields.catalogNumber === 'string' ? a.fields.catalogNumber : undefined;

  // Where its samples are, across every container holding any of them.
  const held = (
    await Promise.all(samples.slice(0, 20).map((s) => read.run(inventoryWhereIs, { of: s.id })))
  ).flatMap((w) => w.containers);

  const shown: OverviewFact[] = [];
  for (const field of fields) {
    if (shown.length >= 4) break;
    const value = a.fields[field.key];
    if (value === undefined || field.key === 'vendor' || field.key === 'catalogNumber') continue;
    let text: string;
    let linked: string | undefined;
    if (typeof value === 'boolean') text = value ? 'yes' : 'no';
    else if (typeof value === 'object') text = amount(value as Quantity);
    else if (field.type.type === 'link') {
      const other = await read.get(value);
      text = other?.label ?? value;
      linked = other?.id;
    } else text = field.type.type === 'choice' ? words(value) : value;
    shown.push({
      label: field.label.toLowerCase(),
      value: text,
      field: 'fields',
      ...(linked ? { record: linked } : {}),
    });
  }

  return {
    identity: parts(
      kind ? { text: capital(kind.label), record: kind.id } : 'Entity',
      a.synonyms?.length && `also ${a.synonyms.slice(0, 2).join(', ')}`,
      vendor && { text: catalog ? `${vendor.label} ${catalog}` : vendor.label, record: vendor.id },
    ),
    facts: facts(inStock(stock), samples.length > 0 && whereFact(held), ...shown),
  };
};

type StockRow = InventoryOverview['rows'][number];

/** "1 lot · 2 containers", with what is left: the words of the Stock list's "Have" and "Left". */
function inStock(row: StockRow | undefined): OverviewFact {
  if (!row || row.batches.length === 0) return { label: 'in stock', value: 'none recorded' };
  const lots = row.batches.filter((b) => b.batch.kind === 'lot').length;
  const samples = row.batches.length - lots;
  const containers = new Set(row.batches.flatMap((b) => b.containers.map((c) => c.container.id)));
  return {
    label: 'in stock',
    value: [
      lots && count(lots, 'lot'),
      samples && count(samples, 'sample'),
      containers.size > 0 && count(containers.size, 'container'),
    ]
      .filter(Boolean)
      .join(' · '),
    ...(row.amount ? { detail: `${amount(readableVolume(row.amount))} left` } : {}),
  };
}

export const entityOverviews: Record<string, OverviewBuilder> = { entity };

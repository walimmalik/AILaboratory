import {
  inventoryWhereIs,
  type LotAttributes,
  type OverviewFact,
  type ProductAttributes,
} from '@ailab/schema';
import { storageWords, whereFact } from '../inventory/overview.ts';
import {
  amount,
  capital,
  count,
  day,
  daysUntil,
  expiryFact,
  facts,
  type OverviewBuilder,
  parts,
  words,
} from '../records/overview.ts';

const IN_DATE = new Set(['unopened', 'opened']);

const product: OverviewBuilder = async (record, read) => {
  const a = record.attributes as ProductAttributes;
  const [vendor, lots, where] = await Promise.all([
    read.get(a.vendor),
    read.linking(record.id, 'lot_of'),
    read.run(inventoryWhereIs, { of: record.id }),
  ]);
  const catalog = a.catalog?.[0]?.number;
  const inDate = lots
    .map((l) => l.attributes as LotAttributes)
    .filter((l) => IN_DATE.has(l.status) && !(l.expiry && daysUntil(l.expiry) < 0));
  const next = inDate
    .flatMap((l) => (l.expiry ? [l.expiry] : []))
    .sort()
    .at(0);
  const stock: OverviewFact =
    lots.length === 0
      ? { label: 'in stock', value: 'no lots recorded' }
      : {
          label: 'in stock',
          value:
            inDate.length === 0
              ? 'no lot in date'
              : count(inDate.length, 'lot in date', 'lots in date'),
          ...(next ? { detail: `next expiry ${day(next)}` } : {}),
          ...(inDate.length === 0 ? { tone: 'warn' as const } : {}),
        };
  return {
    identity: parts(
      capital(words(a.category)),
      vendor && { text: catalog ? `${vendor.label} ${catalog}` : vendor.label, record: vendor.id },
      a.form && a.form !== 'kit' && words(a.form),
      a.origin === 'made' && 'made in the lab',
    ),
    facts: facts(
      stock,
      lots.length > 0 && whereFact(where.containers),
      a.storage && { label: 'store', value: storageWords(a.storage), field: 'storage' },
      a.components?.length && {
        label: 'kit of',
        value: count(a.components.length, 'component'),
        field: 'components',
      },
      a.concentration && { label: 'stock', value: amount(a.concentration), field: 'concentration' },
      a.composition && { label: 'composition', value: a.composition, field: 'composition' },
    ),
  };
};

const lot: OverviewBuilder = async (record, read) => {
  const a = record.attributes as LotAttributes;
  const [made, where] = await Promise.all([
    read.get(a.product),
    read.run(inventoryWhereIs, { of: record.id }),
  ]);
  const p = made?.attributes as ProductAttributes | undefined;
  // Wells beyond a tube's one: the lot was dispensed into plates, so it was opened even when
  // nobody recorded it (UX review 2026-10-02, item 8).
  const dispensed = where.containers.some((c) => c.wells.some((w) => w.well !== 'A1'));
  // The lot's state is said once, in the identity line (N8); a fact repeats it only as a warning.
  const status: OverviewFact | undefined =
    a.status === 'quarantined' || a.status === 'expired'
      ? { label: 'status', value: words(a.status), field: 'status', tone: 'crit' }
      : undefined;
  const values = (a.values ?? []).slice(0, 3).map(
    (v): OverviewFact => ({
      label: p?.lotFields?.find((f) => f.key === v.field)?.label.toLowerCase() ?? words(v.field),
      value: 'ratio' in v.value ? v.value.ratio : amount(v.value),
      field: 'values',
    }),
  );
  return {
    identity: parts(
      made ? { text: `Lot of ${made.label}`, record: made.id } : 'Lot',
      a.received && `received ${day(a.received)}`,
      a.made && `made ${day(a.made)}`,
      a.status === 'opened' && a.opened
        ? `opened ${day(a.opened)}`
        : a.status === 'unopened' && dispensed
          ? 'in use, opening not recorded'
          : words(a.status),
    ),
    facts: facts(
      a.expiry
        ? expiryFact(a.expiry)
        : { label: 'expires', value: 'not recorded', field: 'expiry' },
      whereFact(where.containers),
      status,
      { label: 'lot number', value: a.lotNumber, field: 'lotNumber' },
      ...values,
    ),
  };
};

export const reagentOverviews: Record<string, OverviewBuilder> = { product, lot };

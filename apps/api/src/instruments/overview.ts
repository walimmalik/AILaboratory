import type { InstrumentAttributes, InstrumentKindAttributes } from '@ailab/schema';
import {
  capital,
  count,
  day,
  daysUntil,
  facts,
  type OverviewBuilder,
  parts,
  words,
} from '../records/overview.ts';

const instrumentKind: OverviewBuilder = async (record, read) => {
  const a = record.attributes as InstrumentKindAttributes;
  const [maker, units] = await Promise.all([
    read.get(a.manufacturer),
    read.linking(record.id, 'is_a').then((list) => list.filter((r) => r.kind === 'instrument')),
  ]);
  const does = (a.capabilities ?? []).map((c) => words(c.capability));
  return {
    identity: parts(
      capital(words(a.category)),
      maker && {
        // "Opentrons Flex", not "Opentrons Opentrons Flex".
        text: !a.model
          ? maker.label
          : a.model.startsWith(maker.label.split(' ')[0] ?? '')
            ? a.model
            : `${maker.label} ${a.model}`,
        record: maker.id,
      },
      a.performedBy === 'person' && 'worked by hand',
    ),
    facts: facts(
      {
        label: 'in the lab',
        value: units.length === 0 ? 'none registered' : units.map((u) => u.label).join(', '),
      },
      does.length > 0
        ? {
            label: 'does',
            value: does.slice(0, 4).join(', '),
            ...(does.length > 4 ? { detail: `and ${count(does.length - 4, 'more')}` } : {}),
            field: 'capabilities',
          }
        : a.mounts?.length
          ? { label: 'does', value: 'what its installed equipment does', field: 'mounts' }
          : { label: 'does', value: 'nothing listed yet', tone: 'warn', field: 'capabilities' },
      a.sites?.length && {
        label: 'places for labware',
        value: count(a.sites.length, 'site'),
        field: 'sites',
      },
      a.variants?.length && { label: 'sold as', value: a.variants.join(', '), field: 'variants' },
      a.twin && { label: 'digital twin', value: a.twin, field: 'twin' },
    ),
  };
};

const instrument: OverviewBuilder = async (record, read) => {
  const a = record.attributes as InstrumentAttributes;
  const model = await read.get(a.kind);
  const due = a.calibrationDue ? daysUntil(a.calibrationDue) : undefined;
  return {
    identity: parts(
      model ? { text: model.label, record: model.id } : 'Instrument',
      a.variant,
      a.room && `in ${a.room}`,
      words(a.status),
    ),
    facts: facts(
      (a.status === 'out_of_service' || a.status === 'maintenance') && {
        label: 'status',
        value: words(a.status),
        field: 'status',
        tone: a.status === 'out_of_service' ? ('crit' as const) : ('warn' as const),
      },
      a.configuration.equipment.length > 0 && {
        label: 'installed',
        value: count(a.configuration.equipment.length, 'piece of equipment', 'pieces of equipment'),
        field: 'configuration',
      },
      a.calibrationDue && {
        label: 'calibration due',
        value: day(a.calibrationDue),
        field: 'calibrationDue',
        ...(due !== undefined && due < 0
          ? { tone: 'crit' as const, detail: 'overdue' }
          : due !== undefined && due <= 30
            ? { tone: 'warn' as const, detail: `in ${count(due, 'day')}` }
            : {}),
      },
      a.lastService && {
        label: 'last service',
        value: day(a.lastService.date),
        detail: a.lastService.note,
        field: 'lastService',
      },
      a.serial && { label: 'serial', value: a.serial, field: 'serial' },
    ),
  };
};

export const instrumentOverviews: Record<string, OverviewBuilder> = {
  instrument_kind: instrumentKind,
  instrument,
};

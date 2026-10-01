import type { LayoutAttributes, PlateMapAttributes, Series } from '@ailab/schema';
import { amount, count, facts, type OverviewBuilder, parts, words } from '../records/overview.ts';

/** "10 points, 3-fold from 10 µM". */
const seriesWords = (s: Series) => `${s.points} points, ${s.factor}-fold from ${amount(s.top)}`;

/** "neutral controls, blanks and a standard curve" from a layout's fixed regions. */
const fixedWords = (a: LayoutAttributes) =>
  (a.fixed ?? []).map((f) =>
    f.series ? `${f.label ?? words(f.role)} curve` : (f.label ?? words(f.role)),
  );

const layout: OverviewBuilder = async (record, read) => {
  const a = record.attributes as LayoutAttributes;
  const maps = (await read.linking(record.id, 'follows')).filter((r) => r.kind === 'plate_map');
  const fixed = fixedWords(a);
  return {
    identity: parts(
      `${a.wells}-well plate layout`,
      a.assays?.length && `for ${a.assays.join(', ')}`,
    ),
    facts: facts(
      {
        label: 'subjects',
        value: `${words(a.subjectRole)}s, ${a.replicates ?? 1} ${a.replicates === 1 || !a.replicates ? 'well' : 'wells'} each`,
        detail: a.subjectSeries
          ? seriesWords(a.subjectSeries)
          : a.subjectConcentration
            ? `single point, ${amount(a.subjectConcentration)}`
            : undefined,
        field: 'subjectRole',
      },
      fixed.length > 0 && { label: 'on every plate', value: fixed.join(', '), field: 'fixed' },
      a.edge &&
        a.edge !== 'use' && {
          label: 'outer wells',
          value: a.edge === 'empty' ? 'left empty' : 'filled with buffer',
          field: 'edge',
        },
      a.wellVolume && {
        label: 'volume per well',
        value: amount(a.wellVolume),
        field: 'wellVolume',
      },
      {
        label: 'plates made from it',
        value: maps.length === 0 ? 'none yet' : count(maps.length, 'plate map'),
      },
    ),
  };
};

const plateMap: OverviewBuilder = async (record, read) => {
  const a = record.attributes as PlateMapAttributes;
  const [from, experiment, labware] = await Promise.all([
    read.get(a.layout.id),
    read.get(a.experiment),
    read.get(a.labware?.id),
  ]);
  return {
    identity: parts(
      from ? { text: `${from.label} filled in`, record: from.id } : 'Plate map',
      experiment ? { text: `for ${experiment.label}`, record: experiment.id } : a.purpose,
    ),
    facts: facts(
      {
        label: 'subjects',
        value: a.subjects.length === 0 ? 'not chosen yet' : count(a.subjects.length, 'subject'),
        field: 'subjects',
        ...(a.subjects.length === 0 ? { tone: 'warn' as const } : {}),
      },
      from && {
        label: 'layout',
        value: from.label,
        record: from.id,
        detail: `version ${a.layout.version}`,
        field: 'layout',
      },
      labware && { label: 'plate', value: labware.label, record: labware.id, field: 'labware' },
      a.overrides?.length && {
        label: 'changed by hand',
        value: count(a.overrides.length, 'well'),
        field: 'overrides',
      },
    ),
  };
};

export const platemapOverviews: Record<string, OverviewBuilder> = { layout, plate_map: plateMap };

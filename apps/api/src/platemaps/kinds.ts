import { generatePlateMap, PlateMapError } from '@ailab/domain';
import {
  type CheckResult,
  defineKind,
  type LayoutAttributes,
  LayoutAttributes as LayoutSchema,
} from '@ailab/schema';
import { layoutSpec, subjectOf } from './spec.ts';

const PLAN = 'Plate maps (plan 014)';

const duplicates = (names: readonly string[]) => [
  ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
];

const CONTROL_ROLES = ['neutral_control', 'positive_control', 'negative_control', 'standard'];

/**
 * A layout template (plan 014, P3): the lab's reusable plate pattern for one format. It never names
 * samples; a plate map applies it to real subjects.
 */
export const layout = defineKind({
  kind: 'layout',
  idPrefix: 'lyt',
  namePrefix: 'LYT',
  nameWidth: 4,
  attributes: LayoutSchema,
  links: (a: LayoutAttributes) =>
    [...new Set((a.fixed ?? []).flatMap((f) => (f.subject ? [f.subject] : [])))].map((toId) => ({
      toId,
      relation: 'control',
    })),
  sections: [
    {
      id: 'wells',
      title: 'What goes where',
      fields: [
        'wells',
        'subjectRole',
        'subjectRegion',
        'subjectConcentration',
        'subjectSeries',
        'fixed',
      ],
    },
    {
      id: 'placement',
      title: 'Replicates and placement',
      fields: ['replicates', 'arrangement', 'fillOrder', 'strategy', 'edge', 'leftover'],
    },
    {
      id: 'analysis',
      title: 'Analysis and notes',
      fields: ['wellVolume', 'groups', 'assays', 'notes'],
    },
  ],
  related: async (a, { get }) => {
    const invalid = [
      ...duplicates((a.fixed ?? []).map((f) => f.id)).map((d) => `The region ${d} is named twice`),
      ...duplicates((a.groups ?? []).map((g) => g.id)).map((d) => `The group ${d} is named twice`),
    ];
    if (a.subjectSeries && a.subjectConcentration)
      invalid.push('Give subjects a single concentration or a series, not both');
    for (const f of a.fixed ?? []) {
      if (f.series && f.concentration)
        invalid.push(`${f.label ?? f.id}: a single concentration or a series, not both`);
      if (f.subject && !(await get(f.subject)))
        invalid.push(`${f.subject} is not a record in this lab`);
    }
    if (invalid.length) return { invalid };
    try {
      generatePlateMap(layoutSpec(a), [subjectOf(a, 'check')], { seed: 0 });
    } catch (error) {
      if (error instanceof PlateMapError) return { invalid: [error.message] };
      throw error;
    }
    const controls = (a.fixed ?? []).some((f) => CONTROL_ROLES.includes(f.role));
    const checks: CheckResult[] = [
      {
        id: 'has_controls',
        label: 'Controls on every plate',
        severity: 'warning',
        passed: controls,
        ...(controls
          ? {}
          : {
              message: 'No control or standard region, so plates cannot be normalized or compared',
            }),
        fix: 'Add a fixed region for neutral and positive controls, or a standard series',
        source: PLAN,
        section: 'wells',
      },
    ];
    return { checks };
  },
});

export const plateMapKinds = [layout];

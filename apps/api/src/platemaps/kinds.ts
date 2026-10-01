import { generatePlateMap, PlateMapError } from '@ailab/domain';
import {
  type CheckResult,
  defineKind,
  type LabwareTypeAttributes,
  type LayoutAttributes,
  LayoutAttributes as LayoutSchema,
  type PlateMapAttributes,
  PlateMapAttributes as PlateMapSchema,
} from '@ailab/schema';
import { checkPin, type PinReport } from '../records/pins.ts';
import { planPlateMap } from './generate.ts';
import { layoutSpec, subjectOf } from './spec.ts';

const PLAN = '(plan 014, plate maps)';

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

const check = (
  id: string,
  label: string,
  severity: CheckResult['severity'],
  problem: string | undefined,
  fix: string,
  section: string,
): CheckResult => ({
  id,
  label,
  severity,
  source: PLAN,
  section,
  passed: problem === undefined,
  ...(problem ? { message: problem } : {}),
  fix,
});

/** What a plate map places: things with an identity in the lab. */
const SUBJECT_KINDS = ['entity', 'sample', 'lot', 'container'];

/**
 * A plate map (plan 014, P1 and M3): a pinned layout version applied to real subjects across as
 * many plates as they need. Its wells are worked out, never stored, so they always match.
 */
export const plateMap = defineKind({
  kind: 'plate_map',
  idPrefix: 'pmp',
  namePrefix: 'PMP',
  nameWidth: 4,
  attributes: PlateMapSchema,
  links: (a: PlateMapAttributes) => [
    { toId: a.layout.id, relation: 'follows' },
    ...(a.experiment ? [{ toId: a.experiment, relation: 'part_of' }] : []),
    ...(a.labware ? [{ toId: a.labware.id, relation: 'plate_type' }] : []),
    ...[...new Set(a.subjects.map((s) => s.record))].map((toId) => ({ toId, relation: 'places' })),
    ...[...new Set((a.controls ?? []).map((c) => c.record))].map((toId) => ({
      toId,
      relation: 'control',
    })),
  ],
  sections: [
    {
      id: 'subjects',
      title: 'What goes on the plates',
      fields: ['layout', 'experiment', 'purpose', 'labware', 'subjects', 'controls'],
    },
    {
      id: 'placement',
      title: 'Placement and hand edits',
      fields: ['strategy', 'seed', 'overrides', 'notes'],
    },
  ],
  related: async (a, context) => {
    const pin = await checkPin(context, a.layout, 'layout', 'a layout');
    if (pin.invalid || !pin.pinned) return { invalid: [pin.invalid as string] };
    const layout = pin.pinned.attributes as LayoutAttributes;
    const invalid: string[] = [];
    if (a.experiment && (await context.get(a.experiment))?.kind !== 'experiment')
      invalid.push(`${a.experiment} is not an experiment in this lab`);
    let plate: PinReport | undefined;
    if (a.labware) {
      plate = await checkPin(context, a.labware, 'labware_type', 'a labware type');
      if (plate.invalid) invalid.push(plate.invalid);
      const wells = (plate.pinned?.attributes as LabwareTypeAttributes | undefined)?.wells;
      if (wells?.layout === 'grid' && wells.rows * wells.columns !== layout.wells)
        invalid.push(
          `${plate.pinned?.name} has ${wells.rows * wells.columns} wells; the layout is for ${layout.wells}`,
        );
    }
    for (const d of duplicates(a.subjects.map((s) => s.record)))
      invalid.push(`${d} is placed twice; give it once, with replicates in the layout`);
    for (const s of a.subjects) {
      const record = await context.get(s.record);
      if (!record || !SUBJECT_KINDS.includes(record.kind))
        invalid.push(`${s.record} is not an entity, sample, lot or container in this lab`);
    }
    const regions = new Set((layout.fixed ?? []).map((f) => f.id));
    for (const c of a.controls ?? []) {
      if (!regions.has(c.region)) invalid.push(`The layout has no region ${c.region}`);
      if (!(await context.get(c.record))) invalid.push(`${c.record} is not a record in this lab`);
    }
    for (const o of a.overrides ?? [])
      if (o.subject && !(await context.get(o.subject)))
        invalid.push(`${o.subject} is not a record in this lab`);
    const strategy = a.strategy ?? layout.strategy ?? 'in_order';
    if (strategy !== 'in_order' && a.seed === undefined)
      invalid.push(`${strategy.replaceAll('_', ' ')} placement needs a seed`);
    if (invalid.length) return { invalid };
    let stale: string[] = [];
    try {
      const result = await planPlateMap(a, layout, context.get);
      stale = result.staleOverrides.map((o) => `plate ${o.plate} ${o.well}`);
    } catch (error) {
      if (error instanceof PlateMapError) return { invalid: [error.message] };
      throw error;
    }
    const filled = new Set((a.controls ?? []).map((c) => c.region));
    const empty = (layout.fixed ?? []).filter(
      (f) => CONTROL_ROLES.includes(f.role) && !f.subject && !filled.has(f.id),
    );
    return {
      checks: [
        check(
          'has_subjects',
          'It places something',
          'blocker',
          a.subjects.length ? undefined : 'No subjects yet',
          'Add the samples, compounds or lots to place',
          'subjects',
        ),
        check(
          'layout_confirmed',
          'The layout is confirmed',
          'blocker',
          pin.unconfirmed ? `${pin.unconfirmed}; confirm the layout first` : undefined,
          'Confirm the layout, then pin the version a person confirmed',
          'subjects',
        ),
        check(
          'layout_current',
          'It uses the latest confirmed layout',
          'warning',
          pin.newer
            ? `${pin.record?.name} v${pin.newer} is newer than v${a.layout.version}`
            : undefined,
          'Look at what changed in the layout, then adopt the newer version or keep this one',
          'subjects',
        ),
        ...(a.labware && plate
          ? [
              check(
                'labware_confirmed',
                'The plate type is confirmed',
                'blocker',
                plate.unconfirmed
                  ? `${plate.unconfirmed}; confirm the plate type first`
                  : undefined,
                'Confirm the labware type, then pin the version a person confirmed',
                'subjects',
              ),
              check(
                'labware_current',
                'It uses the latest confirmed plate type',
                'warning',
                plate.newer
                  ? `${plate.record?.name} v${plate.newer} is newer than v${a.labware.version}`
                  : undefined,
                'Look at what changed in the plate type, then adopt the newer version or keep this one',
                'subjects',
              ),
            ]
          : []),
        check(
          'controls_named',
          'Controls and standards say what goes in',
          'warning',
          empty.length
            ? `Nothing named for ${empty.map((f) => f.label ?? f.id).join(', ')}`
            : undefined,
          'Name the lot, entity or sample for each control region',
          'subjects',
        ),
        check(
          'overrides_apply',
          'Hand edits land on the plates',
          'warning',
          stale.length ? `No longer on a plate: ${stale.join(', ')}` : undefined,
          'Remove the hand edits that no longer apply',
          'placement',
        ),
      ],
    };
  },
});

export const plateMapKinds = [layout, plateMap];

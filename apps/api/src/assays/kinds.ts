import {
  type AssayTemplateAttributes,
  AssayTemplateAttributes as AssayTemplateSchema,
  type CheckResult,
  defineKind,
  type SopAttributes,
} from '@ailab/schema';
import { checkPin, type PinReport, waitingOn } from '../records/pins.ts';

const PLAN = '(plan 017, assay templates)';

const duplicates = (names: readonly string[]) => [
  ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
];

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

const INSTRUMENT_KINDS = ['instrument', 'instrument_kind'];

/**
 * An assay template (plan 017, D1, ADR 0065): the lab's ready-made designer for one assay. It pins
 * confirmed SOP versions and a layout, so a confirmed template always designs the same way.
 */
export const assayTemplate = defineKind({
  kind: 'assay_template',
  idPrefix: 'asy',
  namePrefix: 'ASY',
  nameWidth: 4,
  attributes: AssayTemplateSchema,
  links: (a: AssayTemplateAttributes) => [
    ...[...new Set(a.parts.map((p) => p.sop.id))].map((toId) => ({ toId, relation: 'follows' })),
    ...(a.layout ? [{ toId: a.layout.id, relation: 'layout' }] : []),
    ...[...new Set((a.roles ?? []).flatMap((r) => r.preferred ?? []))].map((toId) => ({
      toId,
      relation: 'prefers',
    })),
    ...[...new Set((a.roles ?? []).flatMap((r) => (r.record ? [r.record] : [])))].map((toId) => ({
      toId,
      relation: 'uses',
    })),
    ...[...new Set((a.controls ?? []).flatMap((c) => (c.subject ? [c.subject] : [])))].map(
      (toId) => ({ toId, relation: 'control' }),
    ),
    ...(a.next ? [{ toId: a.next, relation: 'next_assay' }] : []),
  ],
  sections: [
    { id: 'purpose', title: 'What it measures', fields: ['purpose', 'assays', 'notes'] },
    { id: 'protocol', title: 'SOPs, layout and instruments', fields: ['parts', 'layout', 'roles'] },
    {
      id: 'inputs',
      title: 'What the designer asks, and what varies',
      fields: ['essentials', 'factors', 'design'],
    },
    { id: 'controls', title: 'Controls and replicates', fields: ['controls', 'replicates'] },
    {
      id: 'readouts',
      title: 'Readouts and analysis',
      fields: ['readouts', 'quality', 'analysis', 'hitRule', 'next'],
    },
  ],
  related: async (a, context) => {
    const invalid = [
      ...duplicates(a.parts.map((p) => p.id)).map((d) => `The part ${d} is named twice`),
      ...duplicates(a.essentials.map((e) => e.id)).map((d) => `The input ${d} is named twice`),
      ...duplicates((a.factors ?? []).map((f) => f.id)).map(
        (d) => `The factor ${d} is named twice`,
      ),
      ...duplicates((a.controls ?? []).map((c) => c.id)).map(
        (d) => `The control ${d} is named twice`,
      ),
      ...duplicates(a.readouts.map((r) => r.id)).map((d) => `The readout ${d} is named twice`),
    ];
    // Each part's SOP at its pinned version.
    const pins = new Map<string, PinReport>();
    for (const part of a.parts) {
      const pin = await checkPin(context, part.sop, 'sop', 'a digital SOP');
      if (pin.invalid) invalid.push(`${part.id}: ${pin.invalid}`);
      pins.set(part.id, pin);
    }
    const sopOf = (part: string) => pins.get(part)?.pinned?.attributes as SopAttributes | undefined;
    const partNamed = (part: string, where: string) => {
      if (pins.has(part)) return true;
      invalid.push(`${where}: the template has no part ${part}`);
      return false;
    };
    for (const r of a.roles ?? []) {
      const where = `The role ${r.role}`;
      if (!partNamed(r.part, where)) continue;
      const sop = sopOf(r.part);
      if (sop && !sop.materials.some((m) => m.role === r.role))
        invalid.push(`${where}: ${pins.get(r.part)?.record?.name} has no material role ${r.role}`);
      for (const id of r.preferred ?? [])
        if (!INSTRUMENT_KINDS.includes((await context.get(id))?.kind ?? ''))
          invalid.push(`${where}: ${id} is not an instrument or instrument kind in this lab`);
      if (r.record) {
        const record = await context.get(r.record);
        if (!record) invalid.push(`${where}: ${r.record} is not a record in this lab`);
        else if (r.version !== undefined && !(await context.getVersion(r.record, r.version)))
          invalid.push(`${where}: ${record.name} has no version ${r.version}`);
      }
    }
    for (const p of a.parts)
      for (const i of p.inputs ?? []) {
        const variable = sopOf(p.id)?.variables.find((v) => v.name === i.name);
        if (pins.get(p.id)?.pinned && (!variable || !['input', 'default'].includes(variable.kind)))
          invalid.push(
            `The part ${p.id}: ${pins.get(p.id)?.record?.name} has no input or default variable ${i.name}`,
          );
        if (
          a.essentials.some(
            (e) => e.input === 'variable' && e.part === p.id && e.variable === i.name,
          )
        )
          invalid.push(
            `The part ${p.id} sets ${i.name}, which the template also asks for; keep one`,
          );
      }
    const subjects = new Set<string>();
    for (const e of a.essentials) {
      if (e.input === 'subjects') {
        subjects.add(e.id);
        continue;
      }
      if (!partNamed(e.part, `The input ${e.id}`)) continue;
      const variable = sopOf(e.part)?.variables.find((v) => v.name === e.variable);
      if (pins.get(e.part)?.pinned && (!variable || !['input', 'default'].includes(variable.kind)))
        invalid.push(
          `The input ${e.id}: ${pins.get(e.part)?.record?.name} has no input or default variable ${e.variable}`,
        );
    }
    for (const f of a.factors ?? []) {
      if (f.from && !subjects.has(f.from))
        invalid.push(`The factor ${f.id}: ${f.from} is not a subjects input of the template`);
      const levels = f.levels
        ? f.levels.map((l) => l.id)
        : f.series
          ? Array.from({ length: f.series.points }, (_, i) => `p${i + 1}`)
          : undefined;
      if (f.levels)
        for (const d of duplicates(levels ?? []))
          invalid.push(`The factor ${f.id}: the level ${d} is named twice`);
      if (f.baseline && levels && !levels.includes(f.baseline))
        invalid.push(`The factor ${f.id} has no level ${f.baseline} to keep as its baseline`);
      if (f.baseline && f.from)
        invalid.push(`The factor ${f.id}: levels from an input have no baseline to name`);
    }
    for (const r of a.readouts) if (r.part) partNamed(r.part, `The readout ${r.id}`);
    for (const c of a.controls ?? [])
      if (c.subject && !(await context.get(c.subject)))
        invalid.push(`The control ${c.id}: ${c.subject} is not a record in this lab`);
    let layout: PinReport | undefined;
    if (a.layout) {
      layout = await checkPin(context, a.layout, 'layout', 'a layout');
      if (layout.invalid) invalid.push(layout.invalid);
    }
    if (a.next) {
      const next = await context.get(a.next);
      if (next?.kind !== 'assay_template')
        invalid.push(`${a.next} is not an assay template in this lab`);
      else if (next.id === context.current?.id) invalid.push('A template cannot follow itself');
    }
    if (invalid.length) return { invalid };

    const unconfirmed = [...pins.values()].flatMap((p) => (p.unconfirmed ? [p.unconfirmed] : []));
    const newer = [...pins.values()].flatMap((p) =>
      p.newer ? [`${p.record?.name} v${p.newer}`] : [],
    );
    const checks: CheckResult[] = [
      {
        ...check(
          'sops_confirmed',
          'Its SOPs are confirmed',
          'blocker',
          unconfirmed.length ? `${unconfirmed.join('; ')}; confirm them first` : undefined,
          'Confirm the SOPs, then pin the versions a person confirmed',
          'protocol',
        ),
        ...waitingOn(...pins.values()),
      },
      check(
        'sops_current',
        'It uses the latest confirmed SOPs',
        'warning',
        newer.length ? `Newer confirmed versions: ${newer.join(', ')}` : undefined,
        'Look at what changed in each SOP, then pin the newer version or keep this one',
        'protocol',
      ),
      ...(layout
        ? [
            {
              ...check(
                'layout_confirmed',
                'The layout is confirmed',
                'blocker',
                layout.unconfirmed ? `${layout.unconfirmed}; confirm the layout first` : undefined,
                'Confirm the layout, then pin the version a person confirmed',
                'protocol',
              ),
              ...waitingOn(layout),
            },
            check(
              'layout_current',
              'It uses the latest confirmed layout',
              'warning',
              layout.newer
                ? `${layout.record?.name} v${layout.newer} is newer than v${a.layout?.version}`
                : undefined,
              'Look at what changed in the layout, then adopt the newer version or keep this one',
              'protocol',
            ),
          ]
        : []),
      check(
        'asks_for_subjects',
        'The designer knows what is tested',
        'warning',
        subjects.size
          ? undefined
          : 'No subjects input, so every experiment from it tests the same things',
        'Add a subjects input, e.g. "Which samples"',
        'inputs',
      ),
      check(
        'has_controls',
        'Controls on every plate or run',
        'warning',
        a.controls?.length ? undefined : 'No controls, so plates cannot be normalized or compared',
        'Add control rules: wells of a control role per plate or per run, with the reason',
        'controls',
      ),
    ];
    return { checks };
  },
});

export const assayKinds = [assayTemplate];

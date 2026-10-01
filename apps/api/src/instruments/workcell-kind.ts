import {
  type CheckResult,
  defineKind,
  type RecordEnvelope,
  type RelatedContext,
  type WorkcellAttributes,
  WorkcellAttributes as WorkcellSchema,
} from '@ailab/schema';

/**
 * Workcells (plan 008d): which registered instruments work together, and the device each maps to
 * in the digital twin. The twin holds everything physical; an instrument is in at most one
 * confirmed workcell (I9), and is standalone otherwise.
 */

const SOURCE = 'Workcells (plan 008d)';

const check = (
  id: string,
  label: string,
  severity: 'blocker' | 'warning',
  problems: string[],
  fix: string,
): CheckResult => ({
  id,
  label,
  severity,
  source: SOURCE,
  section: 'members',
  passed: problems.length === 0,
  ...(problems.length ? { message: problems.join('; ') } : {}),
  fix,
});

const duplicates = (values: string[]) => [
  ...new Set(values.filter((v, i) => values.indexOf(v) !== i)),
];

async function workcellRules(
  a: WorkcellAttributes,
  { get, list, current }: Pick<RelatedContext, 'get' | 'list' | 'current'>,
) {
  const invalid: string[] = [];
  const twice = duplicates(a.members.map((m) => m.instrument));
  if (twice.length) invalid.push(`Listed more than once: ${twice.join(', ')}`);
  const sameDevice = duplicates(a.members.flatMap((m) => (m.twinDevice ? [m.twinDevice] : [])));
  if (sameDevice.length)
    invalid.push(`More than one member maps to twin device ${sameDevice.join(', ')}`);
  const instruments = new Map<string, RecordEnvelope>();
  for (const m of a.members) {
    const record = await get(m.instrument);
    if (record?.kind !== 'instrument')
      invalid.push(`${m.instrument} is not an instrument in this lab`);
    else instruments.set(m.instrument, record);
  }
  if (invalid.length) return { invalid };

  const named = (id: string) => {
    const r = instruments.get(id) as RecordEnvelope;
    return `${r.label} (${r.name})`;
  };
  const unconfirmed = a.members
    .filter((m) => instruments.get(m.instrument)?.status !== 'active')
    .map((m) => named(m.instrument));
  const elsewhere: string[] = [];
  for (const w of await list('workcell')) {
    if (w.status !== 'active' || w.id === current?.id) continue;
    for (const m of (w.attributes as WorkcellAttributes).members)
      if (instruments.has(m.instrument))
        elsewhere.push(`${named(m.instrument)} is in ${w.label} (${w.name})`);
  }
  // A draft may overlap while it is designed; a confirmed workcell is never edited into overlap.
  if (current?.status === 'active' && elsewhere.length)
    return { invalid: elsewhere.map((e) => `${e}; take it out of there first`) };
  const unmapped = [
    ...(a.twin ? [] : ['No twin workcell is named']),
    ...a.members
      .filter((m) => !m.twinDevice)
      .map((m) => `${named(m.instrument)} has no twin device`),
  ];
  return {
    checks: [
      check(
        'members_confirmed',
        'Every member is a confirmed instrument',
        'blocker',
        unconfirmed.length ? [`Not confirmed yet: ${unconfirmed.join(', ')}`] : [],
        'Confirm the instrument first (Instruments), or take it out',
      ),
      check(
        'one_workcell',
        'No member is in another confirmed workcell',
        'blocker',
        elsewhere,
        'Take it out of the other workcell first, or out of this one',
      ),
      check(
        'twin_mapped',
        'Every member maps to a device in the twin',
        'blocker',
        unmapped,
        'Name the twin workcell and the twin device for each member',
      ),
      check(
        'twin_checked',
        'The twin mapping is checked against the twin',
        'warning',
        a.twin
          ? [
              'Recorded as given: the twin devices are checked once the twin connection (plan 015) can list them',
            ]
          : [],
        'Nothing to do until the twin connection lands',
      ),
    ],
  };
}

export const workcell = defineKind({
  kind: 'workcell',
  idPrefix: 'wcl',
  namePrefix: 'WCL',
  nameWidth: 4,
  attributes: WorkcellSchema,
  links: (a: WorkcellAttributes) =>
    a.members.map((m) => ({ toId: m.instrument, relation: 'member' })),
  sections: [{ id: 'members', title: 'Members', fields: ['twin', 'members', 'notes'] }],
  related: async (a, context) => workcellRules(a, context),
});

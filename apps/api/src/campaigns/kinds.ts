import {
  type CampaignAttributes,
  CampaignAttributes as CampaignSchema,
  type CheckResult,
  defineKind,
  type ExperimentAttributes,
  ExperimentAttributes as ExperimentSchema,
  MATERIAL_KINDS,
  type RunAttributes,
  RunAttributes as RunSchema,
  type SetAttributes,
  SetAttributes as SetSchema,
  type SopAttributes,
} from '@ailab/schema';
import { checkPin, stable } from '../records/pins.ts';
import { inputProblem } from '../sops/inputs.ts';

/** Kinds that are definitions, so bindings pin their version (ADR 0039). */
export const PINNED_KINDS: readonly string[] = [
  'labware_type',
  'product',
  'lot',
  'instrument_kind',
  'equipment_kind',
  'entity',
];

const PLAN = 'Campaigns and experiments (plan 013)';

const check = (
  id: string,
  label: string,
  severity: CheckResult['severity'],
  problem: string | undefined,
  fix: string,
  section: string,
  quickFix?: CheckResult['quickFix'],
): CheckResult => ({
  id,
  label,
  severity,
  source: PLAN,
  section,
  passed: problem === undefined,
  ...(problem ? { message: problem } : {}),
  fix,
  ...(problem && quickFix ? { quickFix } : {}),
});

const duplicates = (names: readonly string[]) => [
  ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
];

/**
 * A campaign (plan 013, E1): a lab project with a goal and aims. Its stage (proposed, active,
 * paused, completed, stopped) is separate from the record status and changes with
 * `campaigns.set_stage`.
 */
export const campaign = defineKind({
  kind: 'campaign',
  idPrefix: 'cam',
  namePrefix: 'CAM',
  nameWidth: 3,
  attributes: CampaignSchema,
  links: (a: CampaignAttributes) => [
    ...[...new Set(a.about ?? [])].map((toId) => ({ toId, relation: 'about' })),
    ...[...new Set(a.references ?? [])].map((toId) => ({ toId, relation: 'references' })),
  ],
  sections: [
    {
      id: 'overview',
      title: 'Goal',
      fields: ['goal', 'background', 'owner', 'contributors', 'starts', 'ends'],
    },
    { id: 'aims', title: 'Aims', fields: ['aims'] },
    { id: 'about', title: 'What it is about', fields: ['about', 'references'] },
  ],
  related: async (a, { get }) => {
    const invalid = duplicates(a.aims.map((x) => x.id)).map((d) => `The aim ${d} is named twice`);
    if (a.starts && a.ends && a.ends < a.starts) invalid.push('It ends before it starts');
    for (const id of new Set(a.about ?? [])) {
      if (!(await get(id))) invalid.push(`${id} is not a record in this lab`);
    }
    for (const id of new Set(a.references ?? [])) {
      if ((await get(id))?.kind !== 'document')
        invalid.push(`${id} is not a library document in this lab`);
    }
    if (invalid.length) return { invalid };
    return {
      checks: [
        check(
          'has_aims',
          'It has aims',
          'blocker',
          a.aims.length === 0 ? 'No aims yet' : undefined,
          'Add what the campaign sets out to show, each with how you will know',
          'aims',
        ),
      ],
    };
  },
});

/**
 * An experiment (plan 013, E2): one question in a campaign, the confirmed SOP versions it follows
 * (pinned by version, ADR 0039), its conditions, controls and readouts. Stage (designing, planned,
 * running…) changes with `experiments.set_stage`.
 */
export const experiment = defineKind({
  kind: 'experiment',
  idPrefix: 'exp',
  namePrefix: 'EXP',
  nameWidth: 4,
  attributes: ExperimentSchema,
  links: (a: ExperimentAttributes) => [
    { toId: a.campaign, relation: 'part_of' },
    ...(a.followsUp ? [{ toId: a.followsUp.experiment, relation: a.followsUp.relation }] : []),
    ...[...new Set((a.subjects ?? []).map((s) => s.record))].map((toId) => ({
      toId,
      relation: 'tests',
    })),
    ...[...new Set((a.controls ?? []).flatMap((c) => (c.subject ? [c.subject] : [])))].map(
      (toId) => ({ toId, relation: 'control' }),
    ),
    ...[...new Set(a.protocol.map((p) => p.sop.id))].map((toId) => ({ toId, relation: 'follows' })),
    ...(a.documents ?? []).map((d) => ({
      toId: d.document,
      relation: d.use === 'follows' ? 'follows' : 'references',
    })),
    ...[
      ...new Set([
        ...(a.conclusion?.runs ?? []),
        ...(a.conclusion?.verdicts ?? []).flatMap((v) => (v.evidence ?? []).map((e) => e.record)),
      ]),
    ].map((toId) => ({ toId, relation: 'evidence' })),
  ],
  sections: [
    {
      id: 'question',
      title: 'Question',
      fields: ['campaign', 'aim', 'question', 'hypotheses', 'followsUp', 'owner', 'contributors'],
    },
    { id: 'subjects', title: 'What is tested', fields: ['subjects'] },
    { id: 'protocol', title: 'Protocol', fields: ['protocol', 'documents'] },
    { id: 'conditions', title: 'Conditions and controls', fields: ['conditions', 'controls'] },
    { id: 'readouts', title: 'Readouts', fields: ['readouts', 'successCriteria', 'notes'] },
  ],
  related: async (a, context) => {
    const { get, current } = context;
    const invalid: string[] = [];
    const parent = await get(a.campaign);
    if (parent?.kind !== 'campaign') invalid.push(`${a.campaign} is not a campaign in this lab`);
    else if (a.aim && !(parent.attributes as CampaignAttributes).aims.some((x) => x.id === a.aim)) {
      invalid.push(`${parent.name} has no aim ${a.aim}`);
    }
    if (a.followsUp) {
      if (a.followsUp.experiment === current?.id)
        invalid.push('An experiment cannot follow itself');
      else if ((await get(a.followsUp.experiment))?.kind !== 'experiment')
        invalid.push(`${a.followsUp.experiment} is not an experiment in this lab`);
    }
    for (const id of new Set([
      ...(a.subjects ?? []).map((s) => s.record),
      ...(a.controls ?? []).flatMap((c) => (c.subject ? [c.subject] : [])),
    ])) {
      if (!(await get(id))) invalid.push(`${id} is not a record in this lab`);
    }
    for (const d of a.documents ?? []) {
      if ((await get(d.document))?.kind !== 'document')
        invalid.push(`${d.document} is not a library document in this lab`);
    }
    for (const [what, names] of [
      ['protocol part', a.protocol.map((p) => p.id)],
      ['hypothesis', (a.hypotheses ?? []).map((h) => h.id)],
      ['condition or control', [...(a.conditions ?? []), ...(a.controls ?? [])].map((c) => c.id)],
      ['readout', (a.readouts ?? []).map((r) => r.id)],
    ] as const) {
      for (const d of duplicates(names)) invalid.push(`The ${what} ${d} is named twice`);
    }
    const readouts = new Set((a.readouts ?? []).map((r) => r.id));
    for (const h of a.hypotheses ?? []) {
      if (h.prediction && !readouts.has(h.prediction.readout))
        invalid.push(`Hypothesis ${h.id} is measured on ${h.prediction.readout}, not a readout`);
    }
    if (a.conclusion) {
      const hypotheses = new Set((a.hypotheses ?? []).map((h) => h.id));
      for (const v of a.conclusion.verdicts ?? []) {
        if (!hypotheses.has(v.hypothesis)) invalid.push(`There is no hypothesis ${v.hypothesis}`);
        for (const e of v.evidence ?? [])
          if (!(await get(e.record))) invalid.push(`${e.record} is not a record in this lab`);
      }
      for (const d of duplicates((a.conclusion.verdicts ?? []).map((v) => v.hypothesis)))
        invalid.push(`Hypothesis ${d} has two verdicts`);
      for (const id of a.conclusion.runs ?? []) {
        const run = await get(id);
        if (run?.kind !== 'run' || (run.attributes as RunAttributes).experiment.id !== current?.id)
          invalid.push(`${id} is not a run of this experiment`);
      }
    }
    const unconfirmed: string[] = [];
    const newer: string[] = [];
    const misfits: string[] = [];
    for (const p of a.protocol) {
      const pin = await checkPin(context, p.sop, 'sop', 'an SOP');
      if (pin.invalid) invalid.push(pin.invalid);
      if (pin.unconfirmed) unconfirmed.push(pin.unconfirmed);
      if (pin.newer && pin.record)
        newer.push(`${pin.record.name} v${pin.newer} (this uses v${p.sop.version})`);
      if (!pin.pinned) continue;
      const sop = pin.pinned.attributes as SopAttributes;
      const where = `${p.id} (${pin.pinned.name} v${p.sop.version})`;
      for (const d of duplicates((p.bindings ?? []).map((b) => b.role)))
        invalid.push(`${where}: the role ${d} is bound twice`);
      for (const d of duplicates((p.inputs ?? []).map((i) => i.name)))
        invalid.push(`${where}: ${d} is given twice`);
      for (const b of p.bindings ?? []) {
        const material = sop.materials.find((m) => m.role === b.role);
        if (!material) {
          invalid.push(`${where} has no material ${b.role}`);
          continue;
        }
        const record = await get(b.record);
        if (!record) {
          invalid.push(`${where}: ${b.record} is not a record in this lab`);
          continue;
        }
        const definition = PINNED_KINDS.includes(record.kind);
        if (definition && b.version === undefined) {
          invalid.push(`${where}: pin ${record.name} by version, as it is a definition (ADR 0039)`);
          continue;
        }
        if (!definition && b.version !== undefined) {
          invalid.push(
            `${where}: ${record.name} is bound by id and checked live; leave out its version`,
          );
          continue;
        }
        const kinds = MATERIAL_KINDS[material.type];
        if (!kinds.includes(record.kind)) {
          misfits.push(
            `${where}: ${record.name} is a ${record.kind.replaceAll('_', ' ')}; ${material.label} needs a ${kinds.map((k) => k.replaceAll('_', ' ')).join(' or ')}`,
          );
        }
        if (b.version === undefined) continue;
        const bound = await checkPin(
          context,
          { id: b.record, version: b.version },
          record.kind,
          'a record',
        );
        if (bound.invalid) invalid.push(`${where}: ${bound.invalid}`);
        if (bound.unconfirmed) unconfirmed.push(bound.unconfirmed);
        if (bound.newer) newer.push(`${record.name} v${bound.newer} (this uses v${b.version})`);
      }
      for (const i of p.inputs ?? []) {
        const variable = sop.variables.find((v) => v.name === i.name);
        if (!variable) invalid.push(`${where} has no variable ${i.name}`);
        else if (variable.kind === 'computed')
          invalid.push(`${where}: ${i.name} is worked out by a formula; give the values it uses`);
        else {
          const problem = inputProblem(variable, i.value);
          if (problem) invalid.push(`${where}: ${problem}`);
        }
      }
    }
    if (invalid.length) return { invalid };

    const followed = (a.documents ?? []).filter((d) => d.use === 'follows');
    return {
      checks: [
        check(
          'has_protocol',
          'It follows an SOP',
          'blocker',
          a.protocol.length === 0 && followed.length === 0
            ? 'No SOP or document to follow yet'
            : undefined,
          'Pin a confirmed digital SOP, or attach the document you will follow',
          'protocol',
        ),
        check(
          'protocol_confirmed',
          'The SOP and record versions it follows are confirmed',
          'blocker',
          unconfirmed.length ? `${unconfirmed.join('; ')}; pin a confirmed version` : undefined,
          'Confirm the SOP, then pin the version a person confirmed',
          'protocol',
        ),
        check(
          'bindings_fit',
          'Bound records fit their roles',
          'blocker',
          misfits.length ? misfits.join('; ') : undefined,
          'Bind each role to a record of the kind the SOP asks for',
          'protocol',
        ),
        check(
          'protocol_current',
          'It follows the latest confirmed versions',
          'warning',
          newer.length ? `Newer confirmed versions: ${newer.join('; ')}` : undefined,
          'Look at what changed, then adopt the newer versions or keep these',
          'protocol',
          { operation: 'experiments.adopt_versions', label: 'Use the newer versions' },
        ),
        check(
          'documents_compute',
          'Its protocol computes',
          'warning',
          followed.length
            ? `${followed.length} followed document${followed.length === 1 ? ' is' : 's are'} not digitized, so nothing computes from ${followed.length === 1 ? 'it' : 'them'}`
            : undefined,
          'Digitize the document as an SOP when the experiment needs its values worked out',
          'protocol',
        ),
        check(
          'has_readouts',
          'It says what is measured',
          'warning',
          (a.readouts ?? []).length === 0 ? 'No readouts yet' : undefined,
          'Add the readouts, e.g. luminescence or absorbance at 450 nm',
          'readouts',
        ),
      ],
    };
  },
});

/**
 * A run (plan 013, E2): one execution of an experiment's confirmed design, pinned to the design
 * version it followed, with its steps as a checklist, deviations and data files (013c).
 */
export const run = defineKind({
  kind: 'run',
  idPrefix: 'run',
  namePrefix: 'RUN',
  nameWidth: 4,
  attributes: RunSchema,
  createdBy: 'runs.start',
  links: (a: RunAttributes) => [
    { toId: a.experiment.id, relation: 'runs' },
    ...[...new Set((a.data ?? []).map((d) => d.file))].map((toId) => ({ toId, relation: 'data' })),
  ],
  related: async (a, context) => {
    const pin = await checkPin(context, a.experiment, 'experiment', 'an experiment');
    if (pin.invalid) return { invalid: [pin.invalid] };
    if (pin.unconfirmed)
      return { invalid: [`${pin.unconfirmed}; a run follows a confirmed experiment design`] };
    const before = context.current?.attributes as RunAttributes | undefined;
    const invalid = before ? runChanges(before, a) : [];
    for (const d of a.data ?? []) {
      if ((await context.get(d.file))?.kind !== 'file')
        invalid.push(`${d.file} is not a file in this lab`);
      if (d.container && (await context.get(d.container))?.kind !== 'container')
        invalid.push(`${d.container} is not a container in this lab`);
    }
    return invalid.length ? { invalid } : {};
  },
});

const FINAL: readonly RunAttributes['status'][] = ['done', 'failed', 'aborted'];

/**
 * What no write may do to a run once started, whichever operation makes it (ADR 0041): change the
 * design it follows or the checklist it started with, reopen a finished run, or change a finished
 * run's steps or deviations without the correction that says why (runs.correct, 013c).
 */
function runChanges(before: RunAttributes, a: RunAttributes): string[] {
  const invalid: string[] = [];
  if (stable(a.experiment) !== stable(before.experiment))
    invalid.push('A run keeps the experiment version it started on');
  if (stable([a.startedAt, a.startedBy]) !== stable([before.startedAt, before.startedBy]))
    invalid.push('A run keeps when and by whom it was started');
  const shape = (steps: RunAttributes['steps']) =>
    stable((steps ?? []).map(({ part, step, title, planned }) => ({ part, step, title, planned })));
  if (shape(a.steps) !== shape(before.steps))
    invalid.push(
      'A run keeps the steps and planned values it started with; record what differed as actuals',
    );
  if (!FINAL.includes(before.status)) return invalid;
  if (a.status !== before.status)
    invalid.push(`The run is ${before.status}; correct it with runs.correct rather than reopen it`);
  const kept = <T>(now: readonly T[] | undefined, was: readonly T[] | undefined) =>
    stable((now ?? []).slice(0, (was ?? []).length)) === stable(was ?? []);
  (a.steps ?? []).forEach((s, i) => {
    const was = before.steps?.[i];
    if (!was) return;
    const { corrections, ...rest } = s;
    const { corrections: wasCorrections, ...wasRest } = was;
    if (!kept(corrections, wasCorrections))
      invalid.push(`Step ${s.step} keeps its earlier corrections`);
    else if (
      stable(rest) !== stable(wasRest) &&
      (corrections ?? []).length <= (wasCorrections ?? []).length
    )
      invalid.push(`Step ${s.step} changed after the run finished; correct it with runs.correct`);
  });
  if (!kept(a.deviations, before.deviations))
    invalid.push('A finished run keeps its deviations; add a correction with runs.correct');
  else if ((a.deviations ?? []).slice((before.deviations ?? []).length).some((d) => !d.corrected))
    invalid.push('A deviation added after the run finished is a correction; use runs.correct');
  return invalid;
}

/** Kinds a set's members may be (E10). */
const MEMBER_KINDS = ['entity', 'sample', 'container'];

/**
 * A set (plan 013, E10): a named list of entities, samples or containers one experiment hands to
 * the next, with the criterion that picked them.
 */
export const set = defineKind({
  kind: 'set',
  idPrefix: 'set',
  namePrefix: 'SET',
  nameWidth: 3,
  attributes: SetSchema,
  createdBy: 'sets.create',
  links: (a: SetAttributes) => [
    ...[...new Set(a.members.map((m) => m.record))].map((toId) => ({ toId, relation: 'contains' })),
    ...(a.from ? [{ toId: a.from.experiment, relation: 'picked_by' }] : []),
  ],
  related: async (a, { get }) => {
    const invalid: string[] = [];
    for (const d of duplicates(a.members.map((m) => m.record)))
      invalid.push(`${d} is in the set twice`);
    for (const m of a.members) {
      const record = await get(m.record);
      if (!record) invalid.push(`${m.record} is not a record in this lab`);
      else if (!MEMBER_KINDS.includes(record.kind))
        invalid.push(`${record.name} is not an entity, sample or container, which a set holds`);
    }
    if (a.from) {
      if ((await get(a.from.experiment))?.kind !== 'experiment')
        invalid.push(`${a.from.experiment} is not an experiment in this lab`);
      if (a.from.run) {
        const run = await get(a.from.run);
        if (
          run?.kind !== 'run' ||
          (run.attributes as RunAttributes).experiment.id !== a.from.experiment
        )
          invalid.push(`${a.from.run} is not a run of ${a.from.experiment}`);
      }
    }
    return invalid.length ? { invalid } : {};
  },
});

export const campaignKinds = [campaign, experiment, run, set];

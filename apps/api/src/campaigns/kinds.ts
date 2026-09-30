import {
  type CampaignAttributes,
  CampaignAttributes as CampaignSchema,
  type CheckResult,
  defineKind,
  type ExperimentAttributes,
  ExperimentAttributes as ExperimentSchema,
  type RunAttributes,
  RunAttributes as RunSchema,
} from '@ailab/schema';
import { checkPin } from '../records/pins.ts';

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
    const unconfirmed: string[] = [];
    const newer: string[] = [];
    for (const p of a.protocol) {
      const pin = await checkPin(context, p.sop, 'sop', 'an SOP');
      if (pin.invalid) invalid.push(pin.invalid);
      if (pin.unconfirmed) unconfirmed.push(pin.unconfirmed);
      if (pin.newer && pin.record)
        newer.push(`${pin.record.name} v${pin.newer} (this uses v${p.sop.version})`);
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
          'The SOP versions it follows are confirmed',
          'blocker',
          unconfirmed.length ? `${unconfirmed.join('; ')}; pin a confirmed version` : undefined,
          'Confirm the SOP, then pin the version a person confirmed',
          'protocol',
        ),
        check(
          'protocol_current',
          'It follows the latest confirmed SOP versions',
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
 * version it followed. Step actuals, deviations and data files come with 013c.
 */
export const run = defineKind({
  kind: 'run',
  idPrefix: 'run',
  namePrefix: 'RUN',
  nameWidth: 4,
  attributes: RunSchema,
  links: (a: RunAttributes) => [{ toId: a.experiment.id, relation: 'runs' }],
  related: async (a, context) => {
    const pin = await checkPin(context, a.experiment, 'experiment', 'an experiment');
    if (pin.invalid) return { invalid: [pin.invalid] };
    if (pin.unconfirmed)
      return { invalid: [`${pin.unconfirmed}; a run follows a confirmed experiment design`] };
    return {};
  },
});

export const campaignKinds = [campaign, experiment, run];

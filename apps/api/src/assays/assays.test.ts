import { readdirSync, readFileSync } from 'node:fs';
import {
  type Actor,
  AssayTemplateAttributes,
  type ExperimentAttributes,
  type Readiness,
  type RecordEnvelope,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { campaignKinds } from '../campaigns/kinds.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { inventoryKinds } from '../inventory/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { readSeedSops } from '../sops/seed.ts';
import { transferKinds } from '../transfers/kinds.ts';
import { assayKinds } from './kinds.ts';
import { readSeedAssayTemplates } from './seed.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let kinds: KindRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...fileKinds,
    ...libraryKinds,
    ...sopKinds,
    ...plateMapKinds,
    ...assayKinds,
    ...campaignKinds,
    ...inventoryKinds,
    ...transferKinds,
  ])
    kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus(), undefined, {
    files: new MemoryFileStore(),
  });
});
afterEach(() => close());

async function run<T = RecordEnvelope>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  return error as OperationError;
}

/** A person confirms every section of a draft, which activates it. */
async function confirm(record: RecordEnvelope): Promise<RecordEnvelope> {
  let current = record;
  for (const section of kinds.get(record.kind).sections ?? []) {
    const state = await run<Readiness>(person, 'records.readiness', { id: current.id });
    if (state.sections.find((s) => s.id === section.id)?.state === 'confirmed') continue;
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  if (current.status === 'draft')
    current = await run(person, 'records.confirm', {
      id: current.id,
      expectedVersion: current.version,
    });
  return current;
}

const elisaSop = {
  label: 'IL-6 ELISA',
  materials: [
    { role: 'plate', label: 'Coating plate', type: 'labware' },
    { role: 'reader', label: 'Plate reader', type: 'instrument' },
  ],
  variables: [
    { name: 'sample_dilution', label: 'Sample dilution', kind: 'input', value: '1' },
    {
      name: 'well_volume',
      label: 'Well volume',
      kind: 'default',
      value: { value: '100', unit: 'uL' },
    },
  ],
  steps: [
    {
      id: 'read',
      action: 'read',
      text: 'Read absorbance at 450 nm.',
      uses: ['plate', 'reader'],
    },
  ],
};

async function setup() {
  const sop = await confirm(await run(agent, 'sops.draft', elisaSop));
  const layout = await confirm(
    await run(agent, 'layouts.draft', {
      label: 'ELISA 96',
      wells: 96,
      subjectRole: 'sample',
      replicates: 2,
      fixed: [
        { id: 'std', role: 'standard', region: ['A1:G2'] },
        { id: 'blank', role: 'blank', region: ['H1:H2'] },
      ],
    }),
  );
  const reader = await run(person, 'records.create', {
    kind: 'instrument_kind',
    label: 'Spark',
    attributes: {
      model: 'Spark',
      category: 'plate_reader',
      performedBy: 'machine',
      capabilities: [{ capability: 'read_absorbance' }],
    },
  });
  const template = {
    label: 'IL-6 ELISA',
    purpose: 'IL-6 in supernatants',
    assays: ['ELISA'],
    parts: [{ id: 'assay', sop: { id: sop.id, version: sop.version } }],
    layout: { id: layout.id, version: layout.version },
    roles: [
      {
        part: 'assay',
        role: 'reader',
        capability: 'read_absorbance',
        preferred: [reader.id],
      },
    ],
    essentials: [
      { input: 'subjects', id: 'samples', label: 'Which samples', max: 40 },
      {
        input: 'variable',
        id: 'dilution',
        label: 'Sample dilution',
        part: 'assay',
        variable: 'sample_dilution',
      },
    ],
    factors: [{ id: 'sample', label: 'Sample', from: 'samples' }],
    controls: [
      {
        id: 'std',
        label: 'IL-6 standard',
        role: 'standard',
        wells: 14,
        per: 'plate',
        reason: 'Curve',
      },
      { id: 'blank', label: 'Blank', role: 'blank', wells: 2, per: 'plate', reason: 'Background' },
    ],
    replicates: { technical: 2, reason: 'Duplicates' },
    readouts: [
      { id: 'od', label: 'Absorbance 450 nm', capability: 'read_absorbance', part: 'assay' },
    ],
  };
  return { sop, layout, reader, template };
}

const attributesOf = ({ label: _label, ...attributes }: Record<string, unknown>) => attributes;

describe('assay templates', () => {
  it('drafts a template that pins confirmed SOPs and a layout, and a person confirms it', async () => {
    const { sop, layout, reader, template } = await setup();
    const drafted = await run(agent, 'assays.draft_template', template);
    expect(drafted).toMatchObject({ kind: 'assay_template', name: 'ASY-0001', status: 'draft' });
    const state = await run<Readiness>(person, 'records.readiness', { id: drafted.id });
    expect(state.checks.filter((c) => !c.passed)).toEqual([]);
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: drafted.id, direction: 'from' },
    );
    expect(links.links.map((l) => [l.relation, l.toId])).toEqual(
      expect.arrayContaining([
        ['follows', sop.id],
        ['layout', layout.id],
        ['prefers', reader.id],
      ]),
    );
    const overview = await run<{
      identity: { text: string }[];
      facts: { label: string; value: string }[];
    }>(person, 'records.overview', { id: drafted.id });
    expect(overview.identity.map((p) => p.text)).toEqual(['Assay template', 'for ELISA']);
    expect(overview.facts.map((f) => [f.label, f.value])).toEqual([
      ['measures', 'IL-6 in supernatants'],
      ['follows', 'IL-6 ELISA'],
      ['layout', 'ELISA 96'],
      ['asks for', 'Which samples, Sample dilution'],
      ['varies', 'Sample'],
      ['replicates', 'duplicates'],
      ['controls', 'IL-6 standard (14 wells per plate), Blank (2 wells per plate)'],
      ['reads', 'Absorbance 450 nm'],
    ]);
    const active = await confirm(drafted);
    expect(active.status).toBe('active');
    const found = await run<{ templates: { name: string; essentials: string[] }[] }>(
      agent,
      'assays.search',
      { assay: 'elisa', capability: 'read_absorbance' },
    );
    expect(found.templates).toEqual([
      expect.objectContaining({
        name: 'ASY-0001',
        essentials: ['Which samples', 'Sample dilution'],
      }),
    ]);
    expect(
      (
        await run<{ templates: unknown[] }>(agent, 'assays.search', {
          capability: 'read_luminescence',
        })
      ).templates,
    ).toEqual([]);
  });

  it('flags an unconfirmed SOP, and refuses roles, inputs and factors the template does not have', async () => {
    const { template } = await setup();
    const draftSop = await run(agent, 'sops.draft', { ...elisaSop, label: 'Draft ELISA' });
    const flagged = await run(agent, 'assays.draft_template', {
      ...template,
      parts: [{ id: 'assay', sop: { id: draftSop.id, version: draftSop.version } }],
    });
    const state = await run<Readiness>(person, 'records.readiness', { id: flagged.id });
    expect(state.checks.find((c) => c.id === 'sops_confirmed')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
    const message = async (changes: object) =>
      (await refused(run(agent, 'assays.draft_template', { ...template, ...changes }))).message;
    expect(
      await message({ roles: [{ part: 'assay', role: 'washer', capability: 'wash' }] }),
    ).toContain('has no material role washer');
    expect(
      await message({ roles: [{ part: 'seeding', role: 'reader', capability: 'wash' }] }),
    ).toContain('the template has no part seeding');
    expect(
      await message({
        essentials: [{ input: 'variable', id: 'x', label: 'X', part: 'assay', variable: 'nope' }],
      }),
    ).toContain('has no input or default variable nope');
    const part = template.parts[0] as object;
    expect(
      await message({ parts: [{ ...part, inputs: [{ name: 'nope', value: '1' }] }] }),
    ).toContain('has no input or default variable nope');
    expect(
      await message({ parts: [{ ...part, inputs: [{ name: 'sample_dilution', value: '5' }] }] }),
    ).toContain('sets sample_dilution, which the template also asks for');
    expect(
      await message({ factors: [{ id: 'sample', label: 'Sample', from: 'dilution' }] }),
    ).toContain('dilution is not a subjects input');
    expect(
      await message({
        readouts: [{ id: 'od', label: 'OD', capability: 'read_absorbance', part: 'x' }],
      }),
    ).toContain('the template has no part x');
    expect((await refused(run(otherLab, 'assays.draft_template', template))).message).toContain(
      'is not a digital SOP in this lab',
    );
  });

  it('works out missing inputs, conditions, wells and plates', async () => {
    const { template } = await setup();
    const saved = await run(agent, 'assays.draft_template', template);
    const waiting = await run<{ missing: { id: string }[]; conditions: number; lines: string[] }>(
      agent,
      'assays.design',
      { template: saved.id },
    );
    expect(waiting.missing.map((m) => m.id)).toEqual(['samples', 'dilution']);
    expect(waiting.conditions).toBe(0);
    expect(waiting.lines).toContain('Conditions and totals wait for the inputs above');

    const forty = await run<{
      missing: unknown[];
      conditions: number;
      totals: Record<string, number>;
      lines: string[];
    }>(agent, 'assays.design', { template: saved.id, answers: { samples: 40, dilution: '10' } });
    expect(forty.missing).toEqual([]);
    expect(forty.totals).toMatchObject({
      conditions: 40,
      subjectWells: 80,
      controlWells: 16,
      plates: 1,
      spare: 0,
    });
    expect(forty.lines.at(-1)).toBe('1 plate of 96 wells per run, 0 spare');

    const crossed = await run<{ conditions: number; listed: { label: string }[]; more: number }>(
      agent,
      'assays.design',
      {
        attributes: {
          ...attributesOf(template),
          factors: [
            { id: 'sample', label: 'Sample', from: 'samples' },
            {
              id: 'time',
              label: 'Time',
              levels: [
                { id: 'h24', label: '24 h' },
                { id: 'h48', label: '48 h' },
              ],
            },
          ],
        },
        answers: { samples: 3 },
        show: 2,
      },
    );
    expect(crossed.conditions).toBe(6);
    expect(crossed.listed.map((c) => c.label)).toEqual([
      'Sample: Subject 1 · Time: 24 h',
      'Sample: Subject 1 · Time: 48 h',
    ]);
    expect(crossed.more).toBe(4);

    expect(
      (await refused(run(agent, 'assays.design', { template: saved.id, answers: { samples: 41 } })))
        .message,
    ).toBe('Which samples: at most 40');
    expect(
      (
        await refused(
          run(agent, 'assays.design', { template: saved.id, answers: { dilution: ['x'] } }),
        )
      ).code,
    ).toBe('invalid_input');
    expect((await refused(run(otherLab, 'assays.design', { template: saved.id }))).code).toBe(
      'not_found',
    );
  });

  it('reads the seed templates with their records named by label', () => {
    const file = (name: string) =>
      readFileSync(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');
    const folder = new URL('../../../../seed/sops/own/', import.meta.url);
    const sops = readSeedSops(
      readdirSync(folder)
        .filter((n) => n.endsWith('.md'))
        .map((name) => ({ name, text: readFileSync(new URL(name, folder), 'utf8') })),
      {
        labware: file('labware.yaml'),
        reagentLibrary: file('reagent-library.yaml'),
        entityLibrary: file('entity-library.yaml'),
        instrumentLibrary: file('instrument-library.yaml'),
      },
    );
    const templates = readSeedAssayTemplates(file('assay-templates.yaml'), {
      sops: new Map(sops.map((s) => [s.key, s.label])),
      layouts: file('layouts.yaml'),
      labware: file('labware.yaml'),
      instrumentLibrary: file('instrument-library.yaml'),
    });
    expect(templates.map((t) => t.label)).toEqual([
      'IL-6 sandwich ELISA',
      'Compound single-point viability screen',
      'Compound dose-response (CellTiter-Glo or HiBiT)',
      'Alkaline phosphatase kinetic screen (pNPP)',
      'Dual-Glo reporter gene expression',
    ]);
    expect(templates[0]).toMatchObject({
      sops: [{ part: 'assay', label: 'Human IL-6 sandwich ELISA (DuoSet), 96-well' }],
      layout: 'IL-6 ELISA, 96 wells',
      preferred: [
        { role: 0, labels: ['Tecan Spark Cyto'] },
        { role: 1, labels: ['BlueCatBio BlueWasher'] },
      ],
      records: [{ role: 2, kind: 'labware_type' }],
    });
    // Every role is a material of its part's SOP, and every variable asked for is one the SOP has.
    for (const t of templates) {
      const sopOf = (part: string) => {
        const label = t.sops.find((s) => s.part === part)?.label;
        return sops.find((s) => s.label === label)?.attributes;
      };
      const a = t.attributes as {
        roles: { part: string; role: string }[];
        essentials: { input: string; part?: string; variable?: string }[];
      };
      for (const r of a.roles)
        expect(
          sopOf(r.part)?.materials.map((m) => m.role),
          `${t.key} ${r.role}`,
        ).toContain(r.role);
      for (const e of a.essentials.filter((e) => e.input === 'variable'))
        expect(
          sopOf(e.part as string)?.variables.find((v) => v.name === e.variable)?.kind,
          `${t.key} ${e.variable}`,
        ).toMatch(/^(input|default)$/);
      const { roles: _, ...rest } = t.attributes;
      expect(
        AssayTemplateAttributes.omit({ parts: true, layout: true, roles: true }).safeParse(rest)
          .error,
        t.key,
      ).toBeUndefined();
    }
  });
});

describe('designer.start', () => {
  async function ready() {
    const { template } = await setup();
    const saved = await confirm(await run(agent, 'assays.draft_template', template));
    const campaign = await confirm(
      await run(agent, 'campaigns.draft', {
        label: 'IL-6 in supernatants',
        goal: 'Measure IL-6 after stimulation',
        aims: [{ id: 'aim_1', text: 'Measure IL-6', success: 'Every sample read' }],
      }),
    );
    const kind = await run(agent, 'entities.draft_kind', {
      label: 'Supernatant',
      attributes: { base: 'other', prefix: 'SUP', fields: [] },
    });
    const samples: RecordEnvelope[] = [];
    for (const n of [1, 2, 3])
      samples.push(
        await run(agent, 'entities.draft', { label: `Supernatant ${n}`, entityKind: kind.id }),
      );
    return { saved, campaign, samples };
  }

  it('drafts the experiment and its plate map from a confirmed template in one step', async () => {
    const { saved, campaign, samples } = await ready();
    const result = await run<{
      experiment: RecordEnvelope;
      plateMap?: RecordEnvelope;
      totals?: Record<string, number>;
      lines: string[];
    }>(agent, 'designer.start', {
      template: saved.id,
      campaign: campaign.id,
      aim: 'aim_1',
      answers: { samples: samples.map((s) => s.id), dilution: '10' },
    });
    const e = result.experiment;
    expect(e).toMatchObject({
      kind: 'experiment',
      status: 'draft',
      label: 'IL-6 ELISA: 3 subjects',
    });
    expect(e.attributes).toMatchObject({
      question: 'IL-6 in supernatants',
      template: { id: saved.id, version: saved.version },
      subjects: samples.map((s) => ({ record: s.id })),
      protocol: [{ id: 'assay', inputs: [{ name: 'sample_dilution', value: '10' }] }],
      conditions: [
        { id: 'sample', label: 'Sample', text: 'Supernatant 1, Supernatant 2, Supernatant 3' },
      ],
      controls: [
        { id: 'std', role: 'standard', text: '14 wells per plate; Curve' },
        { id: 'blank', role: 'blank' },
      ],
      readouts: [{ id: 'od', label: 'Absorbance 450 nm', text: 'read absorbance' }],
    });
    expect(e.evidence?.question).toMatchObject({ source: 'assumed' });
    expect(e.evidence?.protocol).toMatchObject({ source: 'template', from: { id: saved.id } });
    expect(result.plateMap).toMatchObject({ kind: 'plate_map', status: 'draft' });
    // Values the designer set are sourced, not marked as an agent's guesses.
    expect(e.evidence?.template).toMatchObject({ source: 'template', from: { id: saved.id } });
    expect(result.plateMap?.evidence).toMatchObject({
      layout: { source: 'template', from: { id: saved.id, path: '/layout' } },
      experiment: { source: 'record', from: { id: e.id, version: e.version } },
    });
    const mapReadiness = await run<Readiness>(person, 'records.readiness', {
      id: result.plateMap?.id,
    });
    expect(mapReadiness.assumed).not.toContain('layout');
    expect(mapReadiness.assumed).not.toContain('experiment');
    expect(result.plateMap?.attributes).toMatchObject({
      experiment: e.id,
      subjects: samples.map((s) => ({ record: s.id })),
    });
    expect(result.totals).toEqual({ conditions: 3, plates: 1, totalPlates: 1, totalWells: 22 });
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      {
        id: e.id,
        direction: 'from',
      },
    );
    expect(links.links).toContainEqual(
      expect.objectContaining({ relation: 'from_template', toId: saved.id }),
    );

    // Planning waits on the plate map, and says where to confirm it.
    const check = await run(person, 'experiments.plan_check', { id: e.id });
    expect(check).toEqual({
      ready: false,
      blockers: [
        {
          message: `Plate map ${result.plateMap?.label} (${result.plateMap?.name}) is a draft; confirm it first`,
          record: result.plateMap?.id,
        },
      ],
    });
  });

  it('asks for what is missing, and refuses a draft template and another lab', async () => {
    const { saved, campaign, samples } = await ready();
    expect(
      (
        await refused(
          run(agent, 'designer.start', {
            template: saved.id,
            campaign: campaign.id,
            answers: { samples: samples.map((s) => s.id) },
          }),
        )
      ).message,
    ).toBe('Still needed: Sample dilution');
    // A ratio is refused by the input's own label, asking for the fold (UX review 2026-10-02, #19).
    const ratio = await refused(
      run(agent, 'designer.start', {
        template: saved.id,
        campaign: campaign.id,
        answers: { samples: samples.map((s) => s.id), dilution: '1:4' },
      }),
    );
    expect(ratio).toMatchObject({ code: 'invalid_input' });
    expect(ratio.message).toBe(
      'Sample dilution: give one number, not "1:4"; for a dilution, give the fold (4 for 4-fold)',
    );
    const { template } = await setup();
    const draft = await run(agent, 'assays.draft_template', { ...template, label: 'Draft ELISA' });
    expect(
      (
        await refused(
          run(agent, 'designer.start', {
            template: draft.id,
            campaign: campaign.id,
            answers: { samples: 3, dilution: '10' },
          }),
        )
      ).message,
    ).toContain('is not confirmed');
    expect(
      (
        await refused(
          run(otherLab, 'designer.start', {
            template: saved.id,
            campaign: campaign.id,
            answers: { samples: 3, dilution: '10' },
          }),
        )
      ).code,
    ).toBe('not_found');
  });

  it('drafts the experiment without a plate map when only a count of subjects is given', async () => {
    const { saved, campaign } = await ready();
    const result = await run<{ plateMap?: RecordEnvelope; lines: string[] }>(
      agent,
      'designer.start',
      {
        template: saved.id,
        campaign: campaign.id,
        label: 'ELISA, 40 supernatants',
        question: 'How much IL-6 do the stimulated cells release?',
        answers: { samples: 40, dilution: '10' },
      },
    );
    expect(result.plateMap).toBeUndefined();
    expect(result.lines).toContain('No plate map yet: give the subjects as records to place them');
  });
});

describe('designer.feasibility', () => {
  it('names the instruments that can do each step, the totals and what does not work out', async () => {
    const { template, reader } = await setup();
    const saved = await confirm(await run(agent, 'assays.draft_template', template));
    const campaign = await confirm(
      await run(agent, 'campaigns.draft', {
        label: 'IL-6',
        goal: 'Measure IL-6',
        aims: [{ id: 'aim_1', text: 'Measure IL-6', success: 'Every sample read' }],
      }),
    );
    const { experiment } = await run<{ experiment: RecordEnvelope }>(agent, 'designer.start', {
      template: saved.id,
      campaign: campaign.id,
      answers: { samples: 40, dilution: '10' },
    });
    type Feasibility = {
      needs: {
        capability: string;
        verdict: string;
        instruments: { label: string; preferred: boolean }[];
      }[];
      totals?: Record<string, number>;
      feasible: boolean;
      lines: string[];
    };
    const none = await run<Feasibility>(agent, 'designer.feasibility', {
      experiment: experiment.id,
    });
    expect(none.needs).toEqual([
      expect.objectContaining({
        capability: 'read_absorbance',
        verdict: 'missing',
        instruments: [],
      }),
    ]);
    expect(none.feasible).toBe(false);
    expect(none.lines[0]).toBe('No instrument in the lab can read absorbance on 96-well plates');

    await run(agent, 'instruments.register', { label: 'Spark 1', kind: reader.id });
    const found = await run<Feasibility>(agent, 'designer.feasibility', {
      experiment: experiment.id,
    });
    expect(found.needs[0]).toMatchObject({
      verdict: 'ready',
      instruments: [expect.objectContaining({ label: 'Spark 1', preferred: true })],
    });
    expect(found.totals).toBeUndefined();
    expect(found.lines).toContain('Plates and wells wait for the subjects, given as records');
    expect(found.lines[0]).toBe('Read absorbance: Spark 1 INS-0001');

    expect(
      (await refused(run(otherLab, 'designer.feasibility', { experiment: experiment.id }))).code,
    ).toBe('not_found');
  });
  it('saves a confirmed experiment as a template that designs the same way', async () => {
    const { template, reader, sop } = await setup();
    const saved = await confirm(await run(agent, 'assays.draft_template', template));
    const campaign = await confirm(
      await run(agent, 'campaigns.draft', {
        label: 'IL-6',
        goal: 'Measure IL-6',
        aims: [{ id: 'aim_1', text: 'Measure IL-6', success: 'Every sample read' }],
      }),
    );
    const start = () =>
      run<{ experiment: RecordEnvelope }>(agent, 'designer.start', {
        template: saved.id,
        campaign: campaign.id,
        answers: { samples: 40, dilution: '10' },
      });
    const { experiment: drafted } = await start();
    const spark = await run(agent, 'instruments.register', { label: 'Spark 1', kind: reader.id });
    const a = drafted.attributes as ExperimentAttributes;
    const step = a.protocol[0] as ExperimentAttributes['protocol'][number];
    const edited = await run(person, 'records.update', {
      id: drafted.id,
      expectedVersion: drafted.version,
      attributes: {
        ...a,
        protocol: [
          {
            ...step,
            bindings: [{ role: 'reader', record: spark.id }],
            inputs: [
              ...(step.inputs ?? []),
              { name: 'well_volume', value: { value: '50', unit: 'uL' } },
            ],
          },
        ],
      },
    });
    const experiment = await confirm(edited);

    const { template: copy, lines } = await run<{ template: RecordEnvelope; lines: string[] }>(
      agent,
      'assays.save_from_experiment',
      { experiment: experiment.id, label: 'IL-6 ELISA, 50 µL wells' },
    );
    expect(copy).toMatchObject({ kind: 'assay_template', status: 'draft' });
    expect(copy.attributes).toMatchObject({
      purpose: 'IL-6 in supernatants',
      parts: [
        {
          id: 'assay',
          sop: { id: sop.id, version: sop.version },
          inputs: [{ name: 'well_volume', value: { value: '50', unit: 'uL' } }],
        },
      ],
      roles: [{ role: 'reader', preferred: [spark.id, reader.id] }],
      essentials: template.essentials,
      replicates: template.replicates,
      layout: template.layout,
    });
    expect(copy.evidence?.parts).toMatchObject({
      source: 'record',
      from: { id: experiment.id, version: experiment.version },
    });
    expect(copy.evidence?.essentials).toMatchObject({ source: 'template' });
    expect(lines).toContain('Parts: 1 SOP at the versions it used, keeping well_volume');

    // Designing from the saved template sets the kept value again.
    const confirmed = await confirm(copy);
    const again = await run<{ experiment: RecordEnvelope }>(agent, 'designer.start', {
      template: confirmed.id,
      campaign: campaign.id,
      answers: { samples: 8, dilution: '2' },
    });
    expect((again.experiment.attributes as ExperimentAttributes).protocol[0]?.inputs).toEqual([
      { name: 'well_volume', value: { value: '50', unit: 'uL' } },
      { name: 'sample_dilution', value: '2' },
    ]);

    const { experiment: draft } = await start();
    expect(
      (
        await refused(
          run(agent, 'assays.save_from_experiment', { experiment: draft.id, label: 'X' }),
        )
      ).message,
    ).toContain('is not confirmed');
    expect(
      (
        await refused(
          run(otherLab, 'assays.save_from_experiment', { experiment: experiment.id, label: 'X' }),
        )
      ).code,
    ).toBe('not_found');
  });
  it('checks the amounts an SOP draws from a material against stock on hand', async () => {
    const { template, layout } = await setup();
    const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
      label: 'Detection antibody',
      attributes: { category: 'antibody', origin: 'bought' },
    });
    const lot = await run(person, 'reagents.receive_lot', { product: product.id, lotNumber: 'L1' });
    const sop = await confirm(
      await run(agent, 'sops.draft', {
        ...elisaSop,
        label: 'IL-6 ELISA with detection',
        materials: [
          ...elisaSop.materials,
          { role: 'detection', label: 'Detection antibody', type: 'reagent' },
        ],
        variables: [
          ...elisaSop.variables,
          {
            name: 'detection_volume',
            label: 'Detection antibody for the run',
            kind: 'default',
            value: { value: '1.5', unit: 'mL' },
            drawsFrom: 'detection',
          },
        ],
      }),
    );
    expect(
      (
        await refused(
          run(agent, 'sops.draft', {
            ...elisaSop,
            label: 'Wrong',
            variables: [
              {
                name: 'v',
                label: 'V',
                kind: 'default',
                value: { value: '1', unit: 'mL' },
                drawsFrom: 'nope',
              },
            ],
          }),
        )
      ).message,
    ).toContain('v is drawn from nope, which is not a material');
    const saved = await confirm(
      await run(agent, 'assays.draft_template', {
        ...template,
        parts: [{ id: 'assay', sop: { id: sop.id, version: sop.version } }],
        layout: { id: layout.id, version: layout.version },
        roles: [{ part: 'assay', role: 'detection', record: lot.id }],
      }),
    );
    const campaign = await confirm(
      await run(agent, 'campaigns.draft', {
        label: 'IL-6',
        goal: 'Measure IL-6',
        aims: [{ id: 'aim_1', text: 'Measure IL-6', success: 'Every sample read' }],
      }),
    );
    const { experiment } = await run<{ experiment: RecordEnvelope }>(agent, 'designer.start', {
      template: saved.id,
      campaign: campaign.id,
      answers: { samples: 8, dilution: '2' },
    });
    type Feasibility = {
      stock: { verdict: string; needed?: unknown; available?: unknown; short?: unknown }[];
      feasible: boolean;
      lines: string[];
    };
    const check = () =>
      run<Feasibility>(agent, 'designer.feasibility', { experiment: experiment.id });

    const none = await check();
    expect(none.stock).toEqual([
      expect.objectContaining({
        part: 'assay',
        variable: 'detection_volume',
        role: 'detection',
        record: expect.objectContaining({ id: lot.id }),
        verdict: 'short',
        needed: { value: '1.5', unit: 'mL' },
        short: { value: '1.5', unit: 'mL' },
      }),
    ]);
    expect(none.feasible).toBe(false);
    expect(none.lines).toContain(
      `Stock of Detection antibody, lot L1 ${lot.name}: needs 1.5 mL, none available; 1.5 mL short`,
    );

    const tubeType = await run(person, 'records.create', {
      kind: 'labware_type',
      label: 'Tube 1.5 mL',
      attributes: { family: 'tube', maxVolume: { value: '1.5', unit: 'mL' } },
    });
    const { containers } = await run<{ containers: RecordEnvelope[] }>(
      person,
      'inventory.register_containers',
      { labwareType: tubeType.id, containers: [{}, {}] },
    );
    for (const tube of containers)
      await run(person, 'inventory.fill', {
        container: tube.id,
        fills: [
          {
            wells: ['A1'],
            volume: { value: '1000', unit: 'uL' },
            components: [{ source: lot.id }],
          },
        ],
      });
    const enough = await check();
    expect(enough.stock[0]).toMatchObject({
      verdict: 'enough',
      holds: { value: '2', unit: 'mL' },
      available: { value: '2', unit: 'mL' },
    });
    expect(enough.lines).toContain(
      `Stock of Detection antibody, lot L1 ${lot.name}: needs 1.5 mL, 2 mL available`,
    );
  });
});

import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { campaignKinds } from './kinds.ts';

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
    ...reagentKinds,
    ...entityKinds,
    ...fileKinds,
    ...libraryKinds,
    ...sopKinds,
    ...campaignKinds,
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

/** A person confirms every section of a draft, which activates it. */
async function confirm(record: RecordEnvelope): Promise<RecordEnvelope> {
  let current = record;
  for (const section of kinds.get(record.kind).sections ?? []) {
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  return current;
}

const coating = {
  label: 'Plate coating',
  materials: [{ role: 'plate', label: 'Coating plate', type: 'labware' }],
  variables: [
    {
      name: 'well_volume',
      label: 'Well volume',
      kind: 'default',
      value: { value: '100', unit: 'uL' },
    },
  ],
  steps: [
    {
      id: 'coat',
      action: 'add',
      text: 'Add coating solution to every well.',
      uses: ['plate'],
      parameters: [{ name: 'volume', variable: 'well_volume' }],
    },
  ],
};

async function confirmedSop() {
  return confirm(await run(agent, 'sops.draft', coating));
}

async function activeCampaign() {
  return confirm(
    await run(agent, 'campaigns.draft', {
      label: 'IL-6 reporter panel',
      goal: 'Find which stimuli raise IL-6 in THP-1 cells',
      aims: [
        { id: 'aim_1', text: 'Rank ten stimuli', success: 'Three with a fold change above 2' },
      ],
    }),
  );
}

describe('campaigns', () => {
  it('drafts a campaign as proposed; it becomes active once a person confirmed it', async () => {
    const draft = await run(agent, 'campaigns.draft', {
      label: 'BRD4 degraders',
      goal: 'Find degraders of BRD4',
    });
    expect(draft).toMatchObject({ name: 'CAM-001', status: 'draft' });
    expect(draft.attributes).toMatchObject({ stage: 'proposed', aims: [] });
    const readiness = await run<Readiness>(person, 'records.readiness', { id: draft.id });
    expect(readiness.checks.find((c) => c.id === 'has_aims')?.passed).toBe(false);

    await expect(
      registry.execute(person, 'campaigns.set_stage', {
        id: draft.id,
        expectedVersion: draft.version,
        stage: 'active',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    const campaign = await activeCampaign();
    const active = await run(person, 'campaigns.set_stage', {
      id: campaign.id,
      expectedVersion: campaign.version,
      stage: 'active',
    });
    expect(active.attributes).toMatchObject({ stage: 'active' });
    // An agent's stage change waits for a person.
    const proposed = await registry.execute(agent, 'campaigns.set_stage', {
      id: campaign.id,
      expectedVersion: active.version,
      stage: 'paused',
    });
    expect(proposed.status).toBe('proposed');
  });

  it('refuses aims named twice, dates the wrong way round and a missing reference', async () => {
    const draft = (input: object) =>
      registry.execute(agent, 'campaigns.draft', { label: 'X', goal: 'Y', ...input });
    await expect(
      draft({
        aims: [
          { id: 'a', text: 'One' },
          { id: 'a', text: 'Two' },
        ],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('The aim a is named twice') });
    await expect(draft({ starts: '2026-10-02', ends: '2026-10-01' })).rejects.toMatchObject({
      message: expect.stringContaining('It ends before it starts'),
    });
    await expect(draft({ references: ['doc_01J9Z3K8Q4ABCDEFGHJKMNPQRS'] })).rejects.toMatchObject({
      code: 'invalid_attributes',
    });
    await expect(draft({ stage: 'active' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('experiments pin the SOP versions they follow (ADR 0039)', () => {
  it('pins a confirmed SOP version, flags a newer one and adopts it on request', async () => {
    const campaign = await activeCampaign();
    const sop = await confirmedSop();
    const experiment = await run(agent, 'experiments.draft', {
      label: 'Stimulus panel, day 1',
      campaign: campaign.id,
      aim: 'aim_1',
      question: 'Which stimuli raise IL-6?',
      hypotheses: [
        {
          id: 'lps',
          statement: 'LPS raises IL-6 the most',
          prediction: {
            readout: 'il6',
            measure: 'fold change',
            comparison: '>',
            threshold: '2',
          },
        },
      ],
      protocol: [{ id: 'coating', sop: { id: sop.id, version: sop.version } }],
      readouts: [{ id: 'il6', label: 'IL-6 by ELISA' }],
    });
    expect(experiment).toMatchObject({ name: 'EXP-0001', status: 'draft' });
    expect(experiment.attributes).toMatchObject({ stage: 'designing' });
    const links = await run(person, 'records.links', { id: experiment.id, direction: 'from' });
    expect(JSON.stringify(links)).toContain('"follows"');

    let readiness = await run<Readiness>(person, 'records.readiness', { id: experiment.id });
    const byId = (id: string) => readiness.checks.find((c) => c.id === id);
    expect(byId('has_protocol')?.passed).toBe(true);
    expect(byId('protocol_confirmed')?.passed).toBe(true);
    expect(byId('protocol_current')?.passed).toBe(true);

    // A person changes the SOP: the experiment keeps v-pinned values and says a newer one exists.
    const edited = await run(person, 'records.update', {
      id: sop.id,
      expectedVersion: sop.version,
      attributes: {
        ...sop.attributes,
        variables: [
          {
            name: 'well_volume',
            label: 'Well volume',
            kind: 'default',
            value: { value: '50', unit: 'uL' },
          },
        ],
      },
    });
    expect(edited.status).toBe('active');
    readiness = await run<Readiness>(person, 'records.readiness', { id: experiment.id });
    expect(byId('protocol_current')).toMatchObject({
      passed: false,
      message: expect.stringContaining(`${sop.name} v${edited.version}`),
      quickFix: { operation: 'experiments.adopt_versions' },
    });
    const current = await run(person, 'records.get', { id: experiment.id });
    const adopted = await run(agent, 'experiments.adopt_versions', {
      id: experiment.id,
      expectedVersion: current.version,
    });
    expect(adopted.attributes).toMatchObject({
      protocol: [{ id: 'coating', sop: { id: sop.id, version: edited.version } }],
    });
    await expect(
      registry.execute(agent, 'experiments.adopt_versions', {
        id: experiment.id,
        expectedVersion: adopted.version,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('already follows') });
  });

  it('refuses a pin to a version that does not exist, another kind, or another lab; an unconfirmed version blocks', async () => {
    const campaign = await activeCampaign();
    const draftSop = await run(agent, 'sops.draft', coating);
    const draft = (protocol: unknown[], ctx = agent) =>
      registry.execute(ctx, 'experiments.draft', {
        label: 'X',
        campaign: campaign.id,
        question: 'Q?',
        protocol,
      });
    await expect(draft([{ id: 'a', sop: { id: draftSop.id, version: 9 } }])).rejects.toMatchObject({
      message: expect.stringContaining(`${draftSop.name} has no version 9`),
    });
    await expect(draft([{ id: 'a', sop: { id: campaign.id, version: 1 } }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      draft([{ id: 'a', sop: { id: draftSop.id, version: 1 } }], otherLab),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
    await expect(
      registry.execute(agent, 'experiments.draft', {
        label: 'X',
        campaign: campaign.id,
        aim: 'aim_9',
        question: 'Q?',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has no aim aim_9') });

    const unconfirmed = (await draft([{ id: 'a', sop: { id: draftSop.id, version: 1 } }])) as {
      output: RecordEnvelope;
    };
    const readiness = await run<Readiness>(person, 'records.readiness', {
      id: unconfirmed.output.id,
    });
    expect(readiness.checks.find((c) => c.id === 'protocol_confirmed')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
  });
});

describe('experiment stages and runs', () => {
  it('plans only a confirmed, ready design; runs pin the design version; where_used finds them', async () => {
    const campaign = await activeCampaign();
    const sop = await confirmedSop();
    const experiment = await run(agent, 'experiments.draft', {
      label: 'Stimulus panel',
      campaign: campaign.id,
      question: 'Which stimuli raise IL-6?',
      protocol: [{ id: 'coating', sop: { id: sop.id, version: sop.version } }],
    });
    await expect(
      registry.execute(person, 'experiments.set_stage', {
        id: experiment.id,
        expectedVersion: experiment.version,
        stage: 'planned',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      registry.execute(person, 'experiments.set_stage', {
        id: experiment.id,
        expectedVersion: experiment.version,
        stage: 'concluded',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('it can move to planned, on hold, cancelled'),
    });

    const confirmed = await confirm(experiment);
    expect(confirmed.status).toBe('active');
    const proposal = await registry.execute(agent, 'experiments.set_stage', {
      id: confirmed.id,
      expectedVersion: confirmed.version,
      stage: 'planned',
    });
    expect(proposal.status).toBe('proposed');
    const planned = await run(person, 'experiments.set_stage', {
      id: confirmed.id,
      expectedVersion: confirmed.version,
      stage: 'planned',
    });
    expect(planned.attributes).toMatchObject({ stage: 'planned' });

    const day1 = await run(person, 'runs.start', {
      experiment: planned.id,
      label: 'Day 1',
      date: '2026-10-01',
    });
    expect(day1.name).toBe('RUN-0001');
    expect(day1.attributes).toMatchObject({
      experiment: { id: planned.id, version: planned.version },
    });
    await expect(
      registry.execute(person, 'records.create', {
        kind: 'run',
        label: 'Day 0',
        attributes: { experiment: { id: planned.id, version: 1 }, status: 'scheduled' },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('created with runs.start') });

    const bySop = await run<{
      experiments: { name: string; how: string }[];
      runs: { name: string; how: string }[];
    }>(agent, 'experiments.where_used', { record: sop.id, version: sop.version });
    expect(bySop.experiments).toEqual([
      expect.objectContaining({ name: planned.name, how: `follows v${sop.version}` }),
    ]);
    expect(bySop.runs).toEqual([
      expect.objectContaining({
        name: 'RUN-0001',
        how: expect.stringContaining(`follows v${sop.version}`),
      }),
    ]);
    const other = await run<{ experiments: unknown[]; runs: unknown[] }>(
      agent,
      'experiments.where_used',
      { record: sop.id, version: sop.version + 5 },
    );
    expect(other).toMatchObject({ experiments: [], runs: [] });
    const byCampaign = await run<{ experiments: { how: string }[] }>(
      person,
      'experiments.where_used',
      { record: campaign.id },
    );
    expect(byCampaign.experiments).toEqual([expect.objectContaining({ how: 'part of it' })]);
    await expect(
      registry.execute(otherLab, 'experiments.where_used', { record: sop.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('binding the protocol (013b)', () => {
  const q = (value: string, unit: string) => ({ value, unit });
  async function lab() {
    const product = await run(person, 'records.create', {
      kind: 'product',
      label: 'IL-6 capture antibody',
      status: 'active',
      attributes: {
        category: 'antibody',
        origin: 'bought',
        lotFields: [
          {
            key: 'workingConcentration',
            label: 'Working concentration',
            unit: 'ug/mL',
            typical: q('2', 'ug/mL'),
          },
        ],
      },
    });
    const lot = await run(person, 'records.create', {
      kind: 'lot',
      label: 'Lot 1234',
      status: 'active',
      attributes: {
        product: product.id,
        lotNumber: '1234',
        status: 'unopened',
        values: [{ field: 'workingConcentration', value: q('4', 'ug/mL') }],
      },
    });
    const plate = await run(person, 'records.create', {
      kind: 'labware_type',
      label: 'High-bind 96',
      attributes: { family: 'plate', deadVolume: q('10', 'uL') },
    });
    const sop = await confirm(
      await run(agent, 'sops.draft', {
        label: 'Coating',
        materials: [
          { role: 'capture_ab', label: 'Capture antibody', type: 'reagent', default: product.id },
          { role: 'plate', label: 'Plate', type: 'labware', default: plate.id },
        ],
        variables: [
          { name: 'wells', label: 'Wells', kind: 'input' },
          { name: 'well_volume', label: 'Well volume', kind: 'default', value: q('100', 'uL') },
          {
            name: 'capture_conc',
            label: 'Capture antibody working concentration',
            kind: 'record',
            value: q('1', 'ug/mL'),
            readFrom: { role: 'capture_ab', field: 'workingConcentration' },
          },
          {
            name: 'dead',
            label: 'Dead volume',
            kind: 'record',
            readFrom: { role: 'plate', field: 'deadVolume' },
          },
          {
            name: 'coating',
            label: 'Coating solution',
            kind: 'computed',
            expression: 'wells * (well_volume + dead)',
            unit: 'mL',
          },
        ],
        steps: [{ id: 'coat', action: 'add', text: 'Coat.', uses: ['plate', 'capture_ab'] }],
      }),
    );
    const campaign = await activeCampaign();
    const experiment = await run(agent, 'experiments.draft', {
      label: 'Coating check',
      campaign: campaign.id,
      question: 'Does the new lot coat as well?',
      protocol: [{ id: 'coating', sop: { id: sop.id, version: sop.version } }],
      readouts: [{ id: 'od', label: 'Absorbance at 450 nm' }],
    });
    return { product, lot, plate, sop, experiment };
  }
  type Calculated = {
    parts: {
      variables: { name: string; quantity?: { value: string; unit: string }; from: string }[];
      problems: string[];
    }[];
    ready: boolean;
  };
  const value = (c: Calculated, name: string) => c.parts[0]?.variables.find((v) => v.name === name);

  it('binds roles at pinned versions and inputs, and works the run out from what is pinned', async () => {
    const { lot, experiment } = await lab();
    let calc = await run<Calculated>(agent, 'experiments.calculate', { id: experiment.id });
    expect(calc.ready).toBe(false);
    expect(calc.parts[0]?.problems.join()).toContain('wells');

    const bound = await run(agent, 'experiments.bind_protocol', {
      id: experiment.id,
      expectedVersion: experiment.version,
      part: 'coating',
      bindings: [{ role: 'capture_ab', record: lot.id, version: lot.version }],
      inputs: [{ name: 'wells', value: '48' }],
    });
    calc = await run<Calculated>(person, 'experiments.calculate', { id: experiment.id });
    expect(calc.ready).toBe(true);
    expect(value(calc, 'capture_conc')).toMatchObject({
      quantity: q('4', 'ug/mL'),
      from: 'record',
    });
    expect(value(calc, 'coating')?.quantity).toMatchObject({ unit: 'mL', value: '5.28' });

    // The lot's certificate changes: the experiment keeps what it pinned until someone adopts.
    const relabelled = await run(person, 'records.update', {
      id: lot.id,
      expectedVersion: lot.version,
      attributes: {
        ...lot.attributes,
        values: [{ field: 'workingConcentration', value: q('5', 'ug/mL') }],
      },
    });
    calc = await run<Calculated>(person, 'experiments.calculate', { id: experiment.id });
    expect(value(calc, 'capture_conc')?.quantity).toMatchObject(q('4', 'ug/mL'));
    const readiness = await run<Readiness>(person, 'records.readiness', { id: experiment.id });
    expect(readiness.checks.find((c) => c.id === 'protocol_current')?.message).toContain(
      `${lot.name} v${relabelled.version}`,
    );
    const adopted = await run(agent, 'experiments.adopt_versions', {
      id: experiment.id,
      expectedVersion: bound.version,
    });
    expect(adopted.attributes).toMatchObject({
      protocol: [
        {
          bindings: [{ role: 'capture_ab', version: relabelled.version }],
          inputs: [{ name: 'wells' }],
        },
      ],
    });
    calc = await run<Calculated>(person, 'experiments.calculate', { id: experiment.id });
    expect(value(calc, 'capture_conc')?.quantity).toMatchObject(q('5', 'ug/mL'));

    // Unbinding goes back to the SOP's default, the product's typical value.
    const unbound = await run(agent, 'experiments.bind_protocol', {
      id: experiment.id,
      expectedVersion: adopted.version,
      part: 'coating',
      unbind: ['capture_ab'],
    });
    expect(
      (unbound.attributes as { protocol: { bindings?: unknown }[] }).protocol[0]?.bindings,
    ).toBeUndefined();
    calc = await run<Calculated>(person, 'experiments.calculate', { id: experiment.id });
    expect(value(calc, 'capture_conc')).toMatchObject({
      quantity: q('2', 'ug/mL'),
      from: 'typical',
    });
  });

  it('refuses unknown roles, parts and inputs, a definition bound without its version, and flags a misfit', async () => {
    const { lot, plate, experiment } = await lab();
    const bind = (input: object) =>
      registry.execute(agent, 'experiments.bind_protocol', {
        id: experiment.id,
        expectedVersion: experiment.version,
        part: 'coating',
        ...input,
      });
    await expect(bind({ part: 'washing' })).rejects.toMatchObject({
      message: expect.stringContaining('has no protocol part washing'),
    });
    await expect(
      bind({ bindings: [{ role: 'detection_ab', record: lot.id, version: 1 }] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('has no material detection_ab'),
    });
    await expect(
      bind({ bindings: [{ role: 'capture_ab', record: lot.id }] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('pin LOT'),
    });
    await expect(bind({ inputs: [{ name: 'coating', value: '3' }] })).rejects.toMatchObject({
      message: expect.stringContaining('worked out by a formula'),
    });
    await expect(bind({ inputs: [{ name: 'plates', value: '3' }] })).rejects.toMatchObject({
      message: expect.stringContaining('has no variable plates'),
    });
    await expect(bind({ inputs: [{ name: 'well_volume', value: '50' }] })).rejects.toMatchObject({
      message: expect.stringContaining('well_volume needs a unit'),
    });

    // A draft labware type: a misfit for the reagent role, and an unconfirmed pin.
    const misfit = await bind({
      bindings: [{ role: 'capture_ab', record: plate.id, version: plate.version }],
    });
    const id = (misfit as { output: RecordEnvelope }).output.id;
    const readiness = await run<Readiness>(person, 'records.readiness', { id });
    expect(readiness.checks.find((c) => c.id === 'bindings_fit')).toMatchObject({
      passed: false,
      severity: 'blocker',
    });
    expect(readiness.checks.find((c) => c.id === 'protocol_confirmed')?.passed).toBe(false);
  });

  it('plans only when the protocol works out', async () => {
    const { experiment } = await lab();
    const confirmed = await confirm(experiment);
    await expect(
      registry.execute(person, 'experiments.set_stage', {
        id: confirmed.id,
        expectedVersion: confirmed.version,
        stage: 'planned',
      }),
    ).rejects.toMatchObject({
      code: 'not_ready',
      message: expect.stringContaining('coating: wells'),
    });
    // On a confirmed experiment an agent's binding is a proposal; another lab can't read it.
    const proposed = await registry.execute(agent, 'experiments.bind_protocol', {
      id: confirmed.id,
      expectedVersion: confirmed.version,
      part: 'coating',
      inputs: [{ name: 'wells', value: '96' }],
    });
    expect(proposed.status).toBe('proposed');
    await expect(
      registry.execute(otherLab, 'experiments.calculate', { id: confirmed.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      registry.execute(person, 'sops.calculate', {
        sop: (confirmed.attributes as { protocol: { sop: { id: string } }[] }).protocol[0]?.sop.id,
        version: 99,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has no version 99') });
    const bound = await run(person, 'experiments.bind_protocol', {
      id: confirmed.id,
      expectedVersion: confirmed.version,
      part: 'coating',
      inputs: [{ name: 'wells', value: '96' }],
    });
    expect(bound.status).toBe('active');
    const reconfirmed = await run(person, 'records.confirm_section', {
      id: bound.id,
      expectedVersion: bound.version,
      section: 'protocol',
    });
    const planned = await run(person, 'experiments.set_stage', {
      id: bound.id,
      expectedVersion: reconfirmed.version,
      stage: 'planned',
    });
    expect(planned.attributes).toMatchObject({ stage: 'planned' });
  });
});

async function plannedExperiment() {
  const campaign = await activeCampaign();
  const sop = await confirm(
    await run(agent, 'sops.draft', {
      ...coating,
      steps: [
        { ...coating.steps[0], title: 'Coat' },
        { id: 'wash', action: 'wash', title: 'Wash', text: 'Wash the plate.', repeat: 3 },
      ],
    }),
  );
  const experiment = await confirm(
    await run(agent, 'experiments.draft', {
      label: 'Stimulus panel',
      campaign: campaign.id,
      question: 'Which stimuli raise IL-6?',
      hypotheses: [{ id: 'lps', statement: 'LPS raises IL-6' }],
      protocol: [{ id: 'coating', sop: { id: sop.id, version: sop.version } }],
    }),
  );
  return run(person, 'experiments.set_stage', {
    id: experiment.id,
    expectedVersion: experiment.version,
    stage: 'planned',
  });
}

describe('recording runs (013c)', () => {
  it('starts a run as a checklist of planned steps and records ticks, changes, skips, data and the finish', async () => {
    const experiment = await plannedExperiment();
    const started = await run(person, 'runs.start', { experiment: experiment.id });
    expect(started.status).toBe('active');
    expect(started.attributes).toMatchObject({
      status: 'in_progress',
      startedBy: person.actor,
      steps: [
        {
          part: 'coating',
          step: 'coat',
          title: 'Coat',
          planned: [{ name: 'volume', value: { value: '100', unit: 'uL' } }],
          status: 'pending',
        },
        { step: 'wash', planned: [{ name: 'times', value: '3' }], status: 'pending' },
      ],
    });
    const running = await run(person, 'records.get', { id: experiment.id });
    expect(running.attributes).toMatchObject({ stage: 'running' });

    await expect(
      registry.execute(person, 'runs.finish', {
        id: started.id,
        expectedVersion: started.version,
        status: 'done',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('2 steps are not ticked') });
    await expect(
      registry.execute(person, 'runs.record_step', {
        id: started.id,
        expectedVersion: started.version,
        part: 'coating',
        step: 'coat',
        changed: [{ name: 'volume', value: { value: '90', unit: 'uL' } }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(person, 'runs.record_step', {
        id: started.id,
        expectedVersion: started.version,
        part: 'coating',
        step: 'block',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('has no step block') });

    // An agent records into a run a person started directly.
    const changed = await registry.execute(agent, 'runs.record_step', {
      id: started.id,
      expectedVersion: started.version,
      part: 'coating',
      step: 'coat',
      changed: [{ name: 'volume', value: { value: '90', unit: 'uL' } }],
      why: 'Coating solution ran short',
    });
    if (changed.status !== 'done') throw new Error(`record_step was ${changed.status}`);
    const coated = changed.output as RecordEnvelope;
    expect(coated.attributes).toMatchObject({
      steps: [
        {
          status: 'done',
          by: agent.actor,
          actuals: [{ name: 'volume', value: { value: '90', unit: 'uL' } }],
          deviation: { what: 'volume 90 µL (planned 100 µL)', why: 'Coating solution ran short' },
        },
        { status: 'pending' },
      ],
    });
    const skipped = await run(person, 'runs.record_step', {
      id: coated.id,
      expectedVersion: coated.version,
      part: 'coating',
      step: 'wash',
      skipped: true,
      why: 'Washer down',
      impact: 'Higher background',
    });
    expect((skipped.attributes as { steps: unknown[] }).steps[1]).toMatchObject({
      status: 'skipped',
      deviation: { what: 'Skipped Wash', why: 'Washer down', impact: 'Higher background' },
    });
    await expect(
      registry.execute(person, 'runs.done_as_planned', {
        id: skipped.id,
        expectedVersion: skipped.version,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('already ticked') });

    const deviated = await run(person, 'runs.record_deviation', {
      id: skipped.id,
      expectedVersion: skipped.version,
      what: 'Plate left on the bench 40 min',
      why: 'Fire drill',
    });
    const { file } = await run<{ file: RecordEnvelope }>(person, 'files.upload', {
      name: 'reads.csv',
      mediaType: 'text/csv',
      text: 'well,od450\nA1,0.12\n',
    });
    await expect(
      registry.execute(person, 'runs.attach_data', {
        id: deviated.id,
        expectedVersion: deviated.version,
        file: file.id,
        part: 'coating',
      }),
    ).rejects.toMatchObject({ message: 'Give both the part and the step' });
    const attached = await run(person, 'runs.attach_data', {
      id: deviated.id,
      expectedVersion: deviated.version,
      file: file.id,
      part: 'coating',
      step: 'coat',
      note: 'Plate reader export',
    });
    expect(attached.attributes).toMatchObject({
      deviations: [{ what: 'Plate left on the bench 40 min', by: person.actor }],
      data: [{ file: file.id, part: 'coating', step: 'coat' }],
    });
    const links = await run<{ links: { toId: string; relation: string }[] }>(
      person,
      'records.links',
      { id: attached.id, direction: 'from' },
    );
    expect(links.links).toEqual(
      expect.arrayContaining([expect.objectContaining({ toId: file.id, relation: 'data' })]),
    );

    await expect(
      registry.execute(otherLab, 'runs.finish', {
        id: attached.id,
        expectedVersion: attached.version,
        status: 'done',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const finished = await run(person, 'runs.finish', {
      id: attached.id,
      expectedVersion: attached.version,
      status: 'done',
      note: 'Reads look fine',
    });
    expect(finished.attributes).toMatchObject({ status: 'done', notes: 'Reads look fine' });
    await expect(
      registry.execute(person, 'runs.record_deviation', {
        id: finished.id,
        expectedVersion: finished.version,
        what: 'Late note',
        why: 'Forgot',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('ticks the rest as planned; an agent start is a proposal; only planned experiments start', async () => {
    const campaign = await activeCampaign();
    const draft = await run(agent, 'experiments.draft', {
      label: 'Unplanned',
      campaign: campaign.id,
      question: 'Does it work?',
    });
    await expect(
      registry.execute(person, 'runs.start', { experiment: draft.id }),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    const experiment = await plannedExperiment();
    const proposal = await registry.execute(agent, 'runs.start', { experiment: experiment.id });
    expect(proposal.status).toBe('proposed');
    await expect(
      registry.execute(otherLab, 'runs.start', { experiment: experiment.id }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const started = await run(person, 'runs.start', { experiment: experiment.id });
    const done = await run(person, 'runs.done_as_planned', {
      id: started.id,
      expectedVersion: started.version,
    });
    expect((done.attributes as { steps: { status: string }[] }).steps.map((s) => s.status)).toEqual(
      ['done', 'done'],
    );
    const finished = await run(person, 'runs.finish', {
      id: done.id,
      expectedVersion: done.version,
      status: 'done',
    });
    expect(finished.attributes).toMatchObject({ status: 'done' });
  });
});

describe('conclusions and sets (013c)', () => {
  it('concludes from finished runs with a verdict per hypothesis, and hands hits on as a set', async () => {
    const experiment = await plannedExperiment();
    await expect(
      registry.execute(person, 'experiments.conclude', {
        id: experiment.id,
        expectedVersion: experiment.version,
        summary: 'Nothing yet',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const started = await run(person, 'runs.start', { experiment: experiment.id });
    const running = await run(person, 'records.get', { id: experiment.id });
    await expect(
      registry.execute(person, 'experiments.conclude', {
        id: running.id,
        expectedVersion: running.version,
        summary: 'Too early',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('still in progress') });
    const done = await run(person, 'runs.done_as_planned', {
      id: started.id,
      expectedVersion: started.version,
    });
    await run(person, 'runs.finish', {
      id: done.id,
      expectedVersion: done.version,
      status: 'done',
    });
    await expect(
      registry.execute(person, 'experiments.set_stage', {
        id: running.id,
        expectedVersion: running.version,
        stage: 'analysing',
      }),
    ).resolves.toMatchObject({ status: 'done' });
    const analysing = await run(person, 'records.get', { id: experiment.id });
    await expect(
      registry.execute(person, 'experiments.set_stage', {
        id: analysing.id,
        expectedVersion: analysing.version,
        stage: 'concluded',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('experiments.conclude') });
    await expect(
      registry.execute(person, 'experiments.conclude', {
        id: analysing.id,
        expectedVersion: analysing.version,
        summary: 'LPS raised IL-6 fourfold',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Give a verdict for lps') });
    await expect(
      registry.execute(person, 'experiments.conclude', {
        id: analysing.id,
        expectedVersion: analysing.version,
        summary: 'LPS raised IL-6 fourfold',
        verdicts: [
          { hypothesis: 'lps', verdict: 'supported' },
          { hypothesis: 'tnf', verdict: 'refuted' },
        ],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('There is no hypothesis tnf') });

    const proposal = await registry.execute(agent, 'experiments.conclude', {
      id: analysing.id,
      expectedVersion: analysing.version,
      summary: 'LPS raised IL-6 fourfold',
      verdicts: [{ hypothesis: 'lps', verdict: 'supported' }],
    });
    expect(proposal.status).toBe('proposed');
    const concluded = await run(person, 'experiments.conclude', {
      id: analysing.id,
      expectedVersion: analysing.version,
      summary: 'LPS raised IL-6 fourfold',
      verdicts: [
        {
          hypothesis: 'lps',
          verdict: 'supported',
          evidence: [{ record: started.id, note: 'Fold change 4.1' }],
        },
      ],
    });
    expect(concluded.attributes).toMatchObject({
      stage: 'concluded',
      conclusion: {
        summary: 'LPS raised IL-6 fourfold',
        runs: [started.id],
        by: person.actor,
        verdicts: [{ hypothesis: 'lps', verdict: 'supported' }],
      },
    });

    const kind = await run(agent, 'entities.draft_kind', {
      label: 'Stimulus',
      attributes: { base: 'chemical', prefix: 'STM', fields: [] },
    });
    const lps = await run(agent, 'entities.draft', { label: 'LPS', entityKind: kind.id });
    const tnf = await run(agent, 'entities.draft', { label: 'TNF-alpha', entityKind: kind.id });
    const setInput = {
      label: 'IL-6 inducers',
      members: [{ record: lps.id, note: 'Fold change 4.1' }, { record: tnf.id }],
      criterion: 'Fold change above 2',
      from: { experiment: concluded.id, run: started.id },
    };
    expect((await registry.execute(agent, 'sets.create', setInput)).status).toBe('proposed');
    await expect(
      registry.execute(person, 'sets.create', {
        ...setInput,
        members: [{ record: lps.id }, { record: lps.id }, { record: concluded.id }],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/is in the set twice[\s\S]*EXP-0001 is not an entity/),
    });
    await expect(
      registry.execute(person, 'records.create', { kind: 'set', label: 'x', attributes: setInput }),
    ).rejects.toMatchObject({ message: expect.stringContaining('created with sets.create') });
    const hits = await run(person, 'sets.create', setInput);
    expect(hits).toMatchObject({ kind: 'set', name: 'SET-001', status: 'active' });

    const campaign = (concluded.attributes as { campaign: string }).campaign;
    const followUp = await run(agent, 'experiments.draft', {
      label: 'Dose-response of the inducers',
      campaign,
      question: 'How potent are the inducers?',
      subjects: [{ record: hits.id }],
      followsUp: { experiment: concluded.id, relation: 'follows_up' },
      protocol: [],
    });
    const got = await run<{
      members: { name: string; label: string; note?: string }[];
      usedBy: { id: string }[];
    }>(agent, 'sets.get', { id: hits.id });
    expect(got.members).toEqual([
      expect.objectContaining({ label: 'LPS', note: 'Fold change 4.1' }),
      expect.objectContaining({ label: 'TNF-alpha' }),
    ]);
    expect(got.usedBy).toEqual([expect.objectContaining({ id: followUp.id })]);
    await expect(registry.execute(otherLab, 'sets.get', { id: hits.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

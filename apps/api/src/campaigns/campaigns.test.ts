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

    const day1 = await run(person, 'records.create', {
      kind: 'run',
      label: 'Day 1',
      status: 'active',
      attributes: {
        experiment: { id: planned.id, version: confirmed.version },
        status: 'scheduled',
        date: '2026-10-01',
      },
    });
    expect(day1.name).toBe('RUN-0001');
    await expect(
      registry.execute(person, 'records.create', {
        kind: 'run',
        label: 'Day 0',
        attributes: { experiment: { id: planned.id, version: 1 }, status: 'scheduled' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('a run follows a confirmed experiment design'),
    });

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

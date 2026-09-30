import { readdir, readFile } from 'node:fs/promises';
import type { Actor, ExperimentAttributes, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { fileKinds } from '../files/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { loadSeedSops, readSeedSops } from '../sops/seed.ts';
import { campaignKinds } from './kinds.ts';
import { loadSeedCampaigns, readSeedCampaigns } from './seed.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let loader: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  loader = {
    ...person,
    actor: { type: 'agent', agentName: 'Seed loader', onBehalfOf: tenant.userId },
  };
  const kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...entityKinds,
    ...fileKinds,
    ...libraryKinds,
    ...sopKinds,
    ...campaignKinds,
  ]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

const seed = (path: string) =>
  readFile(new URL(`../../../../seed/${path}`, import.meta.url), 'utf8');

async function seedSops() {
  const folder = new URL('../../../../seed/sops/own/', import.meta.url);
  const names = (await readdir(folder)).filter((n) => n.endsWith('.md')).sort();
  const files = await Promise.all(
    names.map(async (name) => ({ name, text: await readFile(new URL(name, folder), 'utf8') })),
  );
  return readSeedSops(files, {
    labware: await seed('labware.yaml'),
    reagentLibrary: await seed('reagent-library.yaml'),
    entityLibrary: await seed('entity-library.yaml'),
    instrumentLibrary: await seed('instrument-library.yaml'),
  });
}

async function seedCampaigns(sopLabels: Map<string, string>) {
  return readSeedCampaigns(
    {
      campaigns: await seed('campaigns.yaml'),
      assays: await seed('assays.yaml'),
      entityLibrary: await seed('entity-library.yaml'),
    },
    sopLabels,
  );
}

describe('the demo campaigns', () => {
  it('drafts each campaign with its experiments, pinned to the SOP versions the lab has, once', async () => {
    const sops = await seedSops();
    await loadSeedSops(registry, loader, sops, 'test');
    const campaigns = await seedCampaigns(new Map(sops.map((s) => [s.key, s.label])));
    const report = await loadSeedCampaigns(registry, loader, campaigns, 'test');
    expect(report.created).toHaveLength(6);
    expect(report.created[0]).toBe('CAM-001 BRD4 degrader screen');
    // The lab has no entities in this test, so subjects and controls are left out and reported.
    expect(report.missing).toContain('exp-brd4-single-point: 293 [HEK-293]');

    const list = await registry.execute(person, 'records.list', { kind: 'experiment' });
    const experiments = (list as { output: { records: RecordEnvelope[] } }).output.records;
    const doseResponse = experiments.find(
      (e) => e.label === 'HiBiT-BRD4 dose-response of the hits',
    );
    const singlePoint = experiments.find(
      (e) => e.label === 'Single-point viability screen at 10 µM',
    );
    const a = doseResponse?.attributes as ExperimentAttributes;
    expect(a).toMatchObject({
      stage: 'designing',
      aim: 'aim_potency',
      followsUp: { experiment: singlePoint?.id, relation: 'follows_up' },
    });
    expect(a.protocol.map((p) => p.id)).toEqual([
      'compound_screen',
      'cell_seeding_384',
      'celltiter_glo',
      'hibit_lytic',
    ]);
    expect(a.protocol.every((p) => p.sop.version === 1)).toBe(true);
    // The seed SOPs are drafts, so planning waits until a person confirms them.
    const readiness = (
      (await registry.execute(person, 'records.readiness', { id: doseResponse?.id })) as {
        output: Readiness;
      }
    ).output;
    expect(readiness.checks.find((c) => c.id === 'protocol_confirmed')?.passed).toBe(false);

    const again = await loadSeedCampaigns(registry, loader, campaigns, 'test');
    expect(again).toMatchObject({
      created: [],
      existing: ['BRD4 degrader screen', 'IL-6 reporter panel'],
    });
  });

  it('names what it cannot find in the seed files', async () => {
    await expect(seedCampaigns(new Map())).rejects.toThrow('no seed SOP sop-compound-screen');
  });
});

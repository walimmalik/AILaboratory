import { readFile } from 'node:fs/promises';
import type { Actor, ClassChoice, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { loadSeedInstruments, readSeedInstruments } from '../instruments/seed.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { loadSeedLabware, readDefinitions } from '../labware/seed.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { reagentKinds } from './kinds.ts';
import { loadSeedLiquidClasses, readSeedLiquidClasses } from './liquid-seed.ts';
import { loadSeedReagents, readSeedReagents } from './seed.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...instrumentKinds, ...reagentKinds]) kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
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

const create = (kind: string, label: string, attributes: unknown, status?: 'active') =>
  run<RecordEnvelope>(person, 'records.create', {
    kind,
    label,
    attributes,
    ...(status ? { status } : {}),
  });

const uL = (value: string) => ({ value, unit: 'uL' });

async function lab() {
  const flex = await create('instrument_kind', 'Opentrons Flex', {
    category: 'liquid_handler',
    performedBy: 'machine',
  });
  const p1000 = await create('equipment_kind', 'Flex 1-Channel 1000 uL', {
    role: 'pipette',
    fits: ['flex_pipette'],
    serialized: true,
  });
  const aqueous = await create('liquid_type', 'Aqueous', { base: 'aqueous' }, 'active');
  const glycerol = await create('liquid_type', 'Glycerol 50%', { base: 'glycerol' }, 'active');
  const dmso = await create('liquid_type', 'DMSO', { base: 'dmso' }, 'active');
  const cls = async (label: string, extra: Record<string, unknown>) => {
    const draft = await create('liquid_class', label, {
      instrumentKind: flex.id,
      device: p1000.id,
      volume: { min: uL('5'), max: uL('1000') },
      liquidTypes: [aqueous.id],
      labDefault: false,
      origin: 'vendor_default',
      settings: { platform: 'manual', technique: 'forward', preWet: false, speed: 'normal' },
      ...extra,
    });
    return draft;
  };
  return { flex, p1000, aqueous, glycerol, dmso, cls };
}

/** Confirms every section of a draft, which activates it. */
async function confirm(record: RecordEnvelope) {
  let version = record.version;
  for (const section of ['use', 'platform']) {
    const next = await run<RecordEnvelope>(person, 'records.confirm_section', {
      id: record.id,
      expectedVersion: version,
      section,
    });
    version = next.version;
  }
}

describe('liquids.resolve_class', () => {
  it("picks the lab default for a product's liquid type, then the product's own class", async () => {
    const { flex, p1000, aqueous, cls } = await lab();
    const water = await cls('Water', { labDefault: true, platformName: 'water' });
    const slow = await cls('Water, slow', {});
    await confirm(water);
    await confirm(slow);
    const { product } = await run<{ product: RecordEnvelope }>(person, 'reagents.draft_product', {
      label: 'PBS',
      attributes: { category: 'buffer', origin: 'bought', liquidType: aqueous.id },
    });
    const request = {
      liquid: { product: product.id },
      instrumentKind: flex.id,
      device: p1000.id,
      volume: uL('100'),
    };
    const choice = await run<ClassChoice>(agent, 'liquids.resolve_class', request);
    expect(choice).toMatchObject({ liquidClass: water.id, how: 'lab_default', verified: false });
    expect(choice.why).toBe(
      "The lab's default for Aqueous on this device and tip; not verified in this lab",
    );
    expect(choice.alternatives).toEqual([
      { liquidClass: slow.id, label: `Water, slow (${slow.name})` },
    ]);

    await run(person, 'records.update', {
      id: product.id,
      expectedVersion: product.version,
      attributes: { ...product.attributes, liquidClasses: [slow.id] },
    });
    expect(await run<ClassChoice>(agent, 'liquids.resolve_class', request)).toMatchObject({
      liquidClass: slow.id,
      how: 'product_override',
    });
  });

  it('uses confirmed classes only, and says what is missing', async () => {
    const { flex, p1000, glycerol, cls } = await lab();
    await cls('Glycerol', { labDefault: true, liquidTypes: [glycerol.id] });
    const choice = await run<ClassChoice>(agent, 'liquids.resolve_class', {
      liquid: { liquidType: glycerol.id },
      instrumentKind: flex.id,
      device: p1000.id,
      volume: uL('20'),
    });
    expect(choice.how).toBe('none');
    expect(choice.issue).toMatch(
      /^No validated class for Glycerol 50% on this device and tip at 20 µL; draft Glycerol \(LQC-\d+\) would fit once confirmed$/,
    );
  });

  it('refuses a liquid that is not a product or liquid type in this lab', async () => {
    const { flex, aqueous } = await lab();
    const wrong = await refused(
      run(agent, 'liquids.resolve_class', {
        liquid: { product: aqueous.id.replace('lqt_', 'prd_') },
        instrumentKind: flex.id,
        volume: uL('10'),
      }),
    );
    expect(wrong.message).toMatch(/^No product prd_/);
    const hidden = await refused(
      run(otherLab, 'liquids.resolve_class', {
        liquid: { liquidType: aqueous.id },
        instrumentKind: flex.id,
        volume: uL('10'),
      }),
    );
    expect(hidden.message).toMatch(/^No liquid type lqt_/);
  });
});

describe('liquids.mixture_type', () => {
  it('works out the type from the parts', async () => {
    const { aqueous, dmso } = await lab();
    const result = await run<{ label: string; why: string }>(agent, 'liquids.mixture_type', {
      parts: [
        { liquidType: aqueous.id, volume: uL('25') },
        { liquidType: dmso.id, volume: { value: '0.025', unit: 'uL' } },
      ],
    });
    expect(result).toMatchObject({ label: 'Aqueous' });
    const wrong = await refused(
      run(agent, 'liquids.mixture_type', {
        parts: [
          { liquidType: aqueous.id, volume: uL('25') },
          { liquidType: dmso.id, volume: { value: '1', unit: 'g' } },
        ],
      }),
    );
    expect(wrong).toMatchObject({ code: 'invalid_input' });
  });
});

describe('liquids.record_verification', () => {
  it('records a check, and a passing real one makes the class verified', async () => {
    const { flex, p1000, aqueous, cls } = await lab();
    const water = await cls('Water', { labDefault: true });
    await confirm(water);
    const check = {
      liquidClass: water.id,
      method: 'gravimetric',
      date: '2026-09-30',
      target: uL('10'),
      replicates: 10,
      mean: uL('10.2'),
      cv: '1.1',
      limits: { accuracy: '5', cv: '3' },
      demo: true,
    };
    const proposed = await registry.execute(agent, 'liquids.record_verification', check);
    expect(proposed.status).toBe('proposed');
    const demo = await run<{ result: { passed: boolean } }>(
      person,
      'liquids.record_verification',
      check,
    );
    expect(demo.result.passed).toBe(true);
    const request = {
      liquid: { liquidType: aqueous.id },
      instrumentKind: flex.id,
      device: p1000.id,
      volume: uL('10'),
    };
    expect((await run<ClassChoice>(agent, 'liquids.resolve_class', request)).verified).toBe(false);
    await run(person, 'liquids.record_verification', { ...check, demo: false });
    expect((await run<ClassChoice>(agent, 'liquids.resolve_class', request)).verified).toBe(true);

    const notAClass = await refused(
      run(person, 'liquids.record_verification', {
        ...check,
        liquidClass: aqueous.id.replace('lqt_', 'lqc_'),
      }),
    );
    expect(notAClass.message).toMatch(/^No liquid class lqc_/);
  });
});

describe('liquids.search_classes', () => {
  it('filters by liquid type, platform and verification, with the latest check', async () => {
    const { flex, aqueous, glycerol, cls } = await lab();
    const water = await cls('Water', { labDefault: true, platformName: 'water_default' });
    const thick = await cls('Glycerol', { liquidTypes: [glycerol.id] });
    await recordCheck(water.id, '2026-09-29', false);
    await recordCheck(water.id, '2026-09-30', true);
    type Found = {
      classes: { liquidClass: RecordEnvelope; verified: boolean; lastCheck?: unknown }[];
      total: number;
    };
    const all = await run<Found>(agent, 'liquids.search_classes', { instrumentKind: flex.id });
    expect(all.total).toBe(2);
    const forWater = await run<Found>(agent, 'liquids.search_classes', {
      liquidType: aqueous.id,
    });
    expect(forWater.classes).toEqual([
      expect.objectContaining({
        verified: true,
        lastCheck: { date: '2026-09-30', passed: true, demo: true },
      }),
    ]);
    expect(forWater.classes[0]?.liquidClass.id).toBe(water.id);
    const byName = await run<Found>(agent, 'liquids.search_classes', { text: 'WATER_DEF' });
    expect(byName.total).toBe(1);
    const unverified = await run<Found>(agent, 'liquids.search_classes', { verified: false });
    expect(unverified.classes.map((c) => c.liquidClass.id)).toEqual([thick.id]);
    const echo = await run<Found>(agent, 'liquids.search_classes', { platform: 'echo' });
    expect(echo.total).toBe(0);
    const elsewhere = await run<Found>(otherLab, 'liquids.search_classes', {});
    expect(elsewhere.total).toBe(0);
    await refused(run(agent, 'liquids.search_classes', { platform: 'tecan' }));
  });
});

/** A passing gravimetric check; the first (real) one verifies, the second (demo) is latest. */
async function recordCheck(liquidClass: string, date: string, demo: boolean) {
  await run(person, 'liquids.record_verification', {
    liquidClass,
    method: 'gravimetric',
    date,
    target: uL('10'),
    replicates: 10,
    mean: uL('10.1'),
    cv: '1',
    limits: { accuracy: '5', cv: '3' },
    demo,
  });
}

describe('seed liquid classes', () => {
  it('drafts the vendor defaults for what the lab has, once, and they resolve once confirmed', async () => {
    const seedFile = (name: string) =>
      readFile(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');
    const seeder: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Seed loader',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    await loadSeedLabware(
      registry,
      seeder,
      await seedFile('labware.yaml'),
      await readDefinitions(new URL('../../../../seed/opentrons/', import.meta.url)),
    );
    await loadSeedInstruments(
      registry,
      seeder,
      readSeedInstruments(
        await seedFile('instrument-library.yaml'),
        await seedFile('instruments.yaml'),
      ),
    );
    await loadSeedReagents(
      registry,
      seeder,
      readSeedReagents(await seedFile('reagent-library.yaml')),
    );
    const opentrons = Object.fromEntries(
      await Promise.all(
        ['water.json', 'glycerol_50.json', 'ethanol_80.json'].map(
          async (name) => [name, await seedFile(`liquid-classes/opentrons/${name}`)] as const,
        ),
      ),
    );
    const library = readSeedLiquidClasses({
      index: await seedFile('liquid-classes.yaml'),
      opentrons,
      hamilton: await seedFile('liquid-classes/hamilton-defaults.yaml'),
      instrumentLibrary: await seedFile('instrument-library.yaml'),
      labware: await seedFile('labware.yaml'),
      reagentLibrary: await seedFile('reagent-library.yaml'),
    });
    const report = await loadSeedLiquidClasses(registry, seeder, library);
    expect(report.skipped).toEqual([]);
    expect(report.created).toHaveLength(library.classes.length);
    const again = await loadSeedLiquidClasses(registry, seeder, library);
    expect(again.existing).toHaveLength(library.classes.length);

    const byLabel = async (kind: string, label: string) =>
      (
        await run<{ records: RecordEnvelope[] }>(person, 'records.list', {
          kind,
          search: label,
          limit: 20,
        })
      ).records.find((r) => r.label === label) as RecordEnvelope;
    const water = await byLabel(
      'liquid_class',
      'Opentrons water, Flex 1-Channel Pipette (1000 uL), filtertiprack_200ul',
    );
    expect(water.evidence.settings).toMatchObject({ source: 'imported' });
    expect(water.evidence.liquidTypes).toMatchObject({ source: 'assumed' });
    await confirm(water);
    const choice = await run<ClassChoice>(agent, 'liquids.resolve_class', {
      liquid: { liquidType: (await byLabel('liquid_type', 'Aqueous')).id },
      instrumentKind: (await byLabel('instrument_kind', 'Opentrons Flex')).id,
      device: (await byLabel('equipment_kind', 'Flex 1-Channel Pipette (1000 uL)')).id,
      tip: (
        await byLabel('labware_type', 'Opentrons Flex Tips, 200 uL, filtered, racks (20 racks)')
      ).id,
      volume: uL('100'),
    });
    expect(choice).toMatchObject({ liquidClass: water.id, how: 'lab_default', verified: false });
  }, 300_000);
});

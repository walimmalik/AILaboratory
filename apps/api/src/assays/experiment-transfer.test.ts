import { directDispense } from '@ailab/domain';
import type {
  Actor,
  PlatePlan,
  Readiness,
  RecordEnvelope,
  TransferPlanAttributes,
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
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { sopKinds } from '../sops/kinds.ts';
import { parseCsv } from '../transfers/echo.ts';
import { transferKinds } from '../transfers/kinds.ts';
import {
  confirmFixtureRecord,
  createFictionalTransferFixture,
  FICTIONAL_FINAL_VOLUME,
  FICTIONAL_STOCK,
  FICTIONAL_TARGET,
  type FixtureRun,
  fictionalTransferInput,
  startFictionalExperiment,
} from './experiment-transfer-fixture.ts';
import { assayKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, {
    orgName: 'FICTIONAL organization',
    labName: 'FICTIONAL lab',
    userName: 'Fixture reviewer',
  });
  const actor: Actor = { type: 'user', userId: tenant.userId };
  person = { actor, orgId: tenant.orgId, labId: tenant.labId };
  agent = {
    ...person,
    actor: { type: 'agent', agentName: 'Fixture agent', onBehalfOf: tenant.userId },
  };
  const kinds = new KindRegistry();
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

const run: FixtureRun = async <T = RecordEnvelope>(
  actor: 'person' | 'agent',
  operation: string,
  input: unknown,
) => {
  const result = await registry.execute(actor === 'person' ? person : agent, operation, input);
  if (result.status !== 'done') throw new Error(`${operation} was ${result.status}`);
  return result.output as T;
};

describe('one FICTIONAL experiment design to Echo transfer', () => {
  it('uses its generated, confirmed map to dose two compounds and a bound positive control', async () => {
    const fixture = await createFictionalTransferFixture(run);
    expect(
      (fixture.sop.attributes as { variables: { value: unknown }[] }).variables[0]?.value,
    ).toEqual(FICTIONAL_TARGET);
    expect(
      (fixture.layout.attributes as { subjectConcentration: unknown }).subjectConcentration,
    ).toEqual(FICTIONAL_TARGET);
    const { experiment, plateMap } = await startFictionalExperiment(run, fixture);
    expect(experiment).toMatchObject({ kind: 'experiment', status: 'draft' });
    expect(plateMap).toMatchObject({ kind: 'plate_map', status: 'draft' });
    expect(plateMap.attributes).toMatchObject({ experiment: experiment.id });
    const wells = (
      await run<{ plates: PlatePlan[] }>('person', 'platemaps.wells', { id: plateMap.id })
    ).plates.flatMap((plate) => plate.wells.map((well) => ({ ...well, plate: plate.plate })));
    expect(wells.filter((well) => well.subject && well.concentration)).toHaveLength(6);
    for (const compound of fixture.compounds)
      expect(wells.filter((well) => well.subject === compound.id)).toHaveLength(2);
    expect(wells.filter((well) => well.role === 'neutral_control')).toHaveLength(2);
    for (const well of wells.filter((w) => w.subject))
      expect(well.concentration).toEqual(FICTIONAL_TARGET);

    const activeExperiment = await confirmFixtureRecord(run, experiment);
    const activeMap = await confirmFixtureRecord(run, plateMap);
    expect([activeExperiment.status, activeMap.status]).toEqual(['active', 'active']);
    const input = fictionalTransferInput(fixture, activeMap);
    await expect(
      run('agent', 'transfers.draft_from_plate_map', {
        ...input,
        sources: input.sources.slice(0, 2),
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('Say where the stock is for'),
    });
    const draft = await run<{
      plan: RecordEnvelope;
      summary: {
        wells: number;
        fromSource: number;
        fromIntermediates: number;
        intermediateWells: number;
        backfilled: number;
      };
    }>('agent', 'transfers.draft_from_plate_map', input);
    expect(draft.summary).toMatchObject({
      wells: 6,
      fromSource: 6,
      fromIntermediates: 0,
      intermediateWells: 0,
      backfilled: 2,
    });
    const planAttributes = draft.plan.attributes as TransferPlanAttributes;
    expect(planAttributes.experiment).toBe(experiment.id);
    expect(
      planAttributes.plates.find((plate) => plate.role === 'destination')?.plateMap,
    ).toMatchObject({
      map: { id: activeMap.id, version: activeMap.version },
    });
    expect(planAttributes.plates.find((plate) => plate.role === 'source')?.container).toBe(
      fixture.source.id,
    );
    const direct = planAttributes.groups.find((group) => group.id === 'compounds');
    const backfill = planAttributes.groups.find((group) => group.id === 'backfill');
    expect(direct?.transfers).toHaveLength(6);
    expect(backfill?.transfers).toHaveLength(2);
    const expectedDispense = directDispense({
      stock: FICTIONAL_STOCK,
      target: FICTIONAL_TARGET,
      finalVolume: FICTIONAL_FINAL_VOLUME,
      device: {
        min: { value: '2.5', unit: 'nL' },
        max: { value: '10', unit: 'uL' },
        step: { value: '2.5', unit: 'nL' },
      },
      maxSolventPercent: '1',
      tolerance: '0.05',
    });
    expect(expectedDispense.ok).toBe(true);
    expect(expectedDispense.achieved).toEqual(FICTIONAL_TARGET);
    const sourceWellBySubject = new Map(
      fixture.compounds.map((compound, i) => [compound.id, `A${i + 1}`]),
    );
    for (const transfer of direct?.transfers ?? []) {
      const mapped = wells.find(
        (well) => `map${well.plate}` === transfer.to.plate && well.well === transfer.to.well,
      );
      expect(mapped?.subject).toBeDefined();
      expect(mapped?.concentration).toEqual(FICTIONAL_TARGET);
      expect(transfer.from).toEqual({
        plate: 'src',
        well: sourceWellBySubject.get(mapped?.subject ?? ''),
      });
      expect(transfer.volume).toEqual(expectedDispense.volume.achieved);
    }
    expect(backfill?.transfers.map((transfer) => transfer.to.well).sort()).toEqual(['H3', 'H4']);
    expect(
      backfill?.transfers.every(
        (transfer) => transfer.from.plate === 'src' && transfer.from.well === 'P24',
      ),
    ).toBe(true);
    expect(
      backfill?.transfers.every(
        (transfer) => transfer.volume.value === expectedDispense.volume.achieved.value,
      ),
    ).toBe(true);

    const readiness = await run<Readiness>('person', 'records.readiness', { id: draft.plan.id });
    expect(readiness.checks.filter((check) => !check.passed)).toEqual([]);
    const confirmed = await confirmFixtureRecord(run, draft.plan);
    expect(confirmed.status).toBe('active');
    const exported = await run<{
      files: { group: string; file: RecordEnvelope; rows: number }[];
      skipped: unknown[];
    }>('agent', 'transfers.export', { id: confirmed.id });
    expect(exported.skipped).toEqual([]);
    expect(exported.files.map((file) => [file.group, file.rows])).toEqual([
      ['compounds', 6],
      ['backfill', 2],
    ]);
    const expectedRows = {
      compounds: wells
        .filter((well) => well.subject && well.concentration)
        .map((well) => [
          sourceWellBySubject.get(well.subject ?? ''),
          expectedDispense.volume.achieved.value,
          well.well,
        ]),
      backfill: wells
        .filter((well) => well.role === 'neutral_control')
        .map((well) => ['P24', expectedDispense.volume.achieved.value, well.well]),
    };
    for (const file of exported.files) {
      const { text } = await run<{ text: string }>('person', 'files.get', { id: file.file.id });
      const [header, ...rows] = parseCsv(text);
      expect(header?.[3]).toBe('Source Well');
      expect(header?.[4]).toBe('Transfer Volume');
      expect(header?.[8]).toBe('Destination Well');
      expect(rows).toHaveLength(file.rows);
      expect(rows.every((row) => row[1] === fixture.source.name)).toBe(true);
      expect(rows.map((row) => [row[3], row[4], row[8]]).sort()).toEqual(
        expectedRows[file.group as keyof typeof expectedRows].sort(),
      );
    }
  });
});

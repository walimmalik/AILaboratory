import type { Actor, RecordEnvelope } from '@ailab/schema';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { connect } from '../db/client.ts';
import { entityKinds } from '../entities/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import { inventoryKinds } from './kinds.ts';

/**
 * PGlite runs everything on one connection, so a race between inventory writes only shows on a
 * real Postgres with a pool. Set TEST_DATABASE_URL to a Postgres the test may create databases on
 * (the CI Postgres job does); it runs in a database of its own and drops it afterwards.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('inventory on Postgres', () => {
  it('keeps every volume when operations consume from the same well at once', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `ailab_race_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const scratch = new URL(url as string);
    scratch.pathname = `/${name}`;
    const { db, migrate, close } = await connect(scratch.toString());
    try {
      await migrate();
      const tenant = await createTenant(db, {
        orgName: 'Concurrency',
        labName: `Race ${Date.now()}`,
        userName: 'Wali',
      });
      const ctx = {
        actor: { type: 'user', userId: tenant.userId } as Actor,
        orgId: tenant.orgId,
        labId: tenant.labId,
      };
      const kinds = new KindRegistry();
      for (const kind of [
        ...labwareKinds,
        ...instrumentKinds,
        ...reagentKinds,
        ...entityKinds,
        ...inventoryKinds,
      ]) {
        kinds.register(kind);
      }
      const registry = createRegistry(db, kinds, new ActivityBus());
      const run = async <T>(id: string, input: unknown) => {
        const result = await registry.execute(ctx, id, input);
        if (result.status !== 'done') throw new Error(`${id} was proposed`);
        return result.output as T;
      };
      const type = await run<RecordEnvelope>('records.create', {
        kind: 'labware_type',
        label: 'Tube 1.5 mL',
        attributes: { family: 'tube', maxVolume: { value: '1.5', unit: 'mL' } },
      });
      const { containers } = await run<{ containers: RecordEnvelope[] }>(
        'inventory.register_containers',
        { labwareType: type.id, containers: [{}] },
      );
      const tube = containers[0] as RecordEnvelope;
      const { product } = await run<{ product: RecordEnvelope }>('reagents.draft_product', {
        label: 'PBS',
        attributes: { category: 'buffer', origin: 'bought' },
      });
      const lot = await run<RecordEnvelope>('reagents.receive_lot', {
        product: product.id,
        lotNumber: 'A1',
      });
      await run('inventory.fill', {
        container: tube.id,
        fills: [
          {
            wells: ['A1'],
            volume: { value: '100', unit: 'uL' },
            components: [{ source: lot.id, concentration: { value: '1', unit: 'mM' } }],
          },
        ],
      });

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          run('inventory.consume', {
            container: tube.id,
            wells: ['A1'],
            volume: { value: '5', unit: 'uL' },
          }),
        ),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const { wells } = await run<{ wells: { state: { volume: { value: string } } }[] }>(
        'inventory.wells',
        { container: tube.id },
      );
      expect(Number(wells[0]?.state.volume.value)).toBe(40);
      const { events } = await run<{ events: { type: string }[] }>('inventory.history', {
        container: tube.id,
      });
      expect(events.filter((e) => e.type === 'consume')).toHaveLength(12);
    } finally {
      await close();
      await admin.query(`drop database ${name}`);
      await admin.end();
    }
  }, 60_000);
});

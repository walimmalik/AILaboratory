import { type Actor, RecordEnvelope } from '@ailab/schema';
import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { KindRegistry } from '../records/kinds.ts';
import { RecordService } from '../records/service.ts';
import { widget } from '../records/test-kinds.ts';
import { type Db, migrationsFolder } from './client.ts';
import * as schema from './schema.ts';

it('adds nullable creation origin to populated records without rewriting scientific values, pins or history', async () => {
  const client = new PGlite();
  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    // This fixture starts at the immediately preceding deployed schema, not a nullable-row simulation.
    const added = migrations.findIndex((migration) =>
      migration.sql.some((statement) => statement.includes('ADD COLUMN "origin"')),
    );
    expect(added).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, added))
      for (const statement of migration.sql) await client.exec(statement);
    const db = drizzle(client, { schema }) as unknown as Db;
    const tenant = await createTenant(db, {
      orgName: 'Populated lab',
      labName: 'Lab',
      userName: 'Scientist',
    });
    const actor: Actor = { type: 'user', userId: tenant.userId };
    const ctx = { actor, orgId: tenant.orgId, labId: tenant.labId };
    const at = '2026-10-01T00:00:00.000Z';
    const parent = {
      id: 'wdg_00000000000000000000000001',
      kind: 'widget',
      name: 'WDG-0001',
      label: 'Prior source',
      orgId: tenant.orgId,
      labId: tenant.labId,
      status: 'active' as const,
      version: 1,
      attributes: { color: 'blue', volume: { value: '50', unit: 'uL' } },
      evidence: {},
      reviews: {},
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      updatedBy: actor,
    };
    const child = RecordEnvelope.parse({
      ...parent,
      id: 'wdg_00000000000000000000000002',
      name: 'WDG-0002',
      label: 'Prior draft',
      status: 'draft',
      attributes: { ...parent.attributes, partOf: parent.id },
      evidence: {
        volume: {
          source: 'record',
          by: actor,
          at,
          from: { id: parent.id, version: 1, path: '/volume' },
        },
      },
    });
    for (const record of [parent, child]) {
      await client.query(
        'INSERT INTO records (id,kind,org_id,lab_id,name,label,status,version,attributes,evidence,reviews,created_at,created_by,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          record.id,
          record.kind,
          record.orgId,
          record.labId,
          record.name,
          record.label,
          record.status,
          record.version,
          JSON.stringify(record.attributes),
          JSON.stringify(record.evidence),
          JSON.stringify(record.reviews),
          at,
          JSON.stringify(actor),
          at,
          JSON.stringify(actor),
        ],
      );
      await client.query(
        'INSERT INTO record_versions (record_id,version,operation,actor,at,snapshot) VALUES ($1,1,$2,$3,$4,$5)',
        [record.id, 'create', JSON.stringify(actor), at, JSON.stringify(record)],
      );
    }
    for (const migration of migrations.slice(added))
      for (const statement of migration.sql) await client.exec(statement);
    const service = new RecordService(db, new KindRegistry().register(widget));
    expect(await service.get(ctx, child.id)).toEqual(child);
    expect((await service.getVersion(ctx, child.id, 1)).snapshot).toEqual(child);
    expect((await service.list(ctx)).every((record) => !('origin' in record))).toBe(true);
    const editor = {
      ...ctx,
      origin: {
        type: 'user_message' as const,
        conversation: 'cnv_00000000000000000000000001',
        message: 'later-edit',
      },
    };
    const changed = await service.update(editor, child.id, {
      expectedVersion: 1,
      label: 'Edited old draft',
    });
    expect(changed).not.toHaveProperty('origin');
    expect(changed.attributes).toEqual(child.attributes);
    expect(changed.evidence).toEqual(child.evidence);
    const restored = await service.restore(editor, child.id, { expectedVersion: 2, version: 1 });
    expect(restored).not.toHaveProperty('origin');
    expect(restored.attributes).toEqual(child.attributes);
    expect(restored.evidence).toEqual(child.evidence);
    expect((await service.getVersion(ctx, child.id, 1)).snapshot).toEqual(child);
  } finally {
    await client.close();
  }
});

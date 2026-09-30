import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { plateMapKinds } from './kinds.ts';
import { loadSeedLayouts, readSeedLayouts } from './seed.ts';

let close: () => Promise<void>;
let registry: OperationRegistry;
let ctx: RecordContext;

beforeEach(async () => {
  const test = await createTestDb();
  close = test.close;
  const tenant = await createTenant(test.db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  ctx = {
    actor: { type: 'agent', agentName: 'Seed', onBehalfOf: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of plateMapKinds) kinds.register(kind);
  registry = createRegistry(test.db, kinds, new ActivityBus());
});
afterEach(() => close());

it('drafts every seed layout once, and each fits its assay', async () => {
  const layouts = readSeedLayouts(
    await readFile(new URL('../../../../seed/layouts.yaml', import.meta.url), 'utf8'),
  );
  const first = await loadSeedLayouts(registry, ctx, layouts, 'test');
  expect(first.created).toHaveLength(layouts.length);
  const again = await loadSeedLayouts(registry, ctx, layouts, 'test');
  expect(again).toEqual({ created: [], existing: layouts.map((l) => l.label) });

  const fits: Record<string, number> = {
    'IL-6 ELISA, 96 wells': 40,
    'Single-point screen, 384 wells': 320,
    'Dose-response, 384 wells': 16,
    'pNPP kinetic screen, 96 wells': 80,
    'Dual-Glo reporter, 384 wells': 80,
  };
  for (const layout of layouts) {
    const result = await registry.execute(ctx, 'layouts.preview', {
      attributes: layout.attributes,
      subjects: 1,
    });
    expect(result.status === 'done' && (result.output as { perPlate: number }).perPlate).toBe(
      fits[layout.label],
    );
  }
});

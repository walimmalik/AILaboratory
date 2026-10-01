import { readFile } from 'node:fs/promises';
import { MemoryAttributes } from '@ailab/schema';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { createTestDb } from '../db/testing.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { memoryKinds } from './kinds.ts';
import { loadSeedMemories, readSeedMemories } from './seed.ts';

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
  for (const kind of [...instrumentKinds, ...reagentKinds, ...memoryKinds]) kinds.register(kind);
  registry = createRegistry(test.db, kinds, new ActivityBus());
});
afterEach(() => close());

const seed = async () =>
  readSeedMemories(
    await readFile(new URL('../../../../seed/memory.yaml', import.meta.url), 'utf8'),
  );

it('has about 25 memories across every kind and strength, each a valid memory', async () => {
  const memories = await seed();
  expect(memories.length).toBeGreaterThanOrEqual(20);
  const prefix: Record<string, string> = { sop: 'sop', instrument_kind: 'ink', liquid_type: 'lqt' };
  const withIds = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(withIds)
      : v && typeof v === 'object'
        ? Object.keys(v).length === 1 && prefix[Object.keys(v)[0] as string]
          ? `${prefix[Object.keys(v)[0] as string]}_01J9Z3K8Q4ABCDEFGHJKMNPQRS`
          : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withIds(x)]))
        : v;
  for (const m of memories) {
    const parsed = MemoryAttributes.safeParse({
      strength: 'note',
      appliesTo: { to: 'lab' },
      source: { from: 'stated' },
      ...(withIds(m) as object),
    });
    expect(parsed.error?.message, m.statement).toBeUndefined();
  }
  const kinds = new Set(memories.map((m) => m.kind));
  const strengths = new Set(memories.map((m) => m.strength));
  expect([...kinds].sort()).toEqual(['convention', 'fact', 'lesson', 'preference', 'quirk']);
  expect([...strengths].sort()).toEqual(['default', 'note', 'rule']);
});

it('drafts each memory once its records are in the lab, and waits for the rest', async () => {
  const memories = await seed();
  for (const label of ['Hamilton Microlab STAR', 'Opentrons Flex'])
    await registry.execute(ctx, 'records.create', {
      kind: 'instrument_kind',
      label,
      attributes: { category: 'liquid_handler', performedBy: 'machine' },
    });
  await registry.execute(ctx, 'records.create', {
    kind: 'liquid_type',
    label: 'Aqueous',
    attributes: { base: 'aqueous' },
  });
  const first = await loadSeedMemories(registry, ctx, memories, 'test');
  expect(first.created.map((c) => c.replace(/^MEM-\d+ /, ''))).toEqual([
    'Use the Flex for liquid handling with fewer than 96 samples; the STAR for…',
    'The STAR drips with the default water class below 5 uL; move small water…',
    'Edge wells evaporate in the 37 C incubator after 48 h; fill the outer wells…',
    'The cold room door alarm sounds after 2 min open',
  ]);
  expect(first.created.some((c) => c.includes('The STAR drips'))).toBe(true);
  expect(first.created.length + first.waiting.length).toBe(memories.length);
  expect(first.waiting.some((w) => w.includes('waits for sop HEK293 routine passaging'))).toBe(
    true,
  );
  const again = await loadSeedMemories(registry, ctx, memories, 'test');
  expect(again.created).toEqual([]);
  expect(again.existing).toHaveLength(first.created.length);
});

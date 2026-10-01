import { readFile } from 'node:fs/promises';
import type { RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { transferKinds } from './kinds.ts';
import { loadSeedWorklistFormats, readSeedWorklistFormats } from './seed.ts';

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
  for (const kind of [...instrumentKinds, ...transferKinds, ...fileKinds]) kinds.register(kind);
  registry = createRegistry(test.db, kinds, new ActivityBus());
});
afterEach(() => close());

const seed = (name: string) =>
  readFile(new URL(`../../../../seed/${name}`, import.meta.url), 'utf8');

it('drafts every seed worklist format once, from its example file', async () => {
  const formats = readSeedWorklistFormats(
    await seed('worklist-formats.yaml'),
    await seed('instrument-library.yaml'),
  );
  const examples = (name: string) => seed(`worklists/${name}`);
  // Only the kinds the formats need; the PreciseDrop's is left out, so its format waits.
  for (const label of ['Hamilton Microlab STAR', 'Hamilton Microlab VANTAGE', 'Formulatrix MANTIS'])
    await registry.execute(ctx, 'records.create', {
      kind: 'instrument_kind',
      label,
      attributes: { category: 'liquid_handler', performedBy: 'machine' },
    });
  const first = await loadSeedWorklistFormats(registry, ctx, formats, examples, 'test');
  expect(first.created).toEqual([
    'WLF-0001 STAR ELISA samples',
    'WLF-0002 Vantage medium addition',
    'WLF-0003 Mantis dispense grid',
  ]);
  expect(first.waiting).toEqual(['PreciseDrop dispense list: waits for PreciseDrop II']);

  await registry.execute(ctx, 'records.create', {
    kind: 'instrument_kind',
    label: 'PreciseDrop II',
    attributes: { category: 'liquid_handler', performedBy: 'machine' },
  });
  const again = await loadSeedWorklistFormats(registry, ctx, formats, examples, 'test');
  expect(again.created).toEqual(['WLF-0004 PreciseDrop dispense list']);
  expect(again.existing).toHaveLength(3);

  const listed = await registry.execute(ctx, 'records.list', { kind: 'worklist_format' });
  const { records } = (listed as { output: { records: RecordEnvelope[] } }).output;
  const mantis = records.find((r) => r.label === 'Mantis dispense grid');
  expect(mantis?.evidence?.layout).toMatchObject({ source: 'assumed' });
});

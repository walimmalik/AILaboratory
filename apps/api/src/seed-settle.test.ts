import type { Actor, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from './auth.ts';
import type { Db } from './db/client.ts';
import { createTestDb } from './db/testing.ts';
import { createRegistry, type OperationRegistry } from './operations/index.ts';
import { KindRegistry } from './records/kinds.ts';
import type { RecordContext } from './records/service.ts';
import { widget } from './records/test-kinds.ts';
import { settleSeed } from './seed-settle.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let loader: RecordContext;
let other: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  loader = {
    ...person,
    actor: { type: 'agent', agentName: 'Seed loader', onBehalfOf: tenant.userId },
  };
  other = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  registry = createRegistry(db, new KindRegistry().register(widget));
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  return (result.status === 'proposed' ? result.proposal : result.output) as T;
}

const widgetOf = (label: string, volume: string) => ({
  kind: 'widget',
  label,
  attributes: { color: 'teal', volume: { value: volume, unit: 'uL' } },
});

describe('settling the seed', () => {
  it("confirms the loader's drafts, approves its proposals, and leaves the rest for Review", async () => {
    const ready = await run<RecordEnvelope>(loader, 'records.create', widgetOf('Tip box', '50'));
    const blocked = await run<RecordEnvelope>(loader, 'records.create', widgetOf('Empty', '0'));
    const active = await run<RecordEnvelope>(person, 'records.create', {
      ...widgetOf('Rack', '10'),
      status: 'active',
    });
    await run(loader, 'records.update', {
      id: active.id,
      expectedVersion: 1,
      label: 'Rack (blue)',
    });
    // Another agent's draft and proposal are not the seed's to settle.
    const theirs = await run<RecordEnvelope>(other, 'records.create', widgetOf('Theirs', '5'));
    await run(other, 'records.update', { id: active.id, expectedVersion: 1, label: 'Rack (red)' });

    const report = await settleSeed(registry, db, person, loader, 'Imported from seed');

    expect(report.approved).toHaveLength(1);
    expect(report.activated).toEqual([ready.name]);
    expect(report.left).toEqual([{ name: blocked.name, reason: 'Volume is 0 uL' }]);
    const tipBox = await run<RecordEnvelope>(person, 'records.get', { id: ready.id });
    expect(tipBox.status).toBe('active');
    expect((await run<RecordEnvelope>(person, 'records.get', { id: active.id })).label).toBe(
      'Rack (blue)',
    );
    expect((await run<RecordEnvelope>(person, 'records.get', { id: blocked.id })).status).toBe(
      'draft',
    );
    expect((await run<RecordEnvelope>(person, 'records.get', { id: theirs.id })).status).toBe(
      'draft',
    );
    const pending = await run<{ proposals: unknown[] }>(person, 'proposals.list', {
      status: 'pending',
    });
    expect(pending.proposals).toHaveLength(1);
    const history = await run<{ versions: { reason?: string; actor: Actor }[] }>(
      person,
      'records.history',
      { id: ready.id },
    );
    expect(history.versions.at(-1)?.reason ?? history.versions[0]?.reason).toBe(
      'Imported from seed',
    );

    // A second pass has nothing left to do.
    const again = await settleSeed(registry, db, person, loader, 'Imported from seed');
    expect([again.approved, again.activated]).toEqual([[], []]);
  });
});

import type { Actor, Proposal, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { widget } from '../records/test-kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from './index.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let bus: ActivityBus;
let person: RecordContext;
let agent: RecordContext;

const attributes = { color: 'teal', volume: { value: '50', unit: 'uL' } };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  const claude: Actor = { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: claude };
  bus = new ActivityBus();
  registry = createRegistry(db, new KindRegistry().register(widget), bus);
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown, preview = false) {
  const result = await registry.execute(ctx, id, input, { preview });
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

const create = (ctx: RecordContext, extra: Record<string, unknown> = {}) =>
  run<RecordEnvelope>(ctx, 'records.create', {
    kind: 'widget',
    label: 'Tip box',
    attributes,
    ...extra,
  });

async function ledger() {
  return (
    await run<{ entries: { operationId: string; outcome: string }[] }>(person, 'activity.list', {})
  ).entries;
}

describe('registry', () => {
  it('lists every operation, sorted', () => {
    const ids = registry.list().map((c) => c.id);
    expect(ids).toContain('records.create');
    expect(ids).toContain('proposals.approve');
    expect(ids).toEqual([...ids].sort());
  });

  it('refuses unknown operations and invalid input with a message to act on', async () => {
    expect((await refused(registry.execute(person, 'records.nope', {}))).code).toBe(
      'unknown_operation',
    );
    const error = await refused(registry.execute(person, 'records.create', { kind: 'widget' }));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('label');
  });

  it('refuses to register a write without an agent policy', () => {
    const create = registry.get('records.create').contract;
    expect(() =>
      createRegistry(db, new KindRegistry()).register({
        contract: { ...create, id: 'x.y' },
        run: async () => ({}),
      }),
    ).toThrow(/agent policy/);
  });
});

describe('writes', () => {
  it('lets a person create and read a record, and logs only the change', async () => {
    const record = await create(person);
    expect(record.name).toBe('WDG-0001');
    const read = await run<RecordEnvelope>(person, 'records.get', { id: record.id });
    expect(read.label).toBe('Tip box');
    expect(await ledger()).toMatchObject([{ operationId: 'records.create', outcome: 'succeeded' }]);
  });

  it('previews a change without saving it or logging it', async () => {
    const result = await registry.execute(
      person,
      'records.create',
      { kind: 'widget', label: 'Preview only', attributes },
      { preview: true },
    );
    expect(result.status).toBe('preview');
    const next = await create(person);
    // The preview took no name and left no record behind.
    expect(next.name).toBe('WDG-0001');
    expect(await ledger()).toHaveLength(1);
  });

  it('logs a failed change with its error and saves nothing', async () => {
    const record = await create(person);
    const error = await refused(
      registry.execute(person, 'records.update', { id: record.id, expectedVersion: 7, label: 'x' }),
    );
    expect(error.code).toBe('version_conflict');
    const [latest] = await ledger();
    expect(latest).toMatchObject({
      operationId: 'records.update',
      outcome: 'failed',
      error: { code: 'version_conflict' },
    });
  });

  it('publishes each ledger entry on the live bus', async () => {
    const seen: string[] = [];
    bus.subscribe(person.labId, (entry) => seen.push(entry.operationId));
    await create(person);
    expect(seen).toEqual(['records.create']);
  });
});

describe('finding records', () => {
  it('lists drafts and active records newest first, searches, and hides archived unless asked', async () => {
    const tipBox = await create(person);
    const rack = await create(person, { label: 'Tube rack', status: 'active' });
    await run(person, 'records.archive', { id: rack.id, expectedVersion: 1 });
    const pipette = await create(person, { label: 'Pipette 100%_off' });

    const list = async (input: Record<string, unknown>) =>
      (await run<{ records: RecordEnvelope[] }>(person, 'records.list', input)).records.map(
        (r) => r.name,
      );
    expect(await list({})).toEqual([pipette.name, tipBox.name]);
    expect(await list({ status: 'archived' })).toEqual([rack.name]);
    expect(await list({ search: 'wdg-0001' })).toEqual([tipBox.name]);
    // Search text is literal: % and _ are not wildcards.
    expect(await list({ search: '%_' })).toEqual([pipette.name]);
    expect(await list({ kind: 'plasmid' })).toEqual([]);
    expect((await refused(registry.execute(person, 'records.list', { limit: 0 }))).code).toBe(
      'invalid_input',
    );
  });

  it('names the records each ledger entry touched', async () => {
    const record = await create(person);
    const [entry] = (
      await run<{ entries: { recordNames: Record<string, string> }[] }>(person, 'activity.list', {})
    ).entries;
    expect(entry?.recordNames).toEqual({ [record.id]: 'WDG-0001' });
  });

  it('names a record an agent proposed to create, before it exists', async () => {
    await registry.execute(agent, 'records.create', {
      kind: 'widget',
      label: 'New',
      attributes,
      status: 'active',
    });
    const [entry] = (
      await run<{ entries: { outcome: string; recordNames: Record<string, string> }[] }>(
        person,
        'activity.list',
        {},
      )
    ).entries;
    expect(entry?.outcome).toBe('proposed');
    expect(Object.values(entry?.recordNames ?? {})).toEqual(['WDG-0001']);
  });
});

describe('agents', () => {
  it('edit drafts directly', async () => {
    const draft = await create(agent);
    const updated = await run<RecordEnvelope>(agent, 'records.update', {
      id: draft.id,
      expectedVersion: 1,
      label: 'Renamed',
    });
    expect(updated.version).toBe(2);
  });

  it('propose changes to active records, with a preview, and nothing changes until approved', async () => {
    const record = await create(person, { status: 'active' });
    const result = await registry.execute(agent, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      label: 'Agent label',
      reason: 'Match the vendor name',
    });
    expect(result.status).toBe('proposed');
    const proposal = (result as { proposal: Proposal }).proposal;
    expect(proposal).toMatchObject({
      status: 'pending',
      operationId: 'records.update',
      reason: 'Match the vendor name',
    });
    expect((proposal.preview as RecordEnvelope).label).toBe('Agent label');
    expect((await run<RecordEnvelope>(person, 'records.get', { id: record.id })).label).toBe(
      'Tip box',
    );

    const approved = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
    expect(approved).toMatchObject({ status: 'approved', decidedBy: person.actor });
    const after = await run<RecordEnvelope>(person, 'records.get', { id: record.id });
    expect(after.label).toBe('Agent label');
    // The change is attributed to the agent that proposed it.
    expect(after.updatedBy).toEqual(agent.actor);
    expect((await ledger()).map((e) => e.outcome)).toEqual([
      'approved',
      'succeeded',
      'proposed',
      'succeeded',
    ]);
  });

  it('propose activation even of their own drafts', async () => {
    const draft = await create(agent);
    const result = await registry.execute(agent, 'records.activate', {
      id: draft.id,
      expectedVersion: 1,
    });
    expect(result.status).toBe('proposed');
  });

  it('may not approve or reject proposals', async () => {
    const record = await create(person, { status: 'active' });
    const result = await registry.execute(agent, 'records.archive', {
      id: record.id,
      expectedVersion: 1,
    });
    const { proposal } = result as { proposal: Proposal };
    expect(
      (await refused(registry.execute(agent, 'proposals.approve', { id: proposal.id }))).code,
    ).toBe('forbidden');
    expect(
      (await refused(registry.execute(agent, 'proposals.reject', { id: proposal.id }))).code,
    ).toBe('forbidden');
  });

  it('see a rejected proposal change nothing', async () => {
    const record = await create(person, { status: 'active' });
    const { proposal } = (await registry.execute(agent, 'records.archive', {
      id: record.id,
      expectedVersion: 1,
    })) as { proposal: Proposal };
    const rejected = await run<Proposal>(person, 'proposals.reject', {
      id: proposal.id,
      reason: 'Still in use',
    });
    expect(rejected).toMatchObject({ status: 'rejected', decisionReason: 'Still in use' });
    expect((await run<RecordEnvelope>(person, 'records.get', { id: record.id })).status).toBe(
      'active',
    );
    const again = await refused(registry.execute(person, 'proposals.approve', { id: proposal.id }));
    expect(again.code).toBe('invalid_state');
  });

  it('see an approval fail cleanly when the record changed since the proposal', async () => {
    const record = await create(person, { status: 'active' });
    const { proposal } = (await registry.execute(agent, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      label: 'Agent label',
    })) as { proposal: Proposal };
    await run(person, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      label: 'Person label',
    });
    const decided = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
    expect(decided).toMatchObject({ status: 'failed', error: { code: 'version_conflict' } });
    expect((await run<RecordEnvelope>(person, 'records.get', { id: record.id })).label).toBe(
      'Person label',
    );
    const listed = await run<{ proposals: Proposal[] }>(person, 'proposals.list', {
      status: 'failed',
    });
    expect(listed.proposals.map((p) => p.id)).toEqual([proposal.id]);
  });
});

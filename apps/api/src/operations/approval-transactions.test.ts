import { newId } from '@ailab/domain';
import type { ActivityEntry, Actor, Proposal, RecordEnvelope } from '@ailab/schema';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, proposals, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { gadget } from '../records/test-kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from './index.ts';
import { createProposal } from './proposal-store.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let bus: ActivityBus;
let person: RecordContext;
let agent: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const actor: Actor = { type: 'user', userId: tenant.userId };
  person = { actor, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  bus = new ActivityBus();
  registry = createRegistry(db, new KindRegistry().register(gadget), bus);
});
afterEach(async () => {
  delete registry.get('records.create').after;
  vi.restoreAllMocks();
  await close();
});

const input = {
  kind: 'gadget',
  label: 'New clip',
  attributes: { color: 'teal' },
  status: 'active',
};

async function propose(): Promise<Proposal> {
  const result = await registry.execute(agent, 'records.create', input);
  if (result.status !== 'proposed') throw new Error('Expected a proposal');
  return result.proposal;
}

async function stored() {
  const result = await registry.execute(person, 'records.list', {});
  if (result.status !== 'done') throw new Error('Expected records');
  return (result.output as { records: RecordEnvelope[] }).records;
}

describe('commit-aligned approval transactions', () => {
  it('publishes no success or after work when an approval is previewed', async () => {
    const proposal = await propose();
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    const after = vi.fn();
    registry.get('records.create').after = after;

    const preview = await registry.execute(
      person,
      'proposals.approve',
      { id: proposal.id },
      { preview: true },
    );
    expect(preview.status).toBe('preview');
    expect(await stored()).toEqual([]);
    expect(live).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('discards nested success and hooks when a later outer step refuses', async () => {
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    const after = vi.fn();
    registry.get('records.create').after = after;
    const contract = registry.get('records.create').contract;
    registry.register({
      contract: { ...contract, id: 'test.outer_failure' },
      agentPolicy: 'direct',
      run: async (ctx, parsed, deps) => {
        await deps.registry.execute(ctx, 'records.create', parsed, {}, deps.db);
        throw new Error('Outer step refuses');
      },
    });
    await expect(registry.execute(person, 'test.outer_failure', input)).rejects.toThrow(
      'Outer step refuses',
    );
    expect(await stored()).toEqual([]);
    expect(live.map((entry) => entry.outcome)).toEqual(['failed']);
    expect(after).not.toHaveBeenCalled();
  });

  it('returns the committed approval when activity delivery throws and a person retries', async () => {
    const proposal = await propose();
    vi.spyOn(bus, 'publish').mockImplementation(() => {
      throw new Error('Stream disconnected');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const approved = await registry.execute(person, 'proposals.approve', { id: proposal.id });
    expect(approved.status).toBe('done');
    expect(approved.status === 'done' && (approved.output as Proposal).receipt).toMatchObject({
      output: { label: 'New clip', updatedBy: agent.actor },
      recordIds: [(await stored())[0]?.id],
    });
    expect(errors).toHaveBeenCalled();
    vi.restoreAllMocks();
    const retry = await registry.execute(person, 'proposals.approve', { id: proposal.id });
    expect(retry).toEqual(approved);
    expect(await stored()).toHaveLength(1);
    const activity = await registry.execute(person, 'activity.list', {});
    expect(
      activity.status === 'done' &&
        (activity.output as { entries: ActivityEntry[] }).entries.map((entry) => entry.outcome),
    ).toEqual(['approved', 'succeeded', 'proposed']);
  });

  it('rolls mutation back if the ledger cannot be persisted', async () => {
    await db.execute(sql`CREATE FUNCTION refuse_success() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.outcome = 'succeeded' THEN RAISE EXCEPTION 'Ledger storage unavailable'; END IF;
        RETURN NEW;
      END $$`);
    await db.execute(sql`CREATE TRIGGER refuse_success BEFORE INSERT ON activity
      FOR EACH ROW EXECUTE FUNCTION refuse_success()`);
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    await expect(registry.execute(person, 'records.create', input)).rejects.toThrow();
    expect(await stored()).toEqual([]);
    expect(live.map((entry) => entry.outcome)).toEqual(['failed']);
  });

  it('rolls back the applied change and success delivery if the decision cannot be saved', async () => {
    const proposal = await propose();
    await db.execute(sql`CREATE FUNCTION refuse_approval() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'approved' THEN RAISE EXCEPTION 'Decision storage unavailable'; END IF;
        RETURN NEW;
      END $$`);
    await db.execute(sql`CREATE TRIGGER refuse_approval BEFORE UPDATE ON proposals
      FOR EACH ROW EXECUTE FUNCTION refuse_approval()`);
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    const after = vi.fn();
    registry.get('records.create').after = after;
    await expect(
      registry.execute(person, 'proposals.approve', { id: proposal.id }),
    ).rejects.toThrow();
    expect(await stored()).toEqual([]);
    expect(live.map((entry) => entry.outcome)).toEqual(['failed']);
    expect(after).not.toHaveBeenCalled();
    const pending = await registry.execute(person, 'proposals.list', { status: 'pending' });
    expect(
      pending.status === 'done' && (pending.output as { proposals: Proposal[] }).proposals,
    ).toEqual([proposal]);
  });

  it('keeps committed status when after work and a write listener fail', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.get('records.create').after = () => {
      throw new Error('Background work unavailable');
    };
    registry.onWrite(async () => {
      throw new Error('Detector unavailable');
    });
    const result = await registry.execute(person, 'records.create', input);
    expect(result.status).toBe('done');
    expect(await stored()).toHaveLength(1);
    const entries = await registry.execute(person, 'activity.list', {});
    expect(
      entries.status === 'done' &&
        (entries.output as { entries: ActivityEntry[] }).entries.map((entry) => entry.outcome),
    ).toEqual(['succeeded']);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('recovers the exact applied result after registry restart and lost activity', async () => {
    const proposal = await propose();
    const approved = await registry.execute(person, 'proposals.approve', { id: proposal.id });
    const records = await stored();
    await db.delete(activity).where(eq(activity.proposalId, proposal.id));
    registry = createRegistry(db, new KindRegistry().register(gadget), bus);
    const after = vi.fn();
    const listener = vi.fn();
    registry.get('records.create').after = after;
    registry.onWrite(listener);
    const delivered = vi.fn();
    bus.subscribe(person.labId, delivered);
    expect(await registry.execute(person, 'proposals.approve', { id: proposal.id })).toEqual(
      approved,
    );
    expect(await stored()).toEqual(records);
    expect(after).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(delivered).not.toHaveBeenCalled();
  });

  it('waits for the managed outer transaction and discards all delivery on its rollback', async () => {
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    const after = vi.fn();
    registry.get('records.create').after = after;
    await expect(
      registry.transaction(db, async (tx) => {
        await registry.execute(person, 'records.create', input, {}, tx);
        expect(live).toEqual([]);
        expect(after).not.toHaveBeenCalled();
        throw new Error('Outer transaction refuses');
      }),
    ).rejects.toThrow('Outer transaction refuses');
    expect(await stored()).toEqual([]);
    expect(live).toEqual([]);
    expect(after).not.toHaveBeenCalled();

    await registry.transaction(db, async (tx) => {
      await registry.execute(person, 'records.create', input, {}, tx);
      expect(live).toEqual([]);
    });
    expect(live.map((entry) => entry.outcome)).toEqual(['succeeded']);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('refuses unmanaged outer transactions instead of publishing success before their commit', async () => {
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    await db.transaction(async (tx) => {
      await expect(registry.execute(person, 'records.create', input, {}, tx)).rejects.toThrow(
        'Nested operations must use the registry transaction boundary',
      );
      await expect(
        registry.transaction(tx, async (nested) =>
          registry.execute(person, 'records.create', input, {}, nested),
        ),
      ).rejects.toThrow('Nested operations must use the registry transaction boundary');
    });
    expect(await stored()).toEqual([]);
    expect(live).toEqual([]);
  });

  it('serializes two approval attempts to one mutation and returns the same receipt', async () => {
    const proposal = await propose();
    const after = vi.fn();
    const listener = vi.fn();
    registry.get('records.create').after = after;
    registry.onWrite(listener);
    const [first, second] = await Promise.all([
      registry.execute(person, 'proposals.approve', { id: proposal.id }),
      registry.execute(person, 'proposals.approve', { id: proposal.id }),
    ]);
    expect(second).toEqual(first);
    expect(await stored()).toHaveLength(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const entries = await registry.execute(person, 'activity.list', {});
    expect(
      entries.status === 'done' &&
        (entries.output as { entries: ActivityEntry[] }).entries.map((entry) => entry.outcome),
    ).toEqual(['approved', 'succeeded', 'proposed']);
  });

  it('keeps the original result on retry after the committed record changes', async () => {
    const proposal = await propose();
    const approved = await registry.execute(person, 'proposals.approve', { id: proposal.id });
    const [record] = await stored();
    await registry.execute(person, 'records.update', {
      id: record?.id,
      expectedVersion: record?.version,
      label: 'Later label',
    });
    expect(
      await registry.execute(person, 'proposals.approve', {
        id: proposal.id,
        reason: 'Retry after lost response',
      }),
    ).toEqual(approved);
    expect((await stored())[0]).toMatchObject({ label: 'Later label', version: 2 });
  });

  it('keeps people-only and lab restrictions on approved retries', async () => {
    const proposal = await propose();
    await registry.execute(person, 'proposals.approve', { id: proposal.id });
    await expect(
      registry.execute(agent, 'proposals.approve', { id: proposal.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = await createTenant(db, {
      orgName: 'Other',
      labName: 'Other lab',
      userName: 'Sam',
    });
    await expect(
      registry.execute(
        { orgId: other.orgId, labId: other.labId, actor: { type: 'user', userId: other.userId } },
        'proposals.approve',
        { id: proposal.id },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await stored()).toHaveLength(1);
  });

  it('never elevates an agent proposal into arbitrary people-only steps', async () => {
    const created = await registry.execute(person, 'records.create', { ...input, status: 'draft' });
    if (created.status !== 'done') throw new Error('Expected a draft');
    const record = created.output as RecordEnvelope;
    const proposal = await createProposal(db, agent, {
      operationId: 'changes.apply',
      input: {
        steps: [
          {
            operation: 'records.update',
            input: { id: record.id, expectedVersion: record.version, label: 'Agent label' },
          },
          {
            operation: 'records.confirm',
            input: { id: record.id, expectedVersion: record.version + 1 },
          },
        ],
      },
      preview: {},
    });
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (entry) => live.push(entry));
    const result = await registry.execute(person, 'proposals.approve', { id: proposal.id });
    expect(result.status === 'done' && result.output).toMatchObject({
      status: 'failed',
      error: { code: 'forbidden' },
    });
    expect((await stored())[0]).toEqual(record);
    expect(live.map((entry) => entry.outcome)).toEqual(['failed', 'failed']);
  });

  it('round-trips decision metadata and refuses scientific decisions outside the supported SOP default', async () => {
    const proposal = await propose();
    const decision = {
      origin: { type: 'unknown' as const },
      reads: [],
      writes: [],
      sources: [],
      previewIdentity: { digest: 'a'.repeat(64), preparedAt: new Date().toISOString() },
      scope: { type: 'operation_change' as const },
    };
    await db.update(proposals).set({ decision }).where(eq(proposals.id, proposal.id));
    const listed = await registry.execute(person, 'proposals.list', { status: 'pending' });
    expect(
      listed.status === 'done' && (listed.output as { proposals: Proposal[] }).proposals,
    ).toEqual([{ ...proposal, decision }]);
    await expect(
      registry.execute(person, 'proposals.approve', {
        id: proposal.id,
        expectedPreview: decision.previewIdentity.digest,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('not a supported pending SOP default decision'),
    });
    expect(await stored()).toEqual([]);
    expect(await registry.execute(person, 'proposals.list', { status: 'pending' })).toEqual(listed);
  });

  it('retains the preparing person and attributes a human proposal apply to the applying person', async () => {
    const applyingId = newId('usr');
    await db.insert(users).values({ id: applyingId, orgId: person.orgId, displayName: 'Sam' });
    const applying: RecordContext = { ...person, actor: { type: 'user', userId: applyingId } };
    // Server-owned store fixture; this does not expose a prepare operation or arbitrary metadata writer.
    const proposal = await createProposal(db, person, {
      operationId: 'records.create',
      input,
      preview: {},
    });
    const result = await registry.execute(applying, 'proposals.approve', { id: proposal.id });
    expect(result.status === 'done' && result.output).toMatchObject({
      proposedBy: person.actor,
      decidedBy: applying.actor,
      receipt: { output: { createdBy: applying.actor, updatedBy: applying.actor } },
    });
    const ledger = await registry.execute(applying, 'activity.list', {});
    expect(
      ledger.status === 'done' &&
        (ledger.output as { entries: ActivityEntry[] }).entries.map((entry) => entry.actor),
    ).toEqual([applying.actor, applying.actor]);
  });
});

import {
  type ActivityEntry,
  type Actor,
  operationContracts,
  type Proposal,
  type Readiness,
  type RecordEnvelope,
  type ReviewItem,
  recordsReadiness,
  reviewList,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendMessage, createConversation } from '../assistant/store.ts';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { labs, records, recordVersions, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { memoryKinds } from '../memory/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { gadget, widget } from '../records/test-kinds.ts';
import { operationSchemas } from './describe.ts';
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

describe('the operation catalog', () => {
  it('registers exactly the contracts screens read their plain words from', () => {
    const registered = registry
      .list()
      .map((c) => c.id)
      .sort();
    expect(registered).toEqual([...operationContracts.keys()].sort());
    for (const contract of registry.list()) {
      expect(contract.verbs.done, contract.id).not.toContain(contract.id);
    }
  });
});

describe('calculation handles (ADR 0049)', () => {
  it('returns a handle with a calculator result, and records.update checks against it', async () => {
    const result = await registry.execute(person, 'sops.evaluate', {
      variables: [
        { name: 'wells', value: '8' },
        { name: 'well_volume', value: { value: '50', unit: 'uL' } },
        { name: 'total', expression: 'wells * well_volume' },
      ],
    });
    expect(result.status).toBe('done');
    const calculation = (result as { calculation?: string }).calculation;
    expect(calculation).toMatch(/^calc_/);
    const w = await create(agent);
    const updated = await run<RecordEnvelope>(agent, 'records.update', {
      id: w.id,
      expectedVersion: w.version,
      attributes: { color: 'teal', volume: { value: '400', unit: 'uL' } },
      evidence: { volume: { source: 'calculated', calculation } },
    });
    expect(updated.evidence.volume?.calculation).toBe(calculation);
    const error = await refused(
      registry.execute(agent, 'records.update', {
        id: w.id,
        expectedVersion: updated.version,
        attributes: { color: 'teal', volume: { value: '401', unit: 'uL' } },
        evidence: { volume: { source: 'calculated', calculation } },
      }),
    );
    expect(error.message).toMatch(/did not give this value/);
  });

  it('checks values marked as copied against the record they name', async () => {
    const source = await create(person, { status: 'active' });
    const draft = await create(person, { label: 'Draft source' });
    const update = (evidence: Record<string, unknown>, color = 'teal') =>
      registry.execute(agent, 'records.update', {
        id: target.id,
        expectedVersion: target.version,
        attributes: { ...attributes, color },
        evidence,
      });
    const target = await create(agent, { label: 'Target' });
    const from = (extra: Record<string, unknown> = {}) => ({
      color: { source: 'record', from: { id: source.id, version: 1, ...extra } },
    });
    expect((await refused(update(from({ id: 'wdg_01J9ZS4K8D6W3M5T7V9X1Y2Z3A' })))).message).toMatch(
      /not a record in this lab/,
    );
    expect((await refused(update(from({ version: 4 })))).message).toMatch(/doesn't have/);
    const draftRefusal = await refused(
      update({ color: { source: 'record', from: { id: draft.id, version: 1 } } }),
    );
    expect(draftRefusal.code).toBe('invalid_input');
    expect(draftRefusal.message).toContain('was draft, not confirmed');
    expect(draftRefusal.message).toContain(
      'assumed/unverified, with the actual draft source noted',
    );
    expect(draftRefusal.message).toContain(
      'A request to reuse a draft is not the person stating its literal values',
    );
    expect(draftRefusal.message).toContain('do not relabel them as stated');
    expect((await refused(update(from({ path: '/color' }), 'red'))).message).toMatch(
      /the value there is different/,
    );
    expect(
      (await refused(update({ color: { source: 'memory', from: { id: source.id, version: 1 } } })))
        .message,
    ).toMatch(/lab memory/);
    const ok = await update(from({ path: '/color' }));
    expect(ok.status).toBe('done');
  });

  it('refuses record evidence that does not say which record', async () => {
    const w = await create(agent);
    const error = await refused(
      registry.execute(agent, 'records.update', {
        id: w.id,
        expectedVersion: w.version,
        attributes: { color: 'red', volume: attributes.volume },
        evidence: { color: { source: 'record' } },
      }),
    );
    expect(error.message).toMatch(/names the record it came from/);
  });
});

const attributes = { color: 'teal', volume: { value: '50', unit: 'uL' } };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  const claude: Actor = { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: claude };
  bus = new ActivityBus();
  registry = createRegistry(db, new KindRegistry().register(widget).register(gadget), bus);
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

describe('creation origin across direct operation boundaries', () => {
  const origin = {
    type: 'user_message' as const,
    conversation: 'cnv_00000000000000000000000001',
    message: 'request-a',
  };
  it('persists the same trusted root for generic, specialized and direct change-set creates', async () => {
    for (const kind of memoryKinds) registry.deps.kinds.register(kind);
    const caller = { ...agent, origin };
    const generic = await create(caller);
    const specialized = await run<RecordEnvelope>(caller, 'memory.propose', {
      statement: 'A test-only convention',
      kind: 'convention',
      strength: 'note',
      appliesTo: { to: 'lab' },
      source: { from: 'conversation' },
    });
    const set = await run<{ results: { output: RecordEnvelope }[] }>(caller, 'changes.apply', {
      steps: [
        { operation: 'records.create', input: { kind: 'widget', label: 'First', attributes } },
        { operation: 'records.create', input: { kind: 'widget', label: 'Second', attributes } },
      ],
    });
    for (const record of [generic, specialized, ...set.results.map((r) => r.output)]) {
      expect(record.origin).toEqual(origin);
      expect((await run<RecordEnvelope>(person, 'records.get', { id: record.id })).origin).toEqual(
        origin,
      );
    }
  });

  it('rolls back created rows and their origin-bearing history on a later failing direct step', async () => {
    await expect(
      registry.execute({ ...agent, origin }, 'changes.apply', {
        steps: [
          {
            operation: 'records.create',
            input: { kind: 'widget', label: 'Rolled back', attributes },
          },
          {
            operation: 'records.update',
            input: { id: '$1.id', expectedVersion: 999, label: 'Fails' },
          },
        ],
      }),
    ).rejects.toBeDefined();
    expect(await db.select().from(records)).toEqual([]);
    expect(await db.select().from(recordVersions)).toEqual([]);
  });

  it('refuses public origin claims in generic/specialized creates, updates and restore', async () => {
    for (const kind of memoryKinds) registry.deps.kinds.register(kind);
    const record = await create({ ...agent, origin });
    const payloads = [
      ['records.create', { kind: 'widget', label: 'Forged', attributes, origin }],
      [
        'memory.propose',
        {
          statement: 'Forged',
          kind: 'convention',
          strength: 'note',
          appliesTo: { to: 'lab' },
          source: { from: 'conversation' },
          origin,
        },
      ],
      ['records.update', { id: record.id, expectedVersion: 1, label: 'Forged', origin }],
      ['records.restore', { id: record.id, expectedVersion: 1, version: 1, origin }],
      ['changes.apply', { steps: [], origin }],
    ] as const;
    for (const id of ['records.create', 'records.update', 'records.restore']) {
      const input = operationSchemas(registry.get(id).contract).input;
      expect(input.additionalProperties).toBe(false);
      expect(input.properties).not.toHaveProperty('origin');
    }
    for (const [operation, input] of payloads)
      expect((await refused(registry.execute(person, operation, input))).code).toBe(
        'invalid_input',
      );
    expect((await run<RecordEnvelope>(person, 'records.get', { id: record.id })).origin).toEqual(
      origin,
    );
  });

  it('keeps delayed ordinary proposal creation unknown despite an unrelated approver request', async () => {
    const result = await registry.execute({ ...agent, origin }, 'records.create', {
      kind: 'gadget',
      label: 'Delayed create',
      attributes: { color: 'teal' },
      status: 'active',
    });
    if (result.status !== 'proposed') throw new Error('Expected ordinary proposal');
    const approved = await run<Proposal>(
      { ...person, origin: { ...origin, message: 'approver-request-b' } },
      'proposals.approve',
      { id: result.proposal.id },
    );
    const created = approved.receipt?.output as RecordEnvelope;
    expect(created.origin).toEqual({ type: 'unknown' });
    expect(created.createdBy).toEqual(agent.actor);
    expect((await run<RecordEnvelope>(person, 'records.get', { id: created.id })).origin).toEqual({
      type: 'unknown',
    });
  });
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

  it('reads a record brief, without the confirmations, for agents with long records', async () => {
    const record = await create(agent);
    await run(person, 'records.confirm_section', {
      id: record.id,
      expectedVersion: 1,
      section: 'appearance',
    });
    const full = await run<RecordEnvelope>(agent, 'records.get', { id: record.id });
    expect(Object.keys(full.reviews)).toEqual(['appearance']);
    const brief = await run<RecordEnvelope>(agent, 'records.get', { id: record.id, brief: true });
    expect(brief).not.toHaveProperty('reviews');
    expect(brief.attributes).toEqual(full.attributes);
    expect(brief.evidence.volume?.source).toBe('assumed');
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
    // By ID, archived ones too: naming what a plate's wells hold.
    expect((await list({ ids: [rack.id, tipBox.id], limit: 1 })).sort()).toEqual(
      [rack.name, tipBox.name].sort(),
    );
    expect((await refused(registry.execute(person, 'records.list', { limit: 0 }))).code).toBe(
      'invalid_input',
    );
    expect((await refused(registry.execute(person, 'records.list', { ids: ['nope'] }))).code).toBe(
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
      kind: 'gadget',
      label: 'New',
      attributes: { color: 'teal' },
      status: 'active',
    });
    const [entry] = (
      await run<{ entries: { outcome: string; recordIds: string[] }[] }>(
        person,
        'activity.list',
        {},
      )
    ).entries;
    // The preview's record was rolled back, so the proposal names no record that doesn't exist.
    expect(entry?.outcome).toBe('proposed');
    expect(entry?.recordIds).toEqual([]);
  });

  it("names the records an approval made, not the proposal's preview", async () => {
    const { proposal } = (await registry.execute(agent, 'records.create', {
      kind: 'gadget',
      label: 'New',
      attributes: { color: 'teal' },
      status: 'active',
    })) as { proposal: Proposal };
    const previewId = (proposal.preview as RecordEnvelope).id;
    await run(person, 'proposals.approve', { id: proposal.id });
    const [made] = (await run<{ records: RecordEnvelope[] }>(person, 'records.list', {})).records;
    expect(made?.id).not.toBe(previewId);
    const entries = (
      await run<{ entries: { operationId: string; outcome: string; recordIds: string[] }[] }>(
        person,
        'activity.list',
        {},
      )
    ).entries;
    expect(entries.map((e) => [e.outcome, e.recordIds])).toEqual([
      ['approved', [made?.id]],
      ['succeeded', [made?.id]],
      ['proposed', []],
    ]);
  });

  it("never names another lab's record, even when a write touching it fails", async () => {
    const other = await createTenant(db, {
      orgName: 'Other',
      labName: 'Other lab',
      userName: 'Sam',
    });
    const sam: RecordContext = {
      actor: { type: 'user', userId: other.userId },
      orgId: other.orgId,
      labId: other.labId,
    };
    const theirs = await run<RecordEnvelope>(sam, 'records.create', {
      kind: 'gadget',
      label: 'Secret',
      attributes: { color: 'teal' },
    });
    const live: ActivityEntry[] = [];
    bus.subscribe(person.labId, (e) => live.push(e));
    const error = await refused(
      registry.execute(person, 'records.delete_draft', { id: theirs.id, expectedVersion: 1 }),
    );
    expect(error.code).toBe('not_found');
    const [entry] = (await run<{ entries: ActivityEntry[] }>(person, 'activity.list', {})).entries;
    expect(entry).toMatchObject({ outcome: 'failed', recordIds: [theirs.id] });
    expect(entry?.recordNames).toEqual({});
    expect(live.map((e) => e.recordNames)).toEqual([{}]);
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
    const draft = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'Clip',
      attributes: { color: 'red' },
    });
    const result = await registry.execute(agent, 'records.activate', {
      id: draft.id,
      expectedVersion: 1,
    });
    expect(result.status).toBe('proposed');
  });

  it("delete their own drafts directly, and propose deleting a person's", async () => {
    const theirs = await create(agent);
    expect(
      (await registry.execute(agent, 'records.delete_draft', { id: theirs.id, expectedVersion: 1 }))
        .status,
    ).toBe('done');

    const mine = await create(person);
    expect(
      (await registry.execute(agent, 'records.delete_draft', { id: mine.id, expectedVersion: 1 }))
        .status,
    ).toBe('proposed');

    // Another agent's draft, even one working for the same person, is not its own (C5).
    const other = { ...agent, actor: { ...agent.actor, agentName: 'Another agent' } };
    const byOther = await create(other);
    expect(
      (
        await registry.execute(agent, 'records.delete_draft', {
          id: byOther.id,
          expectedVersion: 1,
        })
      ).status,
    ).toBe('proposed');

    // An agent's draft a person has worked on is the person's too.
    const shared = await create(agent);
    await run(person, 'records.update', { id: shared.id, expectedVersion: 1, label: 'Edited' });
    await run(agent, 'records.update', { id: shared.id, expectedVersion: 2, label: 'Again' });
    expect(
      (
        await registry.execute(agent, 'records.delete_draft', {
          id: shared.id,
          expectedVersion: 3,
        })
      ).status,
    ).toBe('proposed');
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

describe('draft and confirm', () => {
  it('a person confirms sections and the readiness report follows', async () => {
    const draft = await create(agent, {
      evidence: { volume: { source: 'measured', note: 'Weighed on the bench balance' } },
    });
    const before = await run<Readiness>(person, 'records.readiness', { id: draft.id });
    // What the web client parses, including fields with no value (partOf).
    expect(() => recordsReadiness.output.parse(before)).not.toThrow();
    expect(before).toMatchObject({ ready: false, assumed: ['color'] });
    expect(before.checks.map((c) => [c.id, c.passed])).toEqual([
      ['volume_positive', true],
      ['color_known', true],
    ]);

    await run(person, 'records.confirm_section', {
      id: draft.id,
      expectedVersion: 1,
      section: 'appearance',
    });
    await run(person, 'records.confirm_section', {
      id: draft.id,
      expectedVersion: 2,
      section: 'volume',
      reason: 'Checked against the tube',
    });
    expect(await run<Readiness>(agent, 'records.readiness', { id: draft.id })).toMatchObject({
      ready: true,
      assumed: [],
      status: 'active',
      version: 3,
    });
  });

  it('refuses invalid input', async () => {
    const draft = await create(person);
    expect(
      (await refused(registry.execute(person, 'records.confirm_section', { id: draft.id }))).code,
    ).toBe('invalid_input');
    expect(
      (
        await refused(
          registry.execute(person, 'records.create', {
            kind: 'widget',
            label: 'x',
            attributes,
            evidence: { color: { source: 'person' } },
          }),
        )
      ).code,
    ).toBe('invalid_input');
    expect(
      (await refused(registry.execute(person, 'records.readiness', { id: 'nope' }))).code,
    ).toBe('invalid_input');
  });

  it('only people confirm; agents cannot skip review or ask to activate an unready draft', async () => {
    const draft = await create(agent);
    const forbidden = await refused(
      registry.execute(agent, 'records.confirm_section', {
        id: draft.id,
        expectedVersion: 1,
        section: 'appearance',
      }),
    );
    expect(forbidden.code).toBe('forbidden');
    expect(
      (
        await refused(
          registry.execute(agent, 'records.activate', { id: draft.id, expectedVersion: 1 }),
        )
      ).code,
    ).toBe('not_ready');
    expect((await refused(create(agent, { status: 'active' }))).code).toBe('invalid_state');
  });

  it('a person confirms everything ready in one step, and the draft becomes active', async () => {
    const draft = await create(agent);
    const confirmed = await run<RecordEnvelope>(person, 'records.confirm', {
      id: draft.id,
      expectedVersion: 1,
    });
    expect(confirmed).toMatchObject({ status: 'active', version: 2 });
    const state = await run<Readiness>(person, 'records.readiness', { id: draft.id });
    expect(state.sections.map((s) => [s.id, s.review?.confirmedBy])).toEqual([
      ['appearance', person.actor],
      ['volume', person.actor],
    ]);
  });

  it('leaves a section with a failing blocker unconfirmed, and says when nothing is left', async () => {
    const draft = await create(agent, {
      attributes: { ...attributes, volume: { value: '0', unit: 'uL' } },
    });
    const partly = await run<RecordEnvelope>(person, 'records.confirm', {
      id: draft.id,
      expectedVersion: 1,
    });
    expect(partly.status).toBe('draft');
    const state = await run<Readiness>(person, 'records.readiness', { id: draft.id });
    expect(state.sections.map((s) => [s.id, s.state])).toEqual([
      ['appearance', 'confirmed'],
      ['volume', 'needs_review'],
    ]);
    const blocked = await refused(
      registry.execute(person, 'records.confirm', { id: draft.id, expectedVersion: 2 }),
    );
    expect(blocked).toMatchObject({ code: 'invalid_state' });
    expect(blocked.message).toContain('Volume');
    expect(
      (await refused(registry.execute(person, 'records.confirm', { id: draft.id }))).code,
    ).toBe('invalid_input');
  });

  it('confirms a draft of a kind without sections by making it active', async () => {
    const draft = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'gadget',
      label: 'Clip',
      attributes: { color: 'red' },
    });
    const done = await run<RecordEnvelope>(person, 'records.confirm', {
      id: draft.id,
      expectedVersion: 1,
    });
    expect(done.status).toBe('active');
    const again = await refused(
      registry.execute(person, 'records.confirm', { id: draft.id, expectedVersion: 2 }),
    );
    expect(again.message).toBe('GDG-0001 is already confirmed');
  });

  it('only people confirm everything at once', async () => {
    const draft = await create(agent);
    const forbidden = await refused(
      registry.execute(agent, 'records.confirm', { id: draft.id, expectedVersion: 1 }),
    );
    expect(forbidden.code).toBe('forbidden');
  });

  it("approving an agent's change to an active record confirms the sections it changed", async () => {
    const record = await create(person, { status: 'active' });
    const proposed = await registry.execute(agent, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      attributes: { ...attributes, volume: { value: '80', unit: 'uL' } },
    });
    expect(proposed.status).toBe('proposed');
    const proposalId = (proposed as { proposal: { id: string } }).proposal.id;
    await run(person, 'proposals.approve', { id: proposalId });

    const state = await run<Readiness>(person, 'records.readiness', { id: record.id });
    expect(state).toMatchObject({ ready: true, assumed: [] });
    const volume = state.sections.find((s) => s.id === 'volume');
    expect(volume?.review).toMatchObject({ confirmedBy: person.actor, version: 2 });
    expect(volume?.fields[0]?.evidence).toMatchObject({ source: 'assumed', by: agent.actor });
  });

  it('lists each kind with its sections and checks', async () => {
    const { kinds } = await run<{
      kinds: { kind: string; sections: { id: string }[]; checks: { id: string }[] }[];
    }>(agent, 'records.kinds', {});
    const found = kinds.find((k) => k.kind === 'widget');
    expect(found?.sections.map((s) => s.id)).toEqual(['appearance', 'volume']);
    expect(found?.checks.map((c) => c.id)).toEqual(['volume_positive', 'color_known']);
    expect(kinds.find((k) => k.kind === 'gadget')?.sections).toEqual([]);
  });
});

describe('review inbox', () => {
  it('lists drafts to confirm and proposed changes, newest first', async () => {
    const draft = await create(agent);
    await run(person, 'records.confirm_section', {
      id: draft.id,
      expectedVersion: 1,
      section: 'appearance',
    });
    const active = await create(person, { status: 'active', label: 'Rack' });
    await registry.execute(agent, 'records.update', {
      id: active.id,
      expectedVersion: 1,
      label: 'Rack (blue)',
    });

    const output = await run<{ items: ReviewItem[]; counts: unknown }>(person, 'review.list', {});
    expect(() => reviewList.output.parse(output)).not.toThrow();
    // Counts come first, so a reader whose view is cut keeps the totals; limit lists fewer.
    expect(Object.keys(output)).toEqual(['counts', 'items']);
    const one = await run<{ items: ReviewItem[]; counts: { total: number } }>(
      person,
      'review.list',
      { limit: 1 },
    );
    expect(one.items).toHaveLength(1);
    expect(one.counts.total).toBe(2);
    const { items } = output;
    expect(output.counts).toEqual({
      total: 2,
      changes: 1,
      mentions: 0,
      notices: 0,
      needsYou: 1,
      drafts: { widget: 1 },
    });
    expect(items.map((i) => i.type)).toEqual(['change', 'draft']);
    // A proposed change blocks the agent, so it needs you; a draft waits to be confirmed.
    expect(items.map((i) => i.tier)).toEqual(['needs_you', 'to_confirm']);
    expect(items.every((i) => i.for === (person.actor as { userId: string }).userId)).toBe(true);
    expect(items[1]).toMatchObject({
      type: 'draft',
      record: { id: draft.id, name: 'WDG-0001' },
      sectionsToConfirm: ['Volume'],
      missing: ['Volume is not confirmed'],
      blockers: [],
      ready: false,
      assumed: 1,
      byAgent: true,
      batchable: false,
    });
  });

  it('names what blocks each draft, apart from the sections left to confirm', async () => {
    const empty = await create(agent, {
      label: 'Empty',
      attributes: { ...attributes, volume: { value: '0', unit: 'uL' } },
    });
    const { items } = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    expect(items.find((i) => i.type === 'draft' && i.record.id === empty.id)).toMatchObject({
      blockers: ['Volume is 0 uL'],
      missing: ['Appearance is not confirmed', 'Volume is not confirmed', 'Volume is 0 uL'],
    });
  });

  it('confirms a batch only when nothing in it is a guess or unchecked, all or nothing', async () => {
    const stated = { source: 'stated', note: 'Wali said so' };
    const clean = await create(agent, { evidence: { color: stated, volume: stated } });
    const second = await create(agent, {
      label: 'Second',
      evidence: { color: stated, volume: stated },
    });
    const guessed = await create(agent, { label: 'Guessed' });
    // An agent's word that a value is from a datasheet isn't checked, so a person looks at it.
    const sheet = { source: 'datasheet', reference: 'https://example.org' };
    const sourced = await create(agent, {
      label: 'Sourced',
      evidence: { color: stated, volume: sheet },
    });
    const listed = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    const batchable = listed.items.flatMap((i) =>
      i.type === 'draft' && i.batchable ? [i.record.id] : [],
    );
    expect(batchable.sort()).toEqual([clean.id, second.id].sort());
    expect(
      listed.items.find((i) => i.type === 'draft' && i.record.id === sourced.id),
    ).toMatchObject({ batchable: false, unchecked: 1, assumed: 0 });
    const unchecked = await refused(
      registry.execute(person, 'records.confirm_many', {
        records: [{ id: sourced.id, expectedVersion: sourced.version }],
      }),
    );
    expect(unchecked.message).toContain('1 sourced by an agent and not checked');

    const refusedBatch = await refused(
      registry.execute(person, 'records.confirm_many', {
        records: [clean, guessed].map((r) => ({ id: r.id, expectedVersion: r.version })),
      }),
    );
    expect(refusedBatch.message).toMatch(/Nothing was confirmed.*WDG-0003 \(2 assumed\)/);
    expect((await run<RecordEnvelope>(person, 'records.get', { id: clean.id })).status).toBe(
      'draft',
    );

    const done = await run<{ confirmed: { status: string }[] }>(person, 'records.confirm_many', {
      records: [clean, second].map((r) => ({ id: r.id, expectedVersion: r.version })),
    });
    expect(done.confirmed.map((r) => r.status)).toEqual(['active', 'active']);
    expect(
      (
        await refused(
          registry.execute(agent, 'records.confirm_many', {
            records: [{ id: guessed.id, expectedVersion: guessed.version }],
          }),
        )
      ).code,
    ).toBe('forbidden');
  });

  it('lets warnings pass a batch confirm, counted', async () => {
    const sourced = { source: 'stated' };
    const warned = await create(agent, {
      attributes: { ...attributes, color: 'unknown' },
      evidence: { color: sourced, volume: sourced },
    });
    const listed = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    expect(listed.items[0]).toMatchObject({ batchable: true, warnings: 1 });
    const done = await run<{ confirmed: { status: string }[] }>(person, 'records.confirm_many', {
      records: [{ id: warned.id, expectedVersion: warned.version }],
    });
    expect(done.confirmed.map((r) => r.status)).toEqual(['active']);
  });

  it('confirms a batch of drafts whose kind has no sections, and counts their guesses', async () => {
    // Stated by the person the agent works for: batchable. A datasheet only the agent vouches for
    // is a source to check, so it opens on its own (C4, Wali 2026-10-01).
    const sourced = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'Sourced',
      attributes: { color: 'red' },
      evidence: { color: { source: 'stated' } },
    });
    const guessed = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'Guessed',
      attributes: { color: 'blue' },
    });
    const fromSheet = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'From a sheet',
      attributes: { color: 'green' },
      evidence: { color: { source: 'datasheet', reference: 'https://example.org' } },
    });
    const listed = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    const drafts = listed.items.flatMap((i) => (i.type === 'draft' ? [i] : []));
    expect(drafts.find((i) => i.record.id === guessed.id)).toMatchObject({
      batchable: false,
      assumed: 1,
    });
    expect(drafts.find((i) => i.record.id === fromSheet.id)).toMatchObject({
      batchable: false,
      unchecked: 1,
    });
    expect(drafts.find((i) => i.record.id === sourced.id)?.batchable).toBe(true);
    const done = await run<{ confirmed: { status: string }[] }>(person, 'records.confirm_many', {
      records: [{ id: sourced.id, expectedVersion: sourced.version }],
    });
    expect(done.confirmed.map((r) => r.status)).toEqual(['active']);
  });

  it('stores the readiness summary with the record at every write', async () => {
    const draft = await create(agent);
    expect(draft.readiness).toEqual({
      ready: false,
      blockers: 0,
      warnings: 0,
      assumed: 2,
      sectionsLeft: ['Appearance', 'Volume'],
      changed: [],
    });
    const confirmed = await run<RecordEnvelope>(person, 'records.confirm', {
      id: draft.id,
      expectedVersion: draft.version,
    });
    expect(confirmed.readiness).toMatchObject({ ready: true, assumed: 0, sectionsLeft: [] });
  });

  it('counts every draft per kind, and lists one kind on its own', async () => {
    await create(agent);
    await create(agent, { label: 'Second' });
    const active = await create(person, { status: 'active', label: 'Rack' });
    await registry.execute(agent, 'records.update', {
      id: active.id,
      expectedVersion: 1,
      label: 'Rack (blue)',
    });

    const one = await run<{ items: ReviewItem[]; counts: { drafts: Record<string, number> } }>(
      person,
      'review.list',
      { kind: 'widget' },
    );
    // The kind filter leaves proposed changes out of the items but not out of the counts.
    expect(one.items.map((i) => i.type)).toEqual(['draft', 'draft']);
    expect(one.counts).toEqual({
      total: 3,
      changes: 1,
      mentions: 0,
      notices: 0,
      needsYou: 1,
      drafts: { widget: 2 },
    });
  });

  it('puts the most urgent first, groups an agent conversation and raises notices', async () => {
    const gadget = (ctx: RecordContext, label: string, extra: Record<string, unknown> = {}) =>
      run<RecordEnvelope>(ctx, 'records.create', {
        kind: 'gadget',
        label,
        attributes: { color: 'red', ...extra },
        ...(ctx === person && extra.checkBy ? { status: 'active' } : {}),
      });
    const later = await gadget(person, 'Due later', { due: '2030-02-01' });
    const sooner = await gadget(person, 'Due sooner', { due: '2030-01-01' });
    const part = await create(person, { label: 'Part' });
    await create(person, { label: 'Whole', attributes: { ...attributes, partOf: part.id } });
    const plain = await create(person, { label: 'Plain' });
    const stale = await gadget(person, 'Stale', { checkBy: '2020-01-01' });
    await gadget(person, 'Fresh', { checkBy: '2999-01-01' });
    const session = { ...agent, actor: { ...agent.actor, sessionRef: 'cnv_test' } as Actor };
    const first = await create(session, { label: 'First of the ask' });
    const second = await create(session, { label: 'Second of the ask' });
    const samId = 'usr_01J9ZS4K8D6W3M5T7V9X1Y2Z3B';
    await db.insert(users).values({ id: samId, orgId: person.orgId, displayName: 'Sam' });
    const theirs = await create(
      { ...person, actor: { type: 'user', userId: samId } },
      {
        label: 'Theirs',
      },
    );

    const { items, counts } = await run<{ items: ReviewItem[]; counts: { notices: number } }>(
      person,
      'review.list',
      {},
    );
    const ids = items.map((i) =>
      i.type === 'draft' ? i.record.id : i.type === 'notice' ? i.about.id : i.type,
    );
    // Due dates first, earliest first; then drafts others wait on; then the newest; notices last.
    expect(ids.slice(0, 3)).toEqual([sooner.id, later.id, part.id]);
    expect(ids.at(-1)).toBe(stale.id);
    expect(ids.indexOf(theirs.id)).toBeLessThan(ids.indexOf(plain.id));
    expect(items[0]).toMatchObject({ due: '2030-01-01' });
    expect(items[2]).toMatchObject({ blocking: [{ label: 'Whole', kind: 'widget' }] });
    expect(items.at(-1)).toMatchObject({
      type: 'notice',
      tier: 'fyi',
      due: '2020-01-01',
      about: { id: stale.id, name: stale.name, label: 'Stale' },
      message: 'Check the color',
    });
    expect(counts.notices).toBe(1);
    for (const id of [first.id, second.id])
      expect(items.find((i) => i.type === 'draft' && i.record.id === id)?.group).toBeUndefined();
    expect(
      items.find((i) => i.type === 'draft' && i.record.id === plain.id)?.group,
    ).toBeUndefined();
    // Only yours, with the lab's notices kept.
    const mine = await run<{ items: ReviewItem[] }>(person, 'review.list', { mine: true });
    expect(mine.items.some((i) => i.type === 'draft' && i.record.id === theirs.id)).toBe(false);
    expect(mine.items.some((i) => i.type === 'notice')).toBe(true);
    expect(() => reviewList.output.parse({ items, counts })).not.toThrow();
  });

  it('groups drafts by separate saved requests, retaining the original across continuation and edits', async () => {
    const conversation = await createConversation(db, person, {
      title: 'First chat title',
      agentName: 'Claude',
      provider: 'test',
      model: 'test',
    });
    const request = await appendMessage(db, conversation.id, {
      role: 'user',
      text: '  Make A1 and A2\nfrom the source draft  ',
    });
    const separate = await appendMessage(db, conversation.id, {
      role: 'user',
      text: 'Make B1 as a separate request',
    });
    if (
      request.role !== 'user' ||
      separate.role !== 'user' ||
      request.origin?.type !== 'user_message' ||
      separate.origin?.type !== 'user_message'
    )
      throw new Error('Expected user requests');
    const firstCtx = {
      ...agent,
      origin: request.origin,
      actor: { ...agent.actor, sessionRef: conversation.id } as Actor,
    };
    const first = await create(firstCtx, { label: 'A1' });
    const second = await create(firstCtx, { label: 'A2' });
    const third = await create({ ...firstCtx, origin: separate.origin }, { label: 'B1' });
    const reply = await createConversation(db, person, {
      title: 'Reply chat',
      agentName: 'Claude',
      provider: 'test',
      model: 'test',
    });
    const continued = await create(
      { ...firstCtx, actor: { ...agent.actor, sessionRef: reply.id } as Actor },
      { label: 'Contextual continuation' },
    );
    await run({ ...agent, origin: separate.origin }, 'records.update', {
      id: first.id,
      expectedVersion: 1,
      label: 'A1 edited later',
    });
    const result = await run<{
      items: ReviewItem[];
      counts: { total: number; drafts: { widget: number } };
    }>(person, 'review.list', {});
    expect(result.counts).toMatchObject({ total: 4, drafts: { widget: 4 } });
    const drafts = result.items.filter((item) => item.type === 'draft');
    expect(drafts.map((item) => item.record.id).sort()).toEqual(
      [first.id, second.id, third.id, continued.id].sort(),
    );
    const firstGroup = drafts.find((item) => item.record.id === first.id)?.group;
    expect(firstGroup?.title).toBe('Make A1 and A2 from the source draft');
    for (const record of [second, continued])
      expect(drafts.find((item) => item.record.id === record.id)?.group).toEqual(firstGroup);
    const separateGroup = drafts.find((item) => item.record.id === third.id)?.group;
    expect(separateGroup?.title).toBe('Make B1 as a separate request');
    expect(separateGroup?.id).not.toBe(firstGroup?.id);
    for (const draft of drafts) expect(draft).toMatchObject({ batchable: false, assumed: 2 });
    expect(drafts[0]?.record.id).toBe(first.id);
    const limited = await run<{ items: ReviewItem[] }>(person, 'review.list', {
      kind: 'widget',
      mine: true,
      limit: 1,
    });
    expect(limited.items).toEqual(result.items.slice(0, 1));
  });

  it('uses only exact user-message labels authorized for this org, lab and person', async () => {
    const own = await createConversation(db, person, {
      title: 'Wrong conversation title',
      agentName: 'Claude',
      provider: 'test',
      model: 'test',
    });
    const message = await appendMessage(db, own.id, {
      role: 'user',
      text: 'Authorized request text',
    });
    const otherLab = 'lab_01J9ZS4K8D6W3M5T7V9X1Y2Z3B';
    await db.insert(labs).values({ id: otherLab, orgId: person.orgId, name: 'Other lab' });
    const otherCtx = { ...person, labId: otherLab };
    const foreign = await createConversation(db, otherCtx, {
      title: 'Foreign title',
      agentName: 'Claude',
      provider: 'test',
      model: 'test',
    });
    const foreignMessage = await appendMessage(db, foreign.id, {
      role: 'user',
      text: 'FOREIGN PRIVATE TEXT',
    });
    const samId = 'usr_01J9ZS4K8D6W3M5T7V9X1Y2Z3B';
    await db.insert(users).values({ id: samId, orgId: person.orgId, displayName: 'Sam' });
    const sam = await createConversation(
      db,
      { ...person, actor: { type: 'user', userId: samId } },
      { title: 'Sam title', agentName: 'Claude', provider: 'test', model: 'test' },
    );
    const samMessage = await appendMessage(db, sam.id, {
      role: 'user',
      text: 'SAME LAB PRIVATE TEXT',
    });
    const assistant = await appendMessage(db, own.id, {
      role: 'assistant',
      text: 'NOT A USER REQUEST',
      toolCalls: [],
      model: 'test',
    });
    if (
      message.role !== 'user' ||
      foreignMessage.role !== 'user' ||
      samMessage.role !== 'user' ||
      message.origin?.type !== 'user_message' ||
      foreignMessage.origin?.type !== 'user_message' ||
      samMessage.origin?.type !== 'user_message'
    )
      throw new Error('Expected user requests');
    const known = await create({ ...agent, origin: message.origin });
    const unavailable = [];
    for (const origin of [
      foreignMessage.origin,
      samMessage.origin,
      { type: 'user_message' as const, conversation: own.id, message: foreignMessage.id },
      { type: 'user_message' as const, conversation: own.id, message: assistant.id },
      { type: 'user_message' as const, conversation: own.id, message: 'missing-message' },
    ]) {
      unavailable.push(await create({ ...agent, origin }));
    }
    const { items } = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    expect(
      items.find((item) => item.type === 'draft' && item.record.id === known.id)?.group?.title,
    ).toBe('Authorized request text');
    for (const record of unavailable)
      expect(
        items.find((item) => item.type === 'draft' && item.record.id === record.id)?.group?.title,
      ).toBe('Saved request (text unavailable)');
    expect(JSON.stringify(items)).not.toMatch(
      /FOREIGN PRIVATE|SAME LAB PRIVATE|NOT A USER REQUEST|Wrong conversation title/,
    );
    const asAgent = await run<{ items: ReviewItem[] }>(agent, 'review.list', {});
    expect(asAgent.items).toEqual(items);
  });

  it('keeps absent and unknown draft origins individual while preserving proposal session groups', async () => {
    const conversation = await createConversation(db, person, {
      title: 'Existing proposal conversation',
      agentName: 'Claude',
      provider: 'test',
      model: 'test',
    });
    const ctx = { ...agent, actor: { ...agent.actor, sessionRef: conversation.id } as Actor };
    const unknown = await create(ctx);
    const historical = await create(ctx);
    await db.update(records).set({ origin: null }).where(eq(records.id, historical.id));
    const active = await create(person, { status: 'active' });
    for (const label of ['Proposed first edit', 'Proposed second edit']) {
      expect(
        (
          await registry.execute(ctx, 'records.update', {
            id: active.id,
            expectedVersion: 1,
            label,
          })
        ).status,
      ).toBe('proposed');
    }
    const { items, counts } = await run<{
      items: ReviewItem[];
      counts: { total: number; changes: number };
    }>(person, 'review.list', {});
    expect(counts).toMatchObject({ total: 4, changes: 2 });
    for (const record of [unknown, historical])
      expect(
        items.find((item) => item.type === 'draft' && item.record.id === record.id)?.group,
      ).toBeUndefined();
    const changes = items.filter((item) => item.type === 'change');
    expect(changes).toHaveLength(2);
    for (const change of changes)
      expect(change.group).toEqual({
        id: conversation.id,
        title: 'Existing proposal conversation',
      });
    expect(changes.map((item) => item.tier)).toEqual(['needs_you', 'needs_you']);
  });

  it('is empty when nothing waits, and refuses unknown input', async () => {
    await create(person, { status: 'active' });
    expect(await run(agent, 'review.list', {})).toEqual({
      items: [],
      counts: { total: 0, changes: 0, mentions: 0, notices: 0, needsYou: 0, drafts: {} },
    });
    expect((await refused(registry.execute(person, 'review.list', { x: 1 }))).code).toBe(
      'invalid_input',
    );
  });
});

describe('change sets (ADR 0051)', () => {
  it('run in order with references, as one ledger entry', async () => {
    const result = await run<{ results: { output: RecordEnvelope }[] }>(person, 'changes.apply', {
      steps: [
        { operation: 'records.create', input: { kind: 'widget', label: 'Rack', attributes } },
        {
          operation: 'records.create',
          input: { kind: 'widget', label: 'Tip', attributes: { ...attributes, partOf: '$1.id' } },
        },
      ],
    });
    const [rack, tip] = result.results.map((r) => r.output);
    expect(tip?.attributes.partOf).toBe(rack?.id);
    const entries = await ledger();
    expect(entries.map((e) => e.operationId)).toEqual(['changes.apply']);
    expect((entries[0] as unknown as { recordIds: string[] }).recordIds.sort()).toEqual(
      [rack?.id, tip?.id].sort(),
    );
  });

  it('change nothing when a step fails, and name the step', async () => {
    const error = await refused(
      registry.execute(person, 'changes.apply', {
        steps: [
          { operation: 'records.create', input: { kind: 'widget', label: 'Rack', attributes } },
          { operation: 'records.update', input: { id: '$1.id', expectedVersion: 9, label: 'x' } },
        ],
      }),
    );
    expect(error.message).toMatch(/^Step 2 \(records.update\).*Nothing in the set was changed/);
    const listed = await run<{ records: unknown[] }>(person, 'records.list', { kind: 'widget' });
    expect(listed.records).toHaveLength(0);
  });

  it('keeps copied-draft refusal atomic and permits truthful assumed drafts without confirming their source', async () => {
    const source = await create(agent, { label: 'Unconfirmed source' });
    const target = await create(agent, { label: 'Existing draft' });
    const beforeRecords = await db.select().from(records);
    const beforeVersions = await db.select().from(recordVersions);
    const error = await refused(
      registry.execute(agent, 'changes.apply', {
        steps: [
          {
            operation: 'records.create',
            input: { kind: 'widget', label: 'Rolled back', attributes },
          },
          {
            operation: 'records.update',
            input: {
              id: target.id,
              expectedVersion: target.version,
              attributes,
              evidence: {
                color: { source: 'record', from: { id: source.id, version: 1, path: '/color' } },
              },
            },
          },
        ],
      }),
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toMatch(/^Step 2 \(records.update\).*was draft, not confirmed/);
    expect(error.message).toContain('do not relabel them as stated');
    expect(error.message).toContain('Nothing in the set was changed');
    expect(await db.select().from(records)).toEqual(beforeRecords);
    expect(await db.select().from(recordVersions)).toEqual(beforeVersions);

    const note = `Read from unconfirmed ${source.name} version 1; not verified`;
    const reused = await create(agent, {
      label: 'Unverified reuse',
      evidence: {
        color: { source: 'assumed', note },
        volume: { source: 'assumed', note },
      },
    });
    expect(reused.status).toBe('draft');
    expect(reused.evidence.color).toMatchObject({ source: 'assumed', note });
    expect(reused.evidence.volume).toMatchObject({ source: 'assumed', note });
    const { items } = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    expect(
      items.find((item) => item.type === 'draft' && item.record.id === reused.id),
    ).toMatchObject({
      batchable: false,
      assumed: 2,
    });
    expect(await run<RecordEnvelope>(person, 'records.get', { id: source.id })).toEqual(source);
    expect(await run<RecordEnvelope>(person, 'records.get', { id: target.id })).toEqual(target);
  });

  it('keep a calculator step result, so a later step marks a value calculated from it', async () => {
    const dilution = {
      operation: 'transfers.dilution_options',
      input: {
        stock: { value: '10', unit: 'mM' },
        targets: [{ value: '10', unit: 'uM' }],
        finalVolume: { value: '50', unit: 'uL' },
        device: {
          limits: { min: { value: '2.5', unit: 'nL' }, step: { value: '2.5', unit: 'nL' } },
        },
      },
    };
    const calculated = {
      source: 'calculated',
      calculation: '$1.calculation',
      output: '/points/0/direct/volume/achieved',
    };
    const result = await run<{ results: { output: RecordEnvelope; calculation?: string }[] }>(
      agent,
      'changes.apply',
      {
        steps: [
          dilution,
          {
            operation: 'records.create',
            input: {
              kind: 'widget',
              label: 'Compound well',
              attributes: { color: 'clear', volume: { value: '50', unit: 'nL' } },
              evidence: { volume: calculated },
            },
          },
        ],
      },
    );
    const [step1, step2] = result.results;
    expect(step1?.calculation).toMatch(/^calc_/);
    expect(step2?.output.evidence.volume).toMatchObject({
      source: 'calculated',
      calculation: step1?.calculation,
    });
    // A value the calculation did not give is refused, and nothing in the set is kept.
    const wrong = await refused(
      registry.execute(agent, 'changes.apply', {
        steps: [
          dilution,
          {
            operation: 'records.create',
            input: {
              kind: 'widget',
              label: 'Wrong well',
              attributes: { color: 'clear', volume: { value: '60', unit: 'nL' } },
              evidence: { volume: calculated },
            },
          },
        ],
      }),
    );
    expect(wrong.message).toMatch(/^Step 2 \(records.create\)/);
    const notCalculator = await refused(
      registry.execute(agent, 'changes.apply', {
        steps: [
          { operation: 'records.create', input: { kind: 'widget', label: 'A', attributes } },
          {
            operation: 'records.create',
            input: {
              kind: 'widget',
              label: 'B',
              attributes,
              evidence: { volume: { source: 'calculated', calculation: '$1.calculation' } },
            },
          },
        ],
      }),
    );
    expect(notCalculator.message).toMatch(/step 1 is not a calculator/);
  });

  it('refuse references to later steps and missing outputs', async () => {
    const forward = await refused(
      registry.execute(person, 'changes.apply', {
        steps: [
          { operation: 'records.get', input: { id: '$2.id' } },
          { operation: 'records.create', input: { kind: 'widget', label: 'Rack', attributes } },
        ],
      }),
    );
    expect(forward.message).toMatch(/only use the steps before it/);
    const missing = await refused(
      registry.execute(person, 'changes.apply', {
        steps: [
          { operation: 'records.create', input: { kind: 'widget', label: 'Rack', attributes } },
          { operation: 'records.get', input: { id: '$1.nothing' } },
        ],
      }),
    );
    expect(missing.message).toMatch(/does not have/);
  });

  it('become one proposal when any step needs a person, applied as one on approval', async () => {
    const active = await create(person, { status: 'active' });
    const result = await registry.execute(agent, 'changes.apply', {
      reason: 'Put the tip in the rack',
      steps: [
        { operation: 'records.create', input: { kind: 'widget', label: 'Tip', attributes } },
        {
          operation: 'records.update',
          input: { id: active.id, expectedVersion: 1, label: 'Rack with tip' },
        },
      ],
    });
    expect(result.status).toBe('proposed');
    const { proposal } = result as { proposal: Proposal };
    expect((proposal.preview as { results: unknown[] }).results).toHaveLength(2);
    expect(
      (await run<{ records: unknown[] }>(person, 'records.list', { kind: 'widget' })).records,
    ).toHaveLength(1);

    const approved = await run<Proposal>(person, 'proposals.approve', { id: proposal.id });
    expect(approved.status).toBe('approved');
    const after = await run<RecordEnvelope>(person, 'records.get', { id: active.id });
    expect(after.label).toBe('Rack with tip');
    expect(after.updatedBy).toEqual(agent.actor);
    expect(
      (await run<{ records: unknown[] }>(person, 'records.list', { kind: 'widget' })).records,
    ).toHaveLength(2);
  });

  it('run directly for an agent when every step would', async () => {
    const result = await registry.execute(agent, 'changes.apply', {
      steps: [
        { operation: 'records.create', input: { kind: 'widget', label: 'A', attributes } },
        { operation: 'records.create', input: { kind: 'widget', label: 'B', attributes } },
      ],
    });
    expect(result.status).toBe('done');
  });

  it('refuse people-only steps from an agent, and nested sets', async () => {
    const w = await create(agent);
    expect(
      (
        await refused(
          registry.execute(agent, 'changes.apply', {
            steps: [
              {
                operation: 'records.confirm_many',
                input: { records: [{ id: w.id, expectedVersion: 1 }] },
              },
            ],
          }),
        )
      ).code,
    ).toBe('forbidden');
    expect(
      (
        await refused(
          registry.execute(person, 'changes.apply', {
            steps: [{ operation: 'changes.apply', input: { steps: [] } }],
          }),
        )
      ).message,
    ).toMatch(/cannot hold another change set/);
  });
});

describe('what changed (ADR 0053)', () => {
  type Diff = {
    from: number;
    to: number;
    since: string;
    changes: { path: string; change: string; before?: unknown; after?: unknown }[];
    versions: { version: number; via?: string }[];
  };

  it('names the operation on each version', async () => {
    const w = await create(agent);
    await run(agent, 'records.update', { id: w.id, expectedVersion: 1, label: 'Rack' });
    const { versions } = await run<{ versions: { via?: string }[] }>(person, 'records.history', {
      id: w.id,
    });
    expect(versions.map((v) => v.via)).toEqual(['records.create', 'records.update']);
  });

  it('diffs since the person last looked, or since first drafted', async () => {
    const w = await create(agent);
    await run(agent, 'records.update', {
      id: w.id,
      expectedVersion: 1,
      attributes: { ...attributes, color: 'red' },
    });
    const first = await run<Diff>(person, 'records.diff', { id: w.id });
    expect(first).toMatchObject({ from: 1, to: 2, since: 'first_drafted' });
    expect(first.changes).toEqual([
      { path: '/color', change: 'changed', before: 'teal', after: 'red' },
    ]);

    await run(person, 'records.mark_seen', { id: w.id, version: 2 });
    expect((await run<Diff>(person, 'records.diff', { id: w.id })).changes).toEqual([]);
    await run(agent, 'records.update', { id: w.id, expectedVersion: 2, label: 'Rack' });
    // The agent reads the same marker, as the person it works for.
    const since = await run<Diff>(agent, 'records.diff', { id: w.id });
    expect(since).toMatchObject({ from: 2, to: 3, since: 'seen' });
    expect(since.changes).toEqual([
      { path: '/label', change: 'changed', before: 'Tip box', after: 'Rack' },
    ]);
    expect(since.versions).toMatchObject([{ version: 3, via: 'records.update' }]);
    expect(
      (await refused(registry.execute(person, 'records.diff', { id: w.id, from: 3, to: 2 }))).code,
    ).toBe('invalid_input');
  });

  it("counts a person's own writes and approvals as seen", async () => {
    const w = await create(agent);
    await run(person, 'records.update', { id: w.id, expectedVersion: 1, label: 'Mine' });
    expect(await run<Diff>(person, 'records.diff', { id: w.id })).toMatchObject({
      from: 2,
      to: 2,
      since: 'seen',
      changes: [],
    });
    // An agent's own write leaves the marker where it was.
    await run(agent, 'records.update', { id: w.id, expectedVersion: 2, label: 'Agent' });
    expect(await run<Diff>(person, 'records.diff', { id: w.id })).toMatchObject({ from: 2, to: 3 });

    const active = await create(person, { status: 'active' });
    const { proposal } = (await registry.execute(agent, 'records.update', {
      id: active.id,
      expectedVersion: 1,
      label: 'Proposed',
    })) as { proposal: Proposal };
    await run(person, 'proposals.approve', { id: proposal.id });
    expect(await run<Diff>(person, 'records.diff', { id: active.id })).toMatchObject({
      from: 2,
      to: 2,
      changes: [],
    });
  });

  it('keeps the seen marker to people and out of the ledger', async () => {
    const w = await create(person);
    expect(
      (await refused(registry.execute(agent, 'records.mark_seen', { id: w.id, version: 1 }))).code,
    ).toBe('forbidden');
    await run(person, 'records.mark_seen', { id: w.id, version: 1 });
    expect((await ledger()).map((e) => e.operationId)).toEqual(['records.create']);
    expect(
      (await refused(registry.execute(person, 'records.mark_seen', { id: w.id, version: 5 }))).code,
    ).toBe('invalid_input');
  });

  it('filters the ledger by record, actor, mine and time', async () => {
    const a = await create(person);
    const before = new Date().toISOString();
    const b = await create(agent);
    const list = async (input: Record<string, unknown>) =>
      (
        await run<{ entries: { operationId: string; recordIds: string[] }[] }>(
          person,
          'activity.list',
          input,
        )
      ).entries;
    expect((await list({ record: a.id })).map((e) => e.recordIds)).toEqual([[a.id]]);
    expect((await list({ actor: 'agents' })).map((e) => e.recordIds)).toEqual([[b.id]]);
    expect((await list({ actor: 'people' })).map((e) => e.recordIds)).toEqual([[a.id]]);
    expect(await list({ mine: true })).toHaveLength(2);
    expect((await list({ since: before })).map((e) => e.recordIds)).toEqual([[b.id]]);
  });
});

describe('records.kinds (ADR 0055)', () => {
  type Kinds = { kinds: { kind: string; attributes?: unknown; checks?: unknown }[] };
  it('lists every kind in full, a summary without schemas, or only the kinds asked for', async () => {
    const full = await run<Kinds>(agent, 'records.kinds', {});
    expect(full.kinds.map((k) => k.kind).sort()).toEqual(['gadget', 'widget']);
    expect(full.kinds[0]?.attributes).toBeDefined();
    const summary = await run<Kinds>(agent, 'records.kinds', { summary: true });
    expect(summary.kinds.every((k) => k.attributes === undefined && k.checks === undefined)).toBe(
      true,
    );
    const one = await run<Kinds>(agent, 'records.kinds', { kinds: ['widget'] });
    expect(one.kinds.map((k) => k.kind)).toEqual(['widget']);
    expect(
      (await refused(registry.execute(agent, 'records.kinds', { kinds: ['nope'] }))).code,
    ).toBe('unknown_kind');
  });
});

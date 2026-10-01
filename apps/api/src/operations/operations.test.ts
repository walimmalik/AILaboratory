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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { gadget, widget } from '../records/test-kinds.ts';
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
    expect(
      (await refused(update({ color: { source: 'record', from: { id: draft.id, version: 1 } } })))
        .message,
    ).toMatch(/was draft, not confirmed/);
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
    const { items } = output;
    expect(output.counts).toEqual({
      total: 2,
      changes: 1,
      mentions: 0,
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
      ready: false,
      assumed: 1,
      byAgent: true,
      batchable: false,
    });
  });

  it('confirms a batch only when nothing in it is a guess, all or nothing', async () => {
    const clean = await create(agent, {
      evidence: {
        color: { source: 'datasheet', reference: 'https://example.org' },
        volume: { source: 'datasheet', reference: 'https://example.org' },
      },
    });
    const second = await create(agent, {
      label: 'Second',
      evidence: {
        color: { source: 'datasheet', reference: 'https://example.org' },
        volume: { source: 'datasheet', reference: 'https://example.org' },
      },
    });
    const guessed = await create(agent, { label: 'Guessed' });
    const listed = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    const batchable = listed.items.flatMap((i) =>
      i.type === 'draft' && i.batchable ? [i.record.id] : [],
    );
    expect(batchable.sort()).toEqual([clean.id, second.id].sort());

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
    const sourced = { source: 'datasheet', reference: 'https://example.org' };
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
    const sourced = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'Sourced',
      attributes: { color: 'red' },
      evidence: { color: { source: 'datasheet', reference: 'https://example.org' } },
    });
    const guessed = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'gadget',
      label: 'Guessed',
      attributes: { color: 'blue' },
    });
    const listed = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    const drafts = listed.items.flatMap((i) => (i.type === 'draft' ? [i] : []));
    expect(drafts.find((i) => i.record.id === guessed.id)).toMatchObject({
      batchable: false,
      assumed: 1,
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
      needsYou: 1,
      drafts: { widget: 2 },
    });
  });

  it('is empty when nothing waits, and refuses unknown input', async () => {
    await create(person, { status: 'active' });
    expect(await run(agent, 'review.list', {})).toEqual({
      items: [],
      counts: { total: 0, changes: 0, mentions: 0, needsYou: 0, drafts: {} },
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

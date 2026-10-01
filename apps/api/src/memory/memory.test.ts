import { checkAgainFor } from '@ailab/domain';
import type { Actor, MemoryAttributes, RecordEnvelope, ReviewItem } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { memoryKinds } from './kinds.ts';
import { labelOf } from './operations.ts';

let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let colleague: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  const test = await createTestDb();
  close = test.close;
  const tenant = await createTenant(test.db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(test.db, {
    orgName: 'Other',
    labName: 'Other',
    userName: 'Sam',
  });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  // Someone else in the same lab: a made-up user id is enough for the ownership rule.
  colleague = { ...person, actor: { type: 'user', userId: 'usr_01J9Z3K8Q4ABCDEFGHJKMNPQRS' } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...entityKinds,
    ...memoryKinds,
  ])
    kinds.register(kind);
  registry = createRegistry(test.db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
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

const today = () => new Date().toISOString().slice(0, 10);
const stated = { from: 'stated' as const };
const attributes = (r: RecordEnvelope) => r.attributes as MemoryAttributes;

async function star() {
  return run<RecordEnvelope>(person, 'records.create', {
    kind: 'instrument_kind',
    label: 'Hamilton STAR',
    attributes: { model: 'Microlab STAR', category: 'liquid_handler', performedBy: 'machine' },
  });
}

describe('memory.propose and memory.remember', () => {
  it("drafts an agent's memory with the lab defaults, and a person's is active at once", async () => {
    const kind = await star();
    const quirk = await run<RecordEnvelope>(agent, 'memory.propose', {
      statement: 'STAR channel 3 drips below 5 uL with the default water class',
      kind: 'quirk',
      about: [kind.id],
      conditions: {
        instrumentKind: kind.id,
        volume: { max: { value: '5', unit: 'uL' } },
        capability: 'transfer',
      },
      source: { from: 'conversation', note: 'Wali, in chat' },
    });
    expect(quirk).toMatchObject({ kind: 'memory', name: 'MEM-0001', status: 'draft' });
    expect(attributes(quirk)).toMatchObject({
      strength: 'note',
      appliesTo: { to: 'lab' },
      checkAgain: checkAgainFor('quirk', today()),
    });
    const links = await run<{ links: { relation: string; toId: string }[] }>(
      person,
      'records.links',
      { id: quirk.id, direction: 'from' },
    );
    expect(links.links.map((l) => l.relation).sort()).toEqual(['about', 'applies_with']);

    // An agent never makes a memory active (change 3).
    const notAgents = await refused(
      run(agent, 'memory.remember', { statement: 'x', kind: 'fact', source: stated }),
    );
    expect(notAgents).toMatchObject({ code: 'forbidden' });
    const sneaky = await refused(
      run(agent, 'records.create', {
        kind: 'memory',
        label: 'x',
        status: 'active',
        attributes: {
          statement: 'x',
          kind: 'fact',
          strength: 'rule',
          appliesTo: { to: 'lab' },
          source: stated,
        },
      }),
    );
    expect(sneaky.code).toBe('invalid_state');

    const preference = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'Use the Flex for anything under 96 samples',
      kind: 'preference',
      strength: 'default',
      conditions: { samples: { max: 95 } },
      source: stated,
    });
    expect(preference.status).toBe('active');
    expect(attributes(preference).checkAgain).toBeUndefined();
  });

  it("lists a memory past its check-again date in Review's notices (M6)", async () => {
    const due = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'The Spark reads 5% high on the left edge',
      kind: 'quirk',
      checkAgain: '2020-01-01',
      source: stated,
    });
    await run(person, 'memory.remember', { statement: 'Not due', kind: 'quirk', source: stated });
    const { items } = await run<{ items: ReviewItem[] }>(person, 'review.list', {});
    expect(items.filter((i) => i.type === 'notice')).toEqual([
      expect.objectContaining({
        tier: 'fyi',
        due: '2020-01-01',
        about: expect.objectContaining({ id: due.id }),
        message: 'Check it is still true: its check-again date has passed',
      }),
    ]);
  });

  it('refuses a memory that contradicts itself or names records the lab does not have', async () => {
    const kind = await star();
    const note = await refused(
      run(agent, 'memory.propose', {
        statement: 'Avoid the STAR',
        kind: 'preference',
        effect: { effect: 'avoid', record: kind.id },
        source: stated,
      }),
    );
    expect(note.message).toContain('a note only informs');
    const rulePrefers = await refused(
      run(person, 'memory.remember', {
        statement: 'Always the STAR',
        kind: 'preference',
        strength: 'rule',
        effect: { effect: 'prefer', record: kind.id },
        source: stated,
      }),
    );
    expect(rulePrefers.message).toContain('a preference is a default');
    const empty = await refused(
      run(agent, 'memory.propose', {
        statement: 'x',
        kind: 'fact',
        conditions: {},
        source: stated,
      }),
    );
    expect(empty.message).toContain('at least one condition');
    const theirs = await refused(
      run(otherLab, 'memory.remember', {
        statement: 'Their STAR drips',
        kind: 'quirk',
        about: [kind.id],
        source: stated,
      }),
    );
    expect(theirs.message).toContain('does not exist in this lab');
  });

  it("keeps a personal memory the person's own", async () => {
    const userId = (person.actor as { userId: string }).userId;
    const mine = {
      statement: 'I seed on Mondays',
      kind: 'preference',
      appliesTo: { to: 'person', user: userId },
      source: stated,
    };
    const forbidden = await refused(run(colleague, 'memory.remember', mine));
    expect(forbidden).toMatchObject({ code: 'forbidden' });
    expect((await run<RecordEnvelope>(person, 'memory.remember', mine)).status).toBe('active');
    const drafted = await run<RecordEnvelope>(agent, 'memory.propose', mine);
    expect(drafted.status).toBe('draft');
  });
});

describe('memory.update, memory.retire and memory.replace', () => {
  it('changes drafts directly, proposes changes to active memories, and retires with why', async () => {
    const draft = await run<RecordEnvelope>(agent, 'memory.propose', {
      statement: 'Block with 2% BSA',
      kind: 'convention',
      source: stated,
    });
    const edited = await run<RecordEnvelope>(agent, 'memory.update', {
      id: draft.id,
      expectedVersion: draft.version,
      statement: 'Block ELISA plates with 2% BSA in PBS, not milk',
      strength: 'default',
    });
    expect(edited).toMatchObject({ label: 'Block ELISA plates with 2% BSA in PBS, not milk' });
    expect(attributes(edited)).toMatchObject({ strength: 'default', kind: 'convention' });

    const active = await run<RecordEnvelope>(person, 'records.confirm', {
      id: edited.id,
      expectedVersion: edited.version,
    });
    expect(active.status).toBe('active');
    const proposed = await registry.execute(agent, 'memory.update', {
      id: active.id,
      expectedVersion: active.version,
      strength: 'rule',
    });
    expect(proposed.status).toBe('proposed');
    const retiring = await registry.execute(agent, 'memory.retire', {
      id: active.id,
      expectedVersion: active.version,
      why: 'The lab moved to milk',
    });
    expect(retiring.status).toBe('proposed');

    const retired = await run<RecordEnvelope>(person, 'memory.retire', {
      id: active.id,
      expectedVersion: active.version,
      why: 'The lab moved to a commercial blocker',
    });
    expect(retired.status).toBe('archived');
    expect(attributes(retired).retired).toEqual({ why: 'The lab moved to a commercial blocker' });
    const again = await refused(
      run(person, 'memory.retire', {
        id: retired.id,
        expectedVersion: retired.version,
        why: 'twice',
      }),
    );
    expect(again.message).toContain('already retired');
    const hidden = await refused(
      run(otherLab, 'memory.retire', { id: retired.id, expectedVersion: 1, why: 'x' }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
  });

  it('replaces an active memory, linking the old one to the new', async () => {
    const old = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'Spark A1 reads 5% high',
      kind: 'quirk',
      source: stated,
    });
    const draft = await run<RecordEnvelope>(agent, 'memory.propose', {
      statement: 'A draft',
      kind: 'fact',
      source: stated,
    });
    const notActive = await refused(
      run(person, 'memory.replace', {
        id: draft.id,
        expectedVersion: draft.version,
        with: { statement: 'x', kind: 'fact', source: stated },
        why: 'x',
      }),
    );
    expect(notActive.message).toContain('memory.update');
    const viaAgent = await registry.execute(agent, 'memory.replace', {
      id: old.id,
      expectedVersion: old.version,
      with: { statement: 'Spark A1 reads 2% high since service', kind: 'quirk', source: stated },
      why: 'Serviced',
    });
    expect(viaAgent.status).toBe('proposed');
    const { retired, memory } = await run<{ retired: RecordEnvelope; memory: RecordEnvelope }>(
      person,
      'memory.replace',
      {
        id: old.id,
        expectedVersion: old.version,
        with: { statement: 'Spark A1 reads 2% high since service', kind: 'quirk', source: stated },
        why: 'Serviced on 1 Oct',
      },
    );
    expect(memory.status).toBe('active');
    expect(retired.status).toBe('archived');
    expect(attributes(retired).retired).toEqual({
      why: 'Serviced on 1 Oct',
      replacedBy: memory.id,
    });

    // An agent's replacement, once a person approves it, is active as theirs.
    const other = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'The cold room alarm sounds after 2 min',
      kind: 'fact',
      source: stated,
    });
    const asked = await registry.execute(agent, 'memory.replace', {
      id: other.id,
      expectedVersion: other.version,
      with: { statement: 'The cold room alarm sounds after 3 min', kind: 'fact', source: stated },
      why: 'Alarm reset',
    });
    if (asked.status !== 'proposed') throw new Error('expected a proposal');
    const approved = await run<{ status: string }>(person, 'proposals.approve', {
      id: asked.proposal.id,
    });
    expect(approved.status).toBe('approved');
    const now = await run<{ memories: RecordEnvelope[] }>(person, 'memory.search', {
      text: 'cold room',
    });
    expect(now.memories.map((m) => [m.label, m.status])).toEqual([
      ['The cold room alarm sounds after 3 min', 'active'],
    ]);
  });
});

describe('memory.search', () => {
  it('finds memories by words, record, kind and strength, rules first, and says which are due', async () => {
    const kind = await star();
    await run(person, 'memory.remember', {
      statement: 'Edge wells evaporate at 37 C after 48 h',
      kind: 'lesson',
      checkAgain: '2020-01-01',
      source: stated,
    });
    await run(person, 'memory.remember', {
      statement: 'Never use the STAR for volumes under 2 uL',
      kind: 'quirk',
      strength: 'rule',
      about: [kind.id],
      source: stated,
    });
    await run(agent, 'memory.propose', {
      statement: 'The STAR deck light is off at night',
      kind: 'fact',
      about: [kind.id],
      source: stated,
    });
    const star_ = await run<{ memories: (RecordEnvelope & { due: boolean })[]; total: number }>(
      agent,
      'memory.search',
      { about: kind.id },
    );
    expect(star_.memories.map((m) => attributes(m).strength)).toEqual(['rule', 'note']);
    expect((star_.memories[0] as unknown as { aboutRecords: unknown[] }).aboutRecords).toEqual([
      { id: kind.id, name: kind.name, label: kind.label, kind: kind.kind },
    ]);
    const words = await run<{ memories: (RecordEnvelope & { due: boolean })[] }>(
      agent,
      'memory.search',
      { text: 'edge 48' },
    );
    expect(words.memories).toHaveLength(1);
    expect(words.memories[0]?.due).toBe(true);
    const drafts = await run<{ total: number }>(agent, 'memory.search', { status: 'draft' });
    expect(drafts.total).toBe(1);
    const theirs = await run<{ total: number }>(otherLab, 'memory.search', {});
    expect(theirs.total).toBe(0);
    const bad = await refused(run(agent, 'memory.search', { kind: 'rumour' }));
    expect(bad).toMatchObject({ code: 'invalid_input' });
  });

  it('labels a memory with its statement, cut near 80 characters', () => {
    expect(labelOf('Short one')).toBe('Short one');
    const long =
      'Block ELISA plates with 2% BSA in PBS for one hour at room temperature, never with milk, because milk carries biotin';
    expect(labelOf(long)).toBe(
      'Block ELISA plates with 2% BSA in PBS for one hour at room temperature, never…',
    );
  });
});

describe('memory in other records', () => {
  it('names the memory behind a handling rule, and memory evidence cites a confirmed memory', async () => {
    const memory = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'Our HEK293 tolerate 20 min out of the incubator',
      kind: 'lesson',
      source: stated,
    });
    const rule = (source: unknown) => ({
      rule: 'max_time_out_of_storage',
      text: 'At most 20 min out of the incubator',
      source,
      enforced: true,
      period: { value: '20', unit: 'min' },
    });
    const create = (source: unknown) =>
      run<RecordEnvelope>(agent, 'records.create', {
        kind: 'entity_kind',
        label: 'Cell line',
        attributes: { base: 'cells', prefix: 'CL', fields: [], handlingRules: [rule(source)] },
      });
    const unnamed = await refused(create({ from: 'lab_memory' }));
    expect(unnamed.message).toContain('names the memory');
    const missing = await refused(
      create({ from: 'lab_memory', memory: 'mem_01J9Z3K8Q4ABCDEFGHJKMNPQRS' }),
    );
    expect(missing.message).toContain('does not exist in this lab');
    const kind = await create({ from: 'lab_memory', memory: memory.id });
    const links = await run<{ links: { relation: string; toId: string }[] }>(
      person,
      'records.links',
      { id: kind.id, direction: 'from' },
    );
    expect(links.links).toContainEqual(
      expect.objectContaining({ relation: 'from_memory', toId: memory.id }),
    );

    // A value filled from memory cites it; a draft memory can't be cited.
    const draft = await run<RecordEnvelope>(agent, 'memory.propose', {
      statement: 'Plates go in the 37 C incubator on shelf 2',
      kind: 'convention',
      source: stated,
    });
    const update = (from: RecordEnvelope) =>
      run<RecordEnvelope>(agent, 'records.update', {
        id: kind.id,
        expectedVersion: kind.version,
        attributes: { ...(kind.attributes as object), description: 'Cells' },
        evidence: {
          description: { source: 'memory', from: { id: from.id, version: from.version } },
        },
      });
    expect((await refused(update(draft))).message).toContain('not confirmed');
    expect((await refused(update(kind))).message).toContain('not a lab memory');
    expect((await update(memory)).evidence?.description).toMatchObject({ source: 'memory' });
  });
});

import type { Actor, MemoryAttributes, RecordEnvelope } from '@ailab/schema';
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

type For = {
  memories: { name: string; applies: boolean; unknown: string[]; strength: string }[];
  more: number;
  conflicts: { memories: string[]; why: string }[];
  lines: string[];
};
const uL = (value: string) => ({ value, unit: 'uL' });

describe('memory.for', () => {
  it('lists what applies to the work, most specific first, and what may apply', async () => {
    const kind = await star();
    const water = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'liquid_type',
      label: 'Aqueous',
      status: 'active',
      attributes: { base: 'aqueous' },
    });
    await run(person, 'memory.remember', {
      statement: 'The STAR drips below 5 uL of water',
      kind: 'quirk',
      strength: 'default',
      about: [kind.id],
      conditions: { instrumentKind: kind.id, volume: { max: uL('5') }, liquidType: water.id },
      effect: { effect: 'avoid', record: kind.id },
      source: stated,
    });
    await run(person, 'memory.remember', {
      statement: 'Never pipette phenol by hand',
      kind: 'convention',
      strength: 'rule',
      source: stated,
    });
    await run(person, 'memory.remember', {
      statement: 'The STAR lives in room 2',
      kind: 'fact',
      about: [kind.id],
      source: stated,
    });
    await run(person, 'memory.remember', {
      statement: 'The canteen closes at 3',
      kind: 'fact',
      source: stated,
    });
    const small = await run<For>(agent, 'memory.for', {
      records: [kind.id],
      facts: { instrumentKind: kind.id, volume: uL('3'), liquidType: water.id },
    });
    expect(small.memories.map((m) => [m.name, m.applies])).toEqual([
      ['MEM-0002', true],
      ['MEM-0001', true],
      ['MEM-0003', true],
    ]);
    expect(small.lines[0]).toBe('MEM-0002 (rule) Never pipette phenol by hand');
    const large = await run<For>(agent, 'memory.for', {
      records: [kind.id],
      facts: { instrumentKind: kind.id, volume: uL('20'), liquidType: water.id },
    });
    expect(large.memories.map((m) => m.name)).toEqual(['MEM-0002', 'MEM-0003']);
    const vague = await run<For>(agent, 'memory.for', { records: [kind.id], limit: 2 });
    expect(vague.memories[1]).toMatchObject({ name: 'MEM-0001', applies: false });
    expect(vague.memories[1]?.unknown.sort()).toEqual(['instrumentKind', 'liquidType', 'volume']);
    expect(vague.more).toBe(1);
    expect(vague.lines.at(-1)).toBe('1 more: memory.search');
  });

  it('reaches the records a page links to, one step out', async () => {
    const kind = await star();
    const instrument = await run<RecordEnvelope>(person, 'instruments.register', {
      label: 'STAR 1',
      kind: kind.id,
    });
    await run(person, 'memory.remember', {
      statement: 'STAR models need a daily tightness check',
      kind: 'convention',
      about: [kind.id],
      source: stated,
    });
    const direct = await run<For>(agent, 'memory.for', { records: [instrument.id] });
    expect(direct.memories).toEqual([]);
    const near = await run<For>(agent, 'memory.for', { records: [instrument.id], nearby: true });
    expect(near.memories.map((m) => m.name)).toEqual(['MEM-0001']);
  });

  it('keeps personal memories to their person, and sees nothing of other labs', async () => {
    await run(person, 'memory.remember', {
      statement: 'Wali wants three replicates',
      kind: 'preference',
      strength: 'rule',
      appliesTo: { to: 'person', user: (person.actor as { userId: string }).userId },
      source: stated,
    });
    expect((await run<For>(agent, 'memory.for', {})).memories).toHaveLength(1);
    expect((await run<For>(colleague, 'memory.for', {})).memories).toEqual([]);
    expect((await run<For>(otherLab, 'memory.for', {})).memories).toEqual([]);
    const bad = await refused(run(agent, 'memory.for', { records: ['not an id'] }));
    expect(bad).toMatchObject({ code: 'invalid_input' });
  });
});

describe('memories that clash', () => {
  it('blocks confirming a memory whose effect clashes with a confirmed one for the same work', async () => {
    const kind = await star();
    const flex = await run<RecordEnvelope>(person, 'records.create', {
      kind: 'instrument_kind',
      label: 'Opentrons Flex',
      attributes: { model: 'Flex', category: 'liquid_handler', performedBy: 'machine' },
    });
    const effect = (e: 'prefer' | 'avoid') => ({
      statement: `${e} the Flex next to the STAR`,
      kind: 'preference' as const,
      strength: 'default' as const,
      about: [kind.id],
      effect: { effect: e, record: flex.id },
      source: stated,
    });
    await run(person, 'memory.remember', effect('prefer'));
    const draft = await run<RecordEnvelope>(agent, 'memory.propose', effect('avoid'));
    const readiness = await run<{ checks: { id: string; passed: boolean; message?: string }[] }>(
      person,
      'records.readiness',
      { id: draft.id },
    );
    expect(readiness.checks.find((c) => c.id === 'no_clashing_memory')).toMatchObject({
      passed: false,
      message: 'MEM-0001: one prefers and the other avoids the same record',
    });
    const narrower = await run<RecordEnvelope>(agent, 'memory.propose', {
      ...effect('avoid'),
      conditions: { instrumentKind: kind.id },
    });
    const ok = await run<{ checks: { id: string; passed: boolean }[] }>(
      person,
      'records.readiness',
      { id: narrower.id },
    );
    expect(ok.checks.find((c) => c.id === 'no_clashing_memory')?.passed).toBe(true);
  });
});

describe('memory.used_in', () => {
  it('lists the records with a value copied from the memory', async () => {
    const memory = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'Our HEK293 tolerate 20 min out of the incubator',
      kind: 'lesson',
      source: stated,
    });
    const kind = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'entity_kind',
      label: 'Cell line',
      attributes: { base: 'cells', prefix: 'CL', fields: [], description: 'Cells' },
      evidence: {
        description: { source: 'memory', from: { id: memory.id, version: memory.version } },
      },
    });
    const used = await run<{ records: { id: string; fields: string[] }[] }>(
      person,
      'memory.used_in',
      { id: memory.id },
    );
    expect(used.records).toEqual([
      expect.objectContaining({ id: kind.id, kind: 'entity_kind', fields: ['description'] }),
    ]);
    const hidden = await refused(run(otherLab, 'memory.used_in', { id: memory.id }));
    expect(hidden).toMatchObject({ code: 'not_found' });
    const bad = await refused(run(person, 'memory.used_in', { id: kind.id }));
    expect(bad).toMatchObject({ code: 'invalid_input' });
  });
});

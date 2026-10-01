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

const observe = (ctx: RecordContext, evidence: string, day: string, extra: object = {}) =>
  run<{ candidate: { status: string; observations: unknown[] }; proposed?: RecordEnvelope }>(
    ctx,
    'memory.observe',
    {
      detector: 'analysis.edge_effect',
      key: 'plate|edge|low',
      source: 'analysis',
      evidence,
      day,
      draft: { statement: 'Edge wells read low after 48 h', kind: 'lesson' },
      ...extra,
    },
  );

describe('memory.observe', () => {
  it('collects observations until the bar, counting each record once, then proposes a draft', async () => {
    const plates = await Promise.all([1, 2, 3].map(() => star()));
    const [a, b, c] = plates.map((p) => p.id) as [string, string, string];
    expect((await observe(agent, a, '2026-10-01')).candidate.status).toBe('collecting');
    const again = await observe(agent, a, '2026-10-01');
    expect(again.candidate.observations).toHaveLength(1);
    expect((await observe(agent, b, '2026-10-02')).proposed).toBeUndefined();
    const passed = await observe(agent, c, '2026-10-02');
    expect(passed.candidate.status).toBe('proposed');
    expect(passed.proposed).toMatchObject({ kind: 'memory', status: 'draft' });
    expect(passed.proposed?.attributes).toMatchObject({
      strength: 'note',
      source: {
        from: 'analysis',
        evidence: [a, b, c],
        note: 'seen in 3 analyses on 2 days since 2026-10-01',
      },
    });
    // Review groups it by the detector that proposed it, with its evidence line (M16).
    const review = await run<{ items: { type: string; memory?: unknown }[] }>(
      person,
      'review.list',
      { kind: 'memory' },
    );
    expect(review.items[0]?.memory).toEqual({
      group: 'Lab memory detector (analysis.edge_effect)',
      strength: 'note',
      evidence: 'seen in 3 analyses on 2 days since 2026-10-01',
    });
    // Once proposed, more observations add evidence without another proposal.
    expect((await observe(agent, (await star()).id, '2026-10-03')).proposed).toBeUndefined();
    const listed = await run<{ candidates: { status: string }[] }>(person, 'memory.candidates', {
      status: 'proposed',
    });
    expect(listed.candidates).toHaveLength(1);
  });

  it('refuses a bad detector, a rule, and evidence from another lab', async () => {
    const plate = await star();
    expect(
      await refused(observe(agent, plate.id, '2026-10-01', { detector: 'Edge Effect' })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      await refused(
        observe(agent, plate.id, '2026-10-01', {
          draft: { statement: 'x', kind: 'lesson', strength: 'rule' },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(await refused(observe(otherLab, plate.id, '2026-10-01'))).toMatchObject({
      code: 'not_found',
    });
    const { candidates } = await run<{ candidates: unknown[] }>(otherLab, 'memory.candidates', {});
    expect(candidates).toEqual([]);
  });
});

type For = {
  memories: { name: string; due: boolean; evidence?: Record<string, unknown> }[];
  lines: string[];
};

describe('evidence on memories (005c-2)', () => {
  it('counts quiet opportunities after a confirmed memory was last seen and makes it due for a check', async () => {
    const instrument = await star();
    const ids = (await Promise.all(Array.from({ length: 13 }, () => star()))).map((p) => p.id);
    const draft = {
      statement: 'Edge wells read low after 48 h',
      kind: 'lesson',
      about: [instrument.id],
    };
    for (const [i, id] of ids.slice(0, 3).entries())
      await observe(agent, id, `2026-10-0${i + 1}`, { draft, quietLimit: 10 });
    const { candidates } = await run<{ candidates: { memory: string }[] }>(
      person,
      'memory.candidates',
      {},
    );
    const draftMemory = await run<RecordEnvelope>(person, 'records.get', {
      id: candidates[0]?.memory,
    });
    await run(person, 'records.confirm', {
      id: draftMemory.id,
      expectedVersion: draftMemory.version,
    });
    const quiet = async (n: number) => {
      for (const id of ids.slice(3, 3 + n))
        await observe(agent, id, '2026-10-20', { draft, finding: 'quiet' });
    };
    await quiet(9);
    let found = await run<For>(agent, 'memory.for', { records: [instrument.id] });
    expect(found.memories[0]).toMatchObject({
      due: false,
      evidence: { for: 3, against: 0, quiet: 9, weight: 3, lastSeen: '2026-10-03' },
    });
    await quiet(10);
    found = await run<For>(agent, 'memory.for', { records: [instrument.id] });
    expect(found.memories[0]).toMatchObject({ due: true, evidence: { quiet: 10, due: 'quiet' } });
    expect(found.lines[0]).toContain(
      'seen in 3 analyses, last 2026-10-03; not seen in the last 10 matching analyses since 2026-10-03; due for a check',
    );
    // Quiet records never count towards the bar.
    const listed = await run<{ candidates: { evidence: { for: number } }[] }>(
      person,
      'memory.candidates',
      {},
    );
    expect(listed.candidates[0]?.evidence.for).toBe(3);
  });

  it('reports evidence against a memory a person stated, and refuses a report with nothing to report on', async () => {
    const instrument = await star();
    const memory = await run<RecordEnvelope>(person, 'memory.remember', {
      statement: 'The STAR drips below 5 uL',
      kind: 'quirk',
      about: [instrument.id],
      source: stated,
    });
    const runs = (await Promise.all([1, 2].map(() => star()))).map((p) => p.id);
    const report = (evidence: string, finding: string) =>
      run<{ candidate: { status: string; key: string; evidence: { against: number } } }>(
        agent,
        'memory.observe',
        {
          detector: 'agent',
          memory: memory.id,
          finding,
          source: 'analysis',
          evidence,
          note: 'no drips seen at 2 uL',
        },
      );
    const first = await report(runs[0] as string, 'against');
    expect(first.candidate).toMatchObject({
      status: 'confirmed',
      key: `memory:${memory.id}`,
      evidence: { against: 1 },
    });
    await report(runs[1] as string, 'against');
    const found = await run<For>(agent, 'memory.for', { records: [instrument.id] });
    expect(found.memories[0]).toMatchObject({
      due: true,
      evidence: { for: 0, against: 2, weight: -2, due: 'against' },
    });
    expect(found.lines[0]).toContain('not seen yet, 2 against');

    expect(
      await refused(
        run(agent, 'memory.observe', {
          detector: 'agent',
          source: 'analysis',
          evidence: instrument.id,
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      await refused(
        run(agent, 'memory.observe', {
          detector: 'agent',
          memory: memory.id.replace('mem_', 'ink_'),
          source: 'analysis',
          evidence: instrument.id,
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});

describe('the repeated-override detector (005c-1b)', () => {
  it('proposes a convention once people change the same filled-in value the same way in 3 records', async () => {
    const drafted = await Promise.all(
      ['Tween wash', 'Plate wash', 'Strip wash', 'Bead wash'].map((label) =>
        run<RecordEnvelope>(agent, 'records.create', {
          kind: 'liquid_type',
          label,
          attributes: { base: 'aqueous' },
        }),
      ),
    );
    const change = (r: RecordEnvelope, base: string, ctx = person) =>
      run<RecordEnvelope>(ctx, 'records.update', {
        id: r.id,
        expectedVersion: r.version,
        attributes: { base },
      });
    const [a, b, c, d] = drafted as [
      RecordEnvelope,
      RecordEnvelope,
      RecordEnvelope,
      RecordEnvelope,
    ];
    await change(a, 'detergent');
    await change(b, 'detergent');
    // An agent's own change and a different value are not the same override.
    await change(c, 'detergent', agent);
    await change(d, 'protein_rich');
    const waiting = async () =>
      (await run<{ memories: RecordEnvelope[] }>(person, 'memory.search', { status: 'draft' }))
        .memories;
    expect(await waiting()).toEqual([]);
    const fresh = await run<RecordEnvelope>(agent, 'records.create', {
      kind: 'liquid_type',
      label: 'Final wash',
      attributes: { base: 'aqueous' },
    });
    await change(fresh, 'detergent');
    const [proposal] = await waiting();
    expect(proposal?.attributes).toMatchObject({
      statement: 'People set base to "detergent" on a liquid type when another value was filled in',
      kind: 'convention',
      strength: 'note',
      source: {
        from: 'edits',
        note: 'seen in 3 records on 1 day since ' + new Date().toISOString().slice(0, 10),
      },
    });
  });
});

import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { instrumentKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let kinds: KindRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  kinds = new KindRegistry();
  for (const kind of [...labwareKinds, ...instrumentKinds]) kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus());
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

async function confirm(record: RecordEnvelope): Promise<RecordEnvelope> {
  let current = record;
  for (const section of kinds.get(record.kind).sections ?? []) {
    current = await run(person, 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  return current;
}

/** An Echo, a sealer and a reader, registered and confirmed. */
async function instruments() {
  const kind = async (label: string, category: string) =>
    run<RecordEnvelope>(person, 'records.create', {
      kind: 'instrument_kind',
      label,
      attributes: { model: label, category, performedBy: 'machine' },
    });
  const echo = await kind('Echo 650', 'acoustic_dispenser');
  const sealer = await kind('A4S', 'sealer');
  const reader = await kind('Spark Cyto', 'plate_reader');
  const register = async (label: string, k: RecordEnvelope) =>
    confirm(await run<RecordEnvelope>(person, 'instruments.register', { label, kind: k.id }));
  return {
    echo: await register('Echo 1', echo),
    sealer: await register('A4S 1', sealer),
    reader: await register('Spark Cyto 1', reader),
  };
}

describe('workcells', () => {
  it('drafts a workcell of instruments mapped to the twin, confirms it, and says where an instrument is', async () => {
    const { echo, sealer, reader } = await instruments();
    const draft = await run<RecordEnvelope>(agent, 'workcells.draft', {
      label: 'FlexPod workcell',
      twin: 'flexpod-1',
      members: [
        { instrument: echo.id, twinDevice: 'echo', byHand: false },
        { instrument: sealer.id, byHand: true },
      ],
    });
    expect(draft).toMatchObject({ name: 'WCL-0001', status: 'draft' });
    const ready = await run<Readiness>(person, 'records.readiness', { id: draft.id });
    const failing = ready.checks.filter((c) => !c.passed);
    expect(failing.map((c) => [c.id, c.severity])).toEqual([
      ['twin_mapped', 'blocker'],
      ['twin_checked', 'warning'],
    ]);
    expect(failing[0]?.message).toBe('A4S 1 (INS-0002) has no twin device');

    const mapped = await run<RecordEnvelope>(agent, 'workcells.change_members', {
      id: draft.id,
      expectedVersion: draft.version,
      set: [{ instrument: sealer.id, twinDevice: 'a4s', byHand: true }],
    });
    expect(mapped.attributes).toMatchObject({
      members: [
        { instrument: echo.id, twinDevice: 'echo' },
        { instrument: sealer.id, twinDevice: 'a4s', byHand: true },
      ],
    });
    const active = await confirm(mapped);
    expect(active.status).toBe('active');

    const where = await run<{ active?: { name: string; member: unknown }; drafts: unknown[] }>(
      agent,
      'workcells.of_instrument',
      { instrument: sealer.id },
    );
    expect(where).toEqual({
      active: {
        id: active.id,
        name: 'WCL-0001',
        label: 'FlexPod workcell',
        member: { instrument: sealer.id, twinDevice: 'a4s', byHand: true },
      },
      drafts: [],
    });
    const standalone = await run<{ active?: unknown; drafts: unknown[] }>(
      agent,
      'workcells.of_instrument',
      { instrument: reader.id },
    );
    expect(standalone).toEqual({ drafts: [] });

    // A second workcell can plan with the Echo, but can't be confirmed while the first holds it (I9).
    const second = await run<RecordEnvelope>(agent, 'workcells.draft', {
      label: 'Reader cell',
      twin: 'reader-cell',
      members: [
        { instrument: echo.id, twinDevice: 'echo', byHand: false },
        { instrument: reader.id, twinDevice: 'spark', byHand: true },
      ],
    });
    const blocked = await run<Readiness>(person, 'records.readiness', { id: second.id });
    expect(blocked.checks.find((c) => c.id === 'one_workcell')?.message).toBe(
      'Echo 1 (INS-0001) is in FlexPod workcell (WCL-0001)',
    );
    const planned = await run<{ drafts: { name: string }[] }>(agent, 'workcells.of_instrument', {
      instrument: echo.id,
    });
    expect(planned.drafts.map((d) => d.name)).toEqual(['WCL-0002']);

    // Changing a confirmed workcell's members is a proposal from an agent.
    const proposed = await registry.execute(agent, 'workcells.change_members', {
      id: active.id,
      expectedVersion: active.version,
      remove: [sealer.id],
    });
    expect(proposed.status).toBe('proposed');
  });

  it('refuses members that are not instruments, twice listed or sharing a twin device, and other labs', async () => {
    const { echo, sealer } = await instruments();
    const bad = (members: unknown) =>
      refused(run(agent, 'workcells.draft', { label: 'Bad', twin: 'x', members }));
    expect((await bad([{ instrument: 'ins_nope', byHand: false }])).message).toContain(
      'must be a ins_ record ID',
    );
    expect(
      (
        await bad([
          { instrument: echo.id, byHand: false },
          { instrument: echo.id, byHand: true },
        ])
      ).message,
    ).toContain(`Listed more than once: ${echo.id}`);
    expect(
      (
        await bad([
          { instrument: echo.id, twinDevice: 'echo', byHand: false },
          { instrument: sealer.id, twinDevice: 'echo', byHand: false },
        ])
      ).message,
    ).toContain('More than one member maps to twin device echo');

    const cell = await run<RecordEnvelope>(agent, 'workcells.draft', {
      label: 'Cell',
      members: [{ instrument: echo.id, byHand: false }],
    });
    const none = await refused(
      run(agent, 'workcells.change_members', {
        id: cell.id,
        expectedVersion: cell.version,
        remove: [echo.id],
      }),
    );
    expect(none.message).toBe('WCL-0001 would have no members; archive it instead');
    const notMember = await refused(
      run(agent, 'workcells.change_members', {
        id: cell.id,
        expectedVersion: cell.version,
        remove: [sealer.id],
      }),
    );
    expect(notMember.message).toBe(`WCL-0001 has no member ${sealer.id}`);
    const empty = await refused(
      run(agent, 'workcells.change_members', { id: cell.id, expectedVersion: cell.version }),
    );
    expect(empty).toMatchObject({ code: 'invalid_input' });

    const hidden = await refused(
      run(otherLab, 'workcells.change_members', {
        id: cell.id,
        expectedVersion: cell.version,
        remove: [echo.id],
      }),
    );
    expect(hidden).toMatchObject({ code: 'not_found' });
    const hiddenWhere = await refused(
      run(otherLab, 'workcells.of_instrument', { instrument: echo.id }),
    );
    expect(hiddenWhere).toMatchObject({ code: 'not_found' });
    const foreign = await refused(
      run(otherLab, 'workcells.draft', {
        label: 'Theirs',
        members: [{ instrument: echo.id, byHand: false }],
      }),
    );
    expect(foreign.message).toContain('is not an instrument in this lab');
  });
});

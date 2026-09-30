import { readiness } from '@ailab/domain';
import type { Actor } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { saveCalculation } from './calculations.ts';
import { RecordError } from './errors.ts';
import { KindRegistry } from './kinds.ts';
import { type RecordContext, RecordService } from './service.ts';
import { protocol, widget } from './test-kinds.ts';

let db: Db;
let close: () => Promise<void>;
let person: RecordContext;
let agent: RecordContext;
let service: RecordService;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = {
    ...person,
    actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId },
  };
  service = new RecordService(db, new KindRegistry().register(widget).register(protocol));
});
afterEach(() => close());

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RecordError);
  return error as RecordError;
}

const steps = [
  { id: 'coat', text: 'Coat the plate' },
  { id: 'wash', text: 'Wash three times' },
  { id: 'block', text: 'Block for 1 h' },
];

describe('evidence by item (ADR 0049)', () => {
  it('marks only the step that changed, and keeps the others confirmed', async () => {
    const draft = await service.create(agent, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
      evidence: { '/steps/coat': { source: 'datasheet', reference: 'https://example.org/kit' } },
    });
    expect(draft.evidence['/steps/coat']?.source).toBe('datasheet');
    expect(draft.evidence['/steps/wash']?.source).toBe('assumed');
    const confirmed = await service.confirmSection(person, draft.id, {
      expectedVersion: 1,
      section: 'steps',
    });

    const edited = await service.update(agent, draft.id, {
      expectedVersion: confirmed.version,
      attributes: {
        steps: [steps[0], { id: 'wash', text: 'Wash five times' }, steps[2]],
      },
    });
    // The wash step is the agent's guess now; coat keeps its datasheet.
    expect(edited.evidence['/steps/wash']?.source).toBe('assumed');
    expect(edited.evidence['/steps/coat']?.source).toBe('datasheet');
    const state = readiness(edited, protocol);
    const field = state.sections[0]?.fields[0];
    expect(field?.state).toBe('changed');
    expect(field?.items?.map((i) => [i.key, i.state])).toEqual([
      ['coat', 'confirmed'],
      ['wash', 'changed'],
      ['block', 'confirmed'],
    ]);
    expect(state.assumed).toEqual(['/steps/wash']);
  });

  it('keeps confirmations when steps are reordered, and says the order changed', async () => {
    const draft = await service.create(person, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
    });
    const confirmed = await service.confirmSection(person, draft.id, {
      expectedVersion: 1,
      section: 'steps',
    });
    const moved = await service.update(agent, draft.id, {
      expectedVersion: confirmed.version,
      attributes: { steps: [steps[1], steps[0], steps[2]] },
    });
    const field = readiness(moved, protocol).sections[0]?.fields[0];
    expect(field?.reordered).toBe(true);
    expect(field?.items?.every((i) => i.state === 'confirmed')).toBe(true);
    expect(field?.assumed).toBe(false);
  });

  it('reports added and removed steps', async () => {
    const draft = await service.create(person, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
    });
    const confirmed = await service.confirmSection(person, draft.id, {
      expectedVersion: 1,
      section: 'steps',
    });
    const changed = await service.update(agent, draft.id, {
      expectedVersion: confirmed.version,
      attributes: { steps: [steps[0], steps[1], { id: 'detect', text: 'Add detection antibody' }] },
    });
    const field = readiness(changed, protocol).sections[0]?.fields[0];
    expect(field?.items?.find((i) => i.key === 'detect')).toMatchObject({
      state: 'added',
      assumed: true,
    });
    expect(field?.removed?.map((r) => r.key)).toEqual(['block']);
  });

  it('refuses evidence for an item the list does not have', async () => {
    const error = await refused(
      service.create(agent, {
        kind: 'protocol',
        label: 'ELISA',
        attributes: { steps },
        evidence: { '/steps/nope': { source: 'datasheet' } },
      }),
    );
    expect(error.message).toMatch(/not an item/);
  });
});

describe('checked calculations (ADR 0049)', () => {
  it('accepts a calculated value the calculation gave, at its place in the output', async () => {
    const calculation = await saveCalculation(
      db,
      person,
      'test.calculate',
      { a: 1 },
      {
        volume: { value: '25', unit: 'uL' },
      },
    );
    const record = await service.create(agent, {
      kind: 'widget',
      label: 'Blue',
      attributes: { color: 'blue', volume: { value: '25', unit: 'uL' } },
      evidence: { volume: { source: 'calculated', calculation, output: '/volume' } },
    });
    expect(record.evidence.volume).toMatchObject({ source: 'calculated', calculation });
  });

  it('refuses a value the calculation did not give, and calculated with no handle', async () => {
    const calculation = await saveCalculation(
      db,
      person,
      'test.calculate',
      { a: 1 },
      {
        volume: { value: '25', unit: 'uL' },
      },
    );
    const wrong = await refused(
      service.create(agent, {
        kind: 'widget',
        label: 'Blue',
        attributes: { color: 'blue', volume: { value: '30', unit: 'uL' } },
        evidence: { volume: { source: 'calculated', calculation } },
      }),
    );
    expect(wrong.message).toMatch(/did not give this value/);
    const bare = await refused(
      service.create(agent, {
        kind: 'widget',
        label: 'Blue',
        attributes: { color: 'blue', volume: { value: '25', unit: 'uL' } },
        evidence: { volume: { source: 'calculated' } },
      }),
    );
    expect(bare.message).toMatch(/without a calculation handle/);
  });

  it('gives the same handle for the same calculation', async () => {
    const one = await saveCalculation(db, person, 'test.calculate', { a: 1 }, { b: 2 });
    const two = await saveCalculation(db, person, 'test.calculate', { a: 1 }, { b: 2 });
    const three = await saveCalculation(db, person, 'test.calculate', { a: 1 }, { b: 3 });
    expect(one).toBe(two);
    expect(three).not.toBe(one);
    expect(one).toMatch(/^calc_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

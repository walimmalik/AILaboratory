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
import { layoutPlan, protocol, widget } from './test-kinds.ts';

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
  service = new RecordService(
    db,
    new KindRegistry().register(widget).register(protocol).register(layoutPlan),
  );
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

  it('keys items by several fields, and items inside items, each with its own evidence (ADR 0065)', async () => {
    const uL = (value: string) => ({ value, unit: 'uL' });
    const attributes = {
      overrides: [
        { plate: 'p1', well: 'A1', content: 'blank' },
        { plate: 'p2', well: 'A1', content: 'control' },
      ],
      groups: [
        {
          id: 'g1',
          head: '96',
          transfers: [
            { from: 'A1', to: 'B1', volume: uL('10') },
            { from: 'A2', to: 'B2', volume: uL('10') },
          ],
        },
      ],
    };
    const draft = await service.create(agent, {
      kind: 'layout_plan',
      label: 'Plan',
      attributes,
      evidence: {
        '/overrides/p2+A1': { source: 'datasheet', reference: 'https://example.org/map' },
        '/groups/g1/transfers/A2+B2': { source: 'datasheet', reference: 'https://example.org/t' },
      },
    });
    expect(draft.evidence['/overrides/p2+A1']?.source).toBe('datasheet');
    expect(draft.evidence['/overrides/p1+A1']?.source).toBe('assumed');
    expect(draft.evidence['/groups/g1/transfers/A2+B2']?.source).toBe('datasheet');
    const confirmed = await service.confirmSection(person, draft.id, {
      expectedVersion: 1,
      section: 'plan',
    });

    // One transfer's volume changes: only that transfer needs a look again.
    const group = attributes.groups[0] as (typeof attributes.groups)[number];
    const edited = await service.update(agent, draft.id, {
      expectedVersion: confirmed.version,
      attributes: {
        ...attributes,
        groups: [
          {
            ...group,
            transfers: [group.transfers[0], { ...group.transfers[1], volume: uL('12') }],
          },
        ],
      },
    });
    expect(edited.evidence['/groups/g1/transfers/A2+B2']?.source).toBe('assumed');
    expect(edited.evidence['/groups/g1']?.source).toBe('assumed');
    expect(edited.evidence['/groups/g1/transfers/A1+B1']?.source).toBe('assumed');
    const field = readiness(edited, layoutPlan).sections[0]?.fields[1];
    expect(field?.items?.map((i) => [i.key, i.state])).toEqual([
      ['g1', 'confirmed'],
      ['g1 · A1+B1', 'confirmed'],
      ['g1 · A2+B2', 'changed'],
    ]);
    expect(
      (
        await refused(
          service.create(agent, {
            kind: 'layout_plan',
            label: 'Plan',
            attributes,
            evidence: { '/groups/g1/transfers/A9+B9': { source: 'datasheet' } },
          }),
        )
      ).message,
    ).toMatch(/not an item of a list this kind keys \(overrides by plate\+well/);
  });
});

describe("a person's own edits (ADR 0056)", () => {
  const section = (record: Parameters<typeof readiness>[0]) =>
    readiness(record, protocol).sections[0];

  it('confirms the section a person changed when no guess is left in it', async () => {
    const draft = await service.create(agent, {
      kind: 'widget',
      label: 'Blue',
      attributes: { color: 'blue', volume: { value: '50', unit: 'uL' } },
    });
    const edited = await service.update(person, draft.id, {
      expectedVersion: 1,
      attributes: { color: 'red', volume: { value: '50', unit: 'uL' } },
    });
    expect(edited.reviews.appearance).toMatchObject({
      confirmedBy: person.actor,
      version: 2,
      values: { color: 'red' },
    });
    // The volume is still the agent's guess, so it still waits for the person.
    expect(edited.reviews.volume).toBeUndefined();
  });

  it("leaves a section to review while it holds an agent's unconfirmed step", async () => {
    const draft = await service.create(agent, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
    });
    const one = await service.update(person, draft.id, {
      expectedVersion: 1,
      attributes: { steps: [{ id: 'coat', text: 'Coat overnight' }, steps[1], steps[2]] },
    });
    expect(one.reviews.steps).toBeUndefined();
    expect(section(one)?.state).toBe('needs_review');
    const all = await service.update(person, draft.id, {
      expectedVersion: 2,
      attributes: { steps: [{ id: 'coat', text: 'Coat overnight' }] },
    });
    expect(section(all)?.state).toBe('confirmed');
  });

  it('keeps steps a person already confirmed as confirmed when they edit another', async () => {
    const draft = await service.create(agent, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
    });
    await service.confirmSection(person, draft.id, { expectedVersion: 1, section: 'steps' });
    const edited = await service.update(person, draft.id, {
      expectedVersion: 2,
      attributes: { steps: [steps[0], { id: 'wash', text: 'Wash five times' }, steps[2]] },
    });
    expect(section(edited)?.state).toBe('confirmed');
    expect(edited.reviews.steps?.version).toBe(3);
  });

  it("keeps an assistant's suggestion a person saved untouched as assumed, to review", async () => {
    const draft = await service.create(person, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps: [steps[0]] },
    });
    // The editor saves the person's step and the assistant's, with the assistant's reason on it.
    const saved = await service.update(person, draft.id, {
      expectedVersion: 1,
      attributes: { steps: [steps[0], steps[1]] },
      evidence: {
        '/steps/wash': {
          source: 'assumed',
          note: 'suggested by the assistant (m): step 4 says so',
        },
      },
    });
    expect(saved.evidence['/steps/wash']).toMatchObject({
      source: 'assumed',
      by: person.actor,
      note: 'suggested by the assistant (m): step 4 says so',
    });
    expect(section(saved)?.state).toBe('needs_review');
    expect(readiness(saved, protocol).assumed).toEqual(['/steps/wash']);
  });

  it("still sends an agent's edit back to review", async () => {
    const draft = await service.create(person, {
      kind: 'protocol',
      label: 'ELISA',
      attributes: { steps },
    });
    const confirmed = await service.confirmSection(person, draft.id, {
      expectedVersion: 1,
      section: 'steps',
    });
    const edited = await service.update(agent, draft.id, {
      expectedVersion: confirmed.version,
      attributes: { steps: [steps[0]] },
    });
    expect(section(edited)?.state).toBe('needs_review');
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

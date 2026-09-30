import type { Actor } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  registry = createRegistry(db, new KindRegistry(), new ActivityBus());
});
afterEach(() => close());

async function evaluate(ctx: RecordContext, variables: unknown[]) {
  const result = await registry.execute(ctx, 'sops.evaluate', { variables });
  if (result.status !== 'done') throw new Error(`sops.evaluate was ${result.status}`);
  return (result.output as { variables: Record<string, unknown>[] }).variables;
}

describe('sops.evaluate', () => {
  it('works out a diluent volume for the run, for a person and an agent alike', async () => {
    const variables = [
      {
        name: 'diluent',
        expression: 'roundup(n_samples * replicates * well_volume + dead_volume, 1 mL)',
        unit: 'mL',
      },
      { name: 'n_samples', value: '40' },
      { name: 'replicates', value: '2' },
      { name: 'well_volume', value: { value: '100', unit: 'uL' } },
      { name: 'dead_volume', value: { value: '5', unit: 'mL' } },
      {
        name: 'standards',
        value: [
          { value: '100', unit: 'uL' },
          { value: '50', unit: 'uL' },
        ],
      },
      { name: 'standard_total', expression: 'sum(standards)' },
    ];
    for (const ctx of [person, agent]) {
      const out = await evaluate(ctx, variables);
      expect(out[0]).toEqual({ name: 'diluent', ok: true, quantity: { value: '13', unit: 'mL' } });
      expect(out[1]).toEqual({ name: 'n_samples', ok: true, number: '40' });
      expect(out[5]).toMatchObject({ name: 'standards', ok: true, list: expect.any(Array) });
      expect(out[6]).toEqual({
        name: 'standard_total',
        ok: true,
        quantity: { value: '150', unit: 'uL' },
      });
    }
  });

  it('says why a formula has no value', async () => {
    const out = await evaluate(agent, [
      { name: 'working', expression: 'lot_conc / 1000' },
      { name: 'lot_conc' },
      { name: 'wrong', expression: 'well_volume + 5 min' },
      { name: 'well_volume', value: { value: '100', unit: 'uL' } },
    ]);
    expect(out[0]).toEqual({
      name: 'working',
      ok: false,
      error: 'Waits for lot_conc',
      waitsOn: ['lot_conc'],
    });
    expect(out[2]).toEqual({ name: 'wrong', ok: false, error: "Can't add time to volume" });
  });

  it('refuses a name given twice, an unknown unit, and both a value and a formula', async () => {
    const run = (variables: unknown[]) => registry.execute(agent, 'sops.evaluate', { variables });
    await expect(
      run([
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_input', message: 'a is given twice' });
    await expect(run([{ name: 'v', value: { value: '1', unit: 'ul' } }])).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'v: unknown unit "ul"',
    });
    await expect(run([{ name: 'v', value: '1', expression: '2' }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(run([{ name: '2bad', value: '1' }])).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

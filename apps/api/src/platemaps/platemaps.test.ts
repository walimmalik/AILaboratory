import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { plateMapKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [...entityKinds, ...plateMapKinds]) kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T = RecordEnvelope>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

interface Preview {
  perPlate: number;
  plates: number;
  wells: { plate: number; wells: { well: string; role: string; subject?: string }[] }[];
}

const screen = {
  label: '384 single-point screen',
  wells: 384,
  subjectRole: 'compound',
  subjectRegion: ['columns 3-22'],
  subjectConcentration: { value: '10', unit: 'uM' },
  fixed: [
    { id: 'dmso', role: 'neutral_control', label: 'DMSO', region: ['columns 1-2'] },
    { id: 'stauro', role: 'positive_control', label: 'Staurosporine', region: ['columns 23-24'] },
  ],
  groups: [
    {
      id: 'zprime',
      label: "Z' per plate",
      roles: ['neutral_control', 'positive_control'],
      by: 'plate',
    },
  ],
  assays: ['CellTiter-Glo'],
};

const elisa = {
  label: 'IL-6 ELISA 96',
  wells: 96,
  subjectRole: 'sample',
  replicates: 2,
  fixed: [
    {
      id: 'standard',
      role: 'standard',
      label: 'IL-6 standard',
      region: ['A1:G2'],
      series: { top: { value: '500', unit: 'pg/mL' }, factor: '2', points: 7 },
      replicates: 2,
    },
    { id: 'blank', role: 'blank', region: ['H1:H2'] },
  ],
};

describe('layouts', () => {
  it('an agent drafts a layout, and it previews how many plates a screen needs', async () => {
    const layout = await run(agent, 'layouts.draft', screen);
    expect(layout).toMatchObject({ kind: 'layout', status: 'draft' });
    expect(layout.name).toMatch(/^LYT-\d{4}$/);

    const preview = await run<Preview>(agent, 'layouts.preview', {
      layout: layout.id,
      subjects: 500,
    });
    expect(preview.perPlate).toBe(320);
    expect(preview.plates).toBe(2);
    const first = preview.wells[0]?.wells ?? [];
    expect(first.find((w) => w.well === 'A1')).toMatchObject({ role: 'neutral_control' });
    expect(first.find((w) => w.well === 'A3')).toMatchObject({
      role: 'compound',
      subject: 'subject_1',
    });
    expect(first.find((w) => w.well === 'A24')).toMatchObject({ role: 'positive_control' });

    const readiness = await run<Readiness>(person, 'records.readiness', { id: layout.id });
    expect(readiness.checks.find((c) => c.id === 'has_controls')?.passed).toBe(true);
  });

  it('previews attributes without saving, and an ELISA fits 40 samples in duplicate', async () => {
    const { label: _label, ...attributes } = elisa;
    const preview = await run<Preview>(person, 'layouts.preview', { attributes, subjects: 40 });
    expect(preview).toMatchObject({ perPlate: 40, plates: 1 });
    const wells = preview.wells[0]?.wells ?? [];
    expect(wells.filter((w) => w.role === 'standard')).toHaveLength(14);
    expect(wells.filter((w) => w.role === 'sample')).toHaveLength(80);
  });

  it('warns when a layout has no controls or standards', async () => {
    const layout = await run(agent, 'layouts.draft', {
      label: 'Bare 96',
      wells: 96,
      subjectRole: 'sample',
    });
    const readiness = await run<Readiness>(person, 'records.readiness', { id: layout.id });
    expect(readiness.checks.find((c) => c.id === 'has_controls')).toMatchObject({
      passed: false,
      severity: 'warning',
    });
  });

  it('refuses layouts that do not work on the plate', async () => {
    const draft = (extra: object) =>
      registry.execute(agent, 'layouts.draft', { ...screen, ...extra });
    await expect(
      draft({
        fixed: [
          { id: 'a', role: 'blank', region: ['A1'] },
          { id: 'a', role: 'blank', region: ['A2'] },
        ],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('The region a is named twice') });
    await expect(draft({ subjectRegion: ['columns 3-30'] })).rejects.toMatchObject({
      message: expect.stringContaining('column'),
    });
    await expect(
      draft({ subjectSeries: { top: { value: '10', unit: 'uM' }, factor: '3', points: 10 } }),
    ).rejects.toMatchObject({ message: expect.stringContaining('not both') });
    await expect(
      draft({
        subjectConcentration: undefined,
        subjectRegion: ['A3'],
        subjectSeries: { top: { value: '10', unit: 'uM' }, factor: '3', points: 10 },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("doesn't fit") });
    await expect(draft({ wells: 100 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      draft({
        fixed: [
          {
            id: 'c',
            role: 'positive_control',
            region: ['A1'],
            subject: 'ent_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
          },
        ],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('is not a record in this lab') });
    await expect(
      registry.execute(agent, 'layouts.preview', { subjects: 10 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps layouts to their lab', async () => {
    const layout = await run(agent, 'layouts.draft', screen);
    await expect(
      registry.execute(otherLab, 'layouts.preview', { layout: layout.id, subjects: 10 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

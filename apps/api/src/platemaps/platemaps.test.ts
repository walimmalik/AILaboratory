import type { Actor, Readiness, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { entityKinds } from '../entities/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
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
let kinds: KindRegistry;

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
  kinds = new KindRegistry();
  for (const kind of [...entityKinds, ...labwareKinds, ...plateMapKinds]) kinds.register(kind);
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

/** A person confirms every section of a draft, which activates it. */
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

let kindCount = 0;
async function samples(n: number) {
  kindCount += 1;
  const kind = await run(agent, 'entities.draft_kind', {
    label: `Supernatant ${kindCount}`,
    attributes: {
      base: 'chemical',
      prefix: `SU${String.fromCharCode(64 + kindCount)}`,
      fields: [],
    },
  });
  const out: RecordEnvelope[] = [];
  for (let i = 1; i <= n; i++)
    out.push(await run(agent, 'entities.draft', { label: `Donor ${i}`, entityKind: kind.id }));
  return out;
}

interface Wells {
  perPlate: number;
  plates: {
    plate: number;
    wells: { well: string; role: string; subject?: string; label?: string; override?: true }[];
  }[];
  staleOverrides: unknown[];
}

describe('plate maps', () => {
  it('applies a confirmed layout to samples, works the wells out and exports them', async () => {
    const layout = await confirm(await run(agent, 'layouts.draft', elisa));
    const [a, b, c] = await samples(3);
    const map = await run(agent, 'platemaps.draft', {
      label: 'IL-6, three donors',
      layout: layout.id,
      subjects: [a, b, c].map((s) => ({ record: s?.id })),
    });
    expect(map).toMatchObject({ kind: 'plate_map', status: 'draft' });
    expect(map.name).toMatch(/^PMP-\d{4}$/);
    expect(map.attributes).toMatchObject({ layout: { id: layout.id, version: layout.version } });
    expect(map.attributes).not.toHaveProperty('seed');

    const wells = await run<Wells>(agent, 'platemaps.wells', { id: map.id });
    expect(wells.plates).toHaveLength(1);
    const plate = wells.plates[0]?.wells ?? [];
    expect(plate.find((w) => w.well === 'A3')).toMatchObject({
      role: 'sample',
      subject: a?.id,
      label: `${a?.name} Donor 1`,
    });
    expect(plate.filter((w) => w.subject === c?.id)).toHaveLength(2);

    const readiness = await run<Readiness>(person, 'records.readiness', { id: map.id });
    expect(readiness.checks.find((x) => x.id === 'layout_confirmed')?.passed).toBe(true);
    expect(readiness.checks.find((x) => x.id === 'has_subjects')?.passed).toBe(true);

    const exported = await run<{ filename: string; csv: string }>(agent, 'platemaps.export', {
      id: map.id,
    });
    expect(exported.filename).toBe(`${map.name}.csv`);
    const lines = exported.csv.trim().split('\n');
    expect(lines[0]).toBe('plate,well,role,subject,name,replicate,point,concentration,unit');
    expect(lines).toContain('1,A1,standard,standard,IL-6 standard,1,1,500,pg/mL');
    expect(lines.some((l) => l.startsWith(`1,A3,sample,${a?.id},`))).toBe(true);
  });

  it('keeps a seed for randomized placement, so the map rebuilds exactly', async () => {
    const layout = await confirm(
      await run(agent, 'layouts.draft', { ...elisa, strategy: 'randomized_within_plate' }),
    );
    const subjects = (await samples(10)).map((s) => ({ record: s.id }));
    const map = await run(agent, 'platemaps.draft', {
      label: 'Random',
      layout: layout.id,
      subjects,
    });
    expect(typeof (map.attributes as { seed?: number }).seed).toBe('number');
    const first = await run<Wells>(agent, 'platemaps.wells', { id: map.id });
    const again = await run<Wells>(agent, 'platemaps.wells', { id: map.id });
    expect(again).toEqual(first);
    const inOrder = await run(agent, 'platemaps.draft', {
      label: 'In order',
      layout: layout.id,
      subjects,
      strategy: 'in_order',
    });
    expect(inOrder.attributes).not.toHaveProperty('seed');
  });

  it('changes wells by hand, flags edits that no longer land, and clears them', async () => {
    const layout = await confirm(await run(agent, 'layouts.draft', elisa));
    const [a, b] = await samples(2);
    let map = await run(agent, 'platemaps.draft', {
      label: 'Hand edits',
      layout: layout.id,
      subjects: [{ record: a?.id }],
    });
    map = await run(agent, 'platemaps.override', {
      id: map.id,
      expectedVersion: map.version,
      overrides: [
        { plate: 1, well: 'H12', role: 'sample', subject: b?.id, note: 'Spare well for a repeat' },
        { plate: 2, well: 'A1', role: 'blank' },
      ],
    });
    const wells = await run<Wells>(agent, 'platemaps.wells', { id: map.id });
    expect(wells.plates[0]?.wells.find((w) => w.well === 'H12')).toMatchObject({
      subject: b?.id,
      override: true,
    });
    expect(wells.staleOverrides).toHaveLength(1);
    const readiness = await run<Readiness>(person, 'records.readiness', { id: map.id });
    expect(readiness.checks.find((x) => x.id === 'overrides_apply')).toMatchObject({
      passed: false,
      message: expect.stringContaining('plate 2 A1'),
    });
    map = await run(agent, 'platemaps.override', {
      id: map.id,
      expectedVersion: map.version,
      clear: [{ plate: 2, well: 'A1' }],
    });
    expect((map.attributes as { overrides: unknown[] }).overrides).toHaveLength(1);
    await expect(
      registry.execute(agent, 'platemaps.override', {
        id: map.id,
        expectedVersion: map.version,
        clear: [{ plate: 1, well: 'A1' }],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('No hand edit on plate 1 A1') });

    const confirmed = await confirm(map);
    const proposed = await registry.execute(agent, 'platemaps.override', {
      id: confirmed.id,
      expectedVersion: confirmed.version,
      overrides: [{ plate: 1, well: 'H11', role: 'empty' }],
    });
    expect(proposed.status).not.toBe('done');
  });

  it('says when the layout is not confirmed or controls name nothing', async () => {
    const layout = await run(agent, 'layouts.draft', screen);
    const [a] = await samples(1);
    const map = await run(agent, 'platemaps.draft', {
      label: 'Draft layout',
      layout: layout.id,
      subjects: [{ record: a?.id }],
    });
    const readiness = await run<Readiness>(person, 'records.readiness', { id: map.id });
    expect(readiness.checks.find((x) => x.id === 'layout_confirmed')?.passed).toBe(false);
    expect(readiness.checks.find((x) => x.id === 'controls_named')).toMatchObject({
      passed: false,
      message: expect.stringContaining('DMSO'),
    });
  });

  it('says when the plate type is not confirmed, and when a newer one is', async () => {
    const layout = await confirm(await run(agent, 'layouts.draft', elisa));
    const [a] = await samples(1);
    const plate = await run(person, 'records.create', {
      kind: 'labware_type',
      label: 'Assay 96',
      attributes: {
        family: 'plate',
        footprint: {
          length: { value: '127.76', unit: 'mm' },
          width: { value: '85.48', unit: 'mm' },
          height: { value: '14.4', unit: 'mm' },
          sbs: true,
        },
        wells: { layout: 'grid', rows: 8, columns: 12 },
        maxVolume: { value: '300', unit: 'uL' },
      },
    });
    const draft = await run(agent, 'platemaps.draft', {
      label: 'On a draft plate',
      layout: layout.id,
      subjects: [{ record: a?.id }],
    });
    const pinTo = (version: number) =>
      run(person, 'records.update', {
        id: draft.id,
        expectedVersion: draft.version,
        attributes: { ...draft.attributes, labware: { id: plate.id, version } },
      });
    let map = await pinTo(plate.version);
    let checks = (await run<Readiness>(person, 'records.readiness', { id: map.id })).checks;
    expect(checks.find((x) => x.id === 'labware_confirmed')).toMatchObject({
      passed: false,
      severity: 'blocker',
      message: expect.stringContaining(`(${plate.name}) v${plate.version} was not confirmed`),
      // The fix is made on the plate type, so the check links there.
      record: plate.id,
    });

    const confirmed = await confirm(plate);
    map = await run(person, 'records.update', {
      id: map.id,
      expectedVersion: map.version,
      attributes: { ...map.attributes, labware: { id: plate.id, version: confirmed.version } },
    });
    checks = (await run<Readiness>(person, 'records.readiness', { id: map.id })).checks;
    expect(checks.find((x) => x.id === 'labware_confirmed')?.passed).toBe(true);
    expect(checks.find((x) => x.id === 'labware_current')?.passed).toBe(true);

    await run(person, 'records.update', {
      id: plate.id,
      expectedVersion: confirmed.version,
      attributes: { ...confirmed.attributes, maxVolume: { value: '350', unit: 'uL' } },
    });
    checks = (await run<Readiness>(person, 'records.readiness', { id: map.id })).checks;
    expect(checks.find((x) => x.id === 'labware_current')).toMatchObject({
      passed: false,
      severity: 'warning',
    });
  });

  it('refuses maps that do not fit their layout', async () => {
    const layout = await confirm(await run(agent, 'layouts.draft', elisa));
    const [a] = await samples(1);
    const draft = (extra: object) =>
      registry.execute(agent, 'platemaps.draft', {
        label: 'Bad',
        layout: layout.id,
        subjects: [{ record: a?.id }],
        ...extra,
      });
    await expect(draft({ layout: a?.id })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(draft({ subjects: [{ record: a?.id }, { record: a?.id }] })).rejects.toMatchObject(
      { message: expect.stringContaining('placed twice') },
    );
    await expect(draft({ subjects: [{ record: layout.id }] })).rejects.toMatchObject({
      message: expect.stringContaining('is not an entity, sample, lot or container'),
    });
    await expect(draft({ controls: [{ region: 'dmso', record: a?.id }] })).rejects.toMatchObject({
      message: expect.stringContaining('The layout has no region dmso'),
    });
    await expect(draft({ layoutVersion: 9 })).rejects.toMatchObject({ code: 'not_found' });
    const many = (await samples(41)).map((s) => ({ record: s.id }));
    const two = await run<Wells>(agent, 'platemaps.wells', {
      id: (await run(agent, 'platemaps.draft', { label: '41', layout: layout.id, subjects: many }))
        .id,
    });
    expect(two.plates).toHaveLength(2);
  });

  it('saves a plate map as a layout, keeping hand edits that change what wells are for', async () => {
    const layout = await confirm(
      await run(agent, 'layouts.draft', { ...elisa, subjectRegion: ['columns 3-12'] }),
    );
    const [a, b] = await samples(2);
    let map = await run(agent, 'platemaps.draft', {
      label: 'With spare blanks',
      layout: layout.id,
      subjects: [{ record: a?.id }],
    });
    map = await run(agent, 'platemaps.override', {
      id: map.id,
      expectedVersion: map.version,
      overrides: [
        { plate: 1, well: 'H11', role: 'blank', label: 'Extra blank' },
        { plate: 1, well: 'H12', role: 'blank', label: 'Extra blank' },
        { plate: 1, well: 'H10', role: 'empty' },
        { plate: 1, well: 'C5', role: 'sample', subject: b?.id },
        { plate: 2, well: 'A1', role: 'blank' },
      ],
    });
    const saved = await run(agent, 'layouts.save_from_map', {
      map: map.id,
      label: 'ELISA 96, extra blanks',
    });
    expect(saved).toMatchObject({ kind: 'layout', status: 'draft' });
    const attrs = saved.attributes as {
      fixed: { id: string; role: string; region: string[] }[];
      subjectRegion: string[];
      notes: string;
    };
    expect(attrs.fixed.find((f) => f.id === 'edit_1')).toMatchObject({
      role: 'blank',
      region: ['H11', 'H12'],
    });
    expect(attrs.fixed.find((f) => f.id === 'edit_2')).toMatchObject({
      role: 'empty',
      region: ['H10'],
    });
    expect(attrs.subjectRegion).not.toContain('H11');
    expect(attrs.subjectRegion).toContain('C5');
    expect(attrs.notes).toContain(map.name);
    const preview = await run<Preview>(agent, 'layouts.preview', { layout: saved.id, subjects: 1 });
    expect(preview.perPlate).toBe(38);

    // A hand edit that breaks the standard curve can't become a layout.
    map = await run(agent, 'platemaps.override', {
      id: map.id,
      expectedVersion: map.version,
      overrides: [{ plate: 1, well: 'G1', role: 'empty' }],
    });
    await expect(
      registry.execute(agent, 'layouts.save_from_map', { map: map.id, label: 'Broken' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('IL-6 standard has 7 points') });
  });

  it('keeps plate maps to their lab', async () => {
    const layout = await confirm(await run(agent, 'layouts.draft', elisa));
    const map = await run(agent, 'platemaps.draft', {
      label: 'Mine',
      layout: layout.id,
      subjects: [],
    });
    await expect(
      registry.execute(otherLab, 'platemaps.wells', { id: map.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      registry.execute(otherLab, 'platemaps.draft', {
        label: 'Theirs',
        layout: layout.id,
        subjects: [],
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

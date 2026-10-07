import { newId } from '@ailab/domain';
import {
  defineKind,
  PageContext,
  type RecordEnvelope,
  SopAttributes,
  type WorkspaceProjection,
  type WorkspaceView,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pageNote } from '../assistant/context.ts';
import { pageNamespaces, toolsFor } from '../assistant/toolset.ts';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, proposals, recordLinks, records, recordVersions } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import * as overviewModule from '../operations/overview.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { campaignKinds } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let service: RecordService;
let person: RecordContext;
let agent: RecordContext;
let foreign: RecordContext;
let experiment: RecordEnvelope;
let otherExperiment: RecordEnvelope;
let sop: RecordEnvelope;
let subject: RecordEnvelope;
let map: RecordEnvelope;
let plan: RecordEnvelope;
let foreignSubject: RecordEnvelope;
const kinds = new KindRegistry();
// Narrow fixture kinds avoid unrelated registry prerequisites while using the real workspace,
// campaign validation, persisted links, module overview and deterministic plate generator.
const simpleKinds = [
  defineKind({
    kind: 'entity',
    idPrefix: 'ent',
    namePrefix: 'ENT',
    nameWidth: 5,
    attributes: z.object({ note: z.string() }),
  }),
  defineKind({
    kind: 'sop',
    idPrefix: 'sop',
    namePrefix: 'SOP',
    nameWidth: 4,
    attributes: SopAttributes,
  }),
  defineKind({
    kind: 'labware_type',
    idPrefix: 'lwt',
    namePrefix: 'LWT',
    nameWidth: 4,
    attributes: z.object({ format: z.string() }),
  }),
  defineKind({
    kind: 'transfer_plan',
    idPrefix: 'tfp',
    namePrefix: 'TFP',
    nameWidth: 4,
    attributes: z.record(z.string(), z.unknown()),
    links: (a) => [{ toId: a.experiment as string, relation: 'part_of' }],
  }),
];
for (const k of [...campaignKinds, ...plateMapKinds, ...simpleKinds]) kinds.register(k);
async function workspace(
  view: WorkspaceView,
  ctx = person,
  id = experiment.id,
  version = experiment.version,
): Promise<WorkspaceProjection> {
  const result = await registry.execute(ctx, 'experiments.workspace', {
    id,
    expectedVersion: version,
    view,
  });
  if (result.status !== 'done') throw new Error('Expected read');
  return result.output as WorkspaceProjection;
}
const create = (kind: string, label: string, attributes: unknown, ctx = person) =>
  service.create(ctx, { kind, label, attributes });
// Bulk fixture insertion is confined to disposable test data; production reads use RecordService.
async function fixtureRecord(
  kind: string,
  prefix: string,
  name: string,
  attributes: Record<string, unknown>,
  ctx = person,
): Promise<RecordEnvelope> {
  const now = new Date();
  const snapshot = {
    id: newId(prefix),
    kind,
    name,
    label: name,
    attributes,
    orgId: ctx.orgId,
    labId: ctx.labId,
    status: 'draft' as const,
    version: 1,
    evidence: {},
    reviews: {},
    createdBy: ctx.actor,
    updatedBy: ctx.actor,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.insert(records).values({ ...snapshot, createdAt: now, updatedAt: now });
  await db.insert(recordVersions).values({
    recordId: snapshot.id,
    version: 1,
    operation: 'create',
    actor: ctx.actor,
    at: now,
    snapshot,
  });
  if (
    (kind === 'plate_map' || kind === 'transfer_plan') &&
    typeof attributes.experiment === 'string'
  )
    await db.insert(recordLinks).values({
      fromId: snapshot.id,
      toId: attributes.experiment,
      relation: 'part_of',
      labId: ctx.labId,
    });
  return snapshot;
}
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Scientist' });
  person = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  agent = {
    ...person,
    actor: { type: 'agent', agentName: 'Assistant', onBehalfOf: tenant.userId },
  };
  const other = await createTenant(db, {
    orgName: 'Foreign',
    labName: 'Foreign',
    userName: 'Other',
  });
  foreign = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  registry = createRegistry(db, kinds, new ActivityBus());
  service = new RecordService(db, kinds);
  const campaign = await create('campaign', 'Screen', {
    goal: 'Find a hit',
    aims: [],
    stage: 'proposed',
  });
  sop = await fixtureRecord('sop', 'sop', 'SOP-0001', {
    purpose: 'Pinned method',
    notes: 'Version one',
    materials: [],
    variables: [
      {
        name: 'target_concentration',
        label: 'Target concentration',
        kind: 'default',
        value: { value: '10', unit: 'uM' },
      },
    ],
    steps: [
      {
        id: 'read',
        action: 'read',
        title: 'Read absorbance',
        text: 'Read the saved method at 450 nm.',
        parameters: [{ name: 'wavelength', quantity: { value: '450', unit: 'nm' } }],
      },
    ],
  });
  subject = await create('entity', 'Compound', { note: 'Fixture compound' });
  foreignSubject = await create('entity', 'Foreign compound', { note: 'Foreign' }, foreign);
  experiment = await fixtureRecord('experiment', 'exp', 'EXP-0001', {
    campaign: campaign.id,
    question: 'Does it inhibit?',
    stage: 'designing',
    subjects: [{ record: subject.id }],
    protocol: [{ id: 'assay', sop: { id: sop.id, version: 1 } }],
  });
  otherExperiment = await fixtureRecord('experiment', 'exp', 'EXP-0002', {
    campaign: campaign.id,
    question: 'Other?',
    stage: 'designing',
    protocol: [],
  });
  const layout = await create('layout', 'Six wells', { wells: 6, subjectRole: 'compound' });
  map = await create('plate_map', 'Map', {
    experiment: experiment.id,
    layout: { id: layout.id, version: layout.version },
    subjects: [{ record: subject.id, label: 'Fixture compound' }],
  });
  const lwt = await create('labware_type', 'Tube', { format: 'tube' });
  plan = await create('transfer_plan', 'Transfers', {
    experiment: experiment.id,
    plates: [
      {
        id: 'tube',
        role: 'source',
        label: 'Stock tube',
        labwareType: { id: lwt.id, version: lwt.version },
      },
      {
        id: 'dest',
        role: 'destination',
        label: 'Assay plate',
        labwareType: { id: lwt.id, version: lwt.version },
      },
    ],
    groups: [
      {
        id: 'dose',
        label: 'Dose',
        method: 'direct_dispense',
        reason: 'Fixture',
        alternatives: [{ option: 'Other', why: 'Fixture' }],
        transfers: Array.from({ length: 73 }, (_, i) => ({
          from: { plate: 'tube', well: 'A1' },
          to: { plate: 'dest', well: `A${(i % 6) + 1}` },
          volume: { value: '1', unit: 'uL' },
        })),
      },
      {
        id: 'wash',
        label: 'Wash',
        method: 'reagent_addition',
        reason: 'Fixture',
        transfers: [
          {
            from: { plate: 'tube', well: 'A1' },
            to: { plate: 'dest', well: 'A1' },
            volume: { value: '1', unit: 'uL' },
          },
        ],
      },
    ],
  });
}, 20000);
afterAll(async () => close());

describe('experiments.workspace', () => {
  it('returns the same read-only descriptor to people and agents without records or approvals changing', async () => {
    const before = await db.select().from(recordVersions);
    const output = await workspace({ panel: 'design' });
    expect(output).toEqual(await workspace({ panel: 'design' }, agent));
    expect(output.href).toContain(`workspace=design&workspaceVersion=${experiment.version}`);
    expect(output.experiment.subjectCount).toBe(1);
    expect(output.experiment).not.toHaveProperty('attributes');
    expect(await db.select().from(recordVersions)).toEqual(before);
    expect(await db.select().from(proposals)).toEqual([]);
    expect(await db.select().from(activity)).toEqual([]);
  });

  it('rejects unsupported input, mismatched versions and foreign scope', async () => {
    await expect(
      registry.execute(person, 'experiments.workspace', {
        id: experiment.id,
        view: { panel: 'design', filter: 'anything' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(workspace({ panel: 'design' }, foreign)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(workspace({ panel: 'design' }, person, experiment.id, 999)).rejects.toMatchObject({
      code: 'version_conflict',
    });
    await expect(
      workspace({ panel: 'design', detail: { id: foreignSubject.id, version: 1 } }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const unrelated = await create('labware_type', 'Unrelated', { format: 'tube' });
    await expect(
      workspace({ panel: 'design', detail: { id: unrelated.id, version: 1 } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects stale live detail and foreign direct references even on an empty page', async () => {
    await expect(
      workspace({ panel: 'design', detail: { id: subject.id, version: 99 } }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    const scoped = await fixtureRecord('experiment', 'exp', 'EXP-0003', {
      campaign: (experiment.attributes as { campaign: string }).campaign,
      question: 'Invalid foreign reference fixture',
      stage: 'designing',
      protocol: [],
      subjects: [{ record: foreignSubject.id }],
    });
    await expect(
      workspace({ panel: 'design', page: { offset: 100, limit: 1 } }, person, scoped.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    const foreignMap = await fixtureRecord(
      'plate_map',
      'pmp',
      'PMP-0001',
      { subjects: [], purpose: 'Foreign map fixture' },
      foreign,
    );
    await expect(
      workspace({ panel: 'plates', map: { id: foreignMap.id, version: 1, plate: 1 } }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('pages exact membership beyond the end and resolves a detail outside the visible page', async () => {
    const output = await workspace({
      panel: 'design',
      page: { offset: 100, limit: 1 },
      detail: { id: sop.id, version: 1 },
    });
    if (output.panel !== 'design') throw new Error('Wrong panel');
    expect(output.related).toEqual({ items: [], offset: 100, limit: 1, total: 3, hasMore: false });
    expect(output.detail?.record.id).toBe(sop.id);
    const page = await workspace({ panel: 'design', page: { offset: 1, limit: 1 } });
    if (page.panel !== 'design') throw new Error('Wrong panel');
    expect(page.related.hasMore).toBe(true);
    expect(page.related.items).toHaveLength(1);
  });

  it('reads the exact pinned SOP after a newer version, including evidence rather than inferred verification', async () => {
    const now = new Date();
    const old = (await service.getVersion(person, sop.id, 1)).snapshot;
    const evidence = {
      source: 'assumed' as const,
      by: agent.actor,
      at: now.toISOString(),
      note: 'Check method title',
    };
    const exact = {
      ...old,
      evidence: {
        purpose: evidence,
        '/variables/target_concentration': evidence,
        '/steps/read': evidence,
      },
    };
    await db
      .update(recordVersions)
      .set({ snapshot: exact })
      .where(eq(recordVersions.recordId, sop.id));
    const current = {
      ...old,
      version: 2,
      attributes: {
        ...old.attributes,
        purpose: 'New method',
        variables: [
          {
            name: 'target_concentration',
            label: 'Target concentration',
            kind: 'default',
            value: { value: '20', unit: 'uM' },
          },
        ],
        steps: [{ id: 'read', action: 'read', text: 'Use the changed method at 940 nm.' }],
      },
      evidence: {},
      updatedAt: now.toISOString(),
    };
    await db
      .update(records)
      .set({ version: 2, attributes: current.attributes, evidence: {} })
      .where(eq(records.id, sop.id));
    await db.insert(recordVersions).values({
      recordId: sop.id,
      version: 2,
      operation: 'update',
      actor: person.actor,
      at: now,
      snapshot: current,
    });
    const output = await workspace({ panel: 'design', detail: { id: sop.id, version: 1 } });
    expect(output.detail?.overview.facts.find((f) => f.field === 'purpose')).toMatchObject({
      value: 'Pinned method',
      evidence,
    });
    expect(
      output.detail?.overview.facts.find((f) => f.field === '/variables/target_concentration'),
    ).toMatchObject({ value: '10 µM', evidence });
    expect(output.detail?.overview.facts.find((f) => f.field === '/steps/read')).toMatchObject({
      value: 'Read the saved method at 450 nm.',
      evidence,
    });
    expect(
      output.detail?.overview.facts.find((f) => f.label === 'Read absorbance: wavelength'),
    ).toMatchObject({ value: '450 nm' });
    expect(JSON.stringify(output.detail)).not.toContain('940 nm');
    expect(output.detail?.overview.relatedRecords).toBe('current');
    expect(output.detail?.overview.facts.find((f) => f.label === 'analysis')).toBeUndefined();
    await expect(
      workspace({ panel: 'design', detail: { id: sop.id, version: 2 } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('selects an off-page map and only the selected plate, refusing stale, unrelated and invalid well selectors', async () => {
    const output = await workspace({
      panel: 'plates',
      page: { offset: 99, limit: 1 },
      map: { id: map.id, version: 1, plate: 1, wells: ['A1'] },
    });
    if (output.panel !== 'plates') throw new Error('Wrong panel');
    expect(output.maps).toMatchObject({ total: 1, items: [], hasMore: false });
    expect(output.selectedMap?.wells).toHaveLength(6);
    expect(output.selectedMap?.plateCount).toBe(1);
    await expect(
      workspace({ panel: 'plates', map: { id: map.id, version: 99, plate: 1 } }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      workspace({ panel: 'plates', map: { id: map.id, version: 1, plate: 2 } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      workspace({ panel: 'plates', map: { id: map.id, version: 1, plate: 1, wells: ['Z99'] } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      workspace(
        { panel: 'plates', map: { id: map.id, version: 1, plate: 1 } },
        person,
        otherExperiment.id,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      workspace({ panel: 'plates', map: { id: map.id, version: 1, plate: 1 } }, foreign),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('pages persisted groups and rows with original indices and tube endpoints; selected group can be off page', async () => {
    const output = await workspace({
      panel: 'transfers',
      page: { offset: 90, limit: 1 },
      plan: {
        id: plan.id,
        version: 1,
        group: 'dose',
        groupsPage: { offset: 1, limit: 1 },
        rowsPage: { offset: 50, limit: 20 },
      },
    });
    if (output.panel !== 'transfers') throw new Error('Wrong panel');
    expect(output.plans).toMatchObject({ total: 1, items: [] });
    expect(output.selectedPlan?.groups.items[0]?.id).toBe('wash');
    expect(output.selectedPlan?.groups.items[0]).not.toHaveProperty('transfers');
    expect(output.selectedPlan?.selectedGroup?.group.transferCount).toBe(73);
    const rows = output.selectedPlan?.selectedGroup?.rows;
    expect(rows).toMatchObject({ total: 73, offset: 50, limit: 20, hasMore: true });
    expect(rows?.items[0]).toMatchObject({
      index: 50,
      source: { id: 'tube', label: 'Stock tube' },
      destination: { id: 'dest' },
    });
    const empty = await workspace({
      panel: 'transfers',
      plan: { id: plan.id, version: 1, group: 'dose', rowsPage: { offset: 80, limit: 20 } },
    });
    if (empty.panel !== 'transfers') throw new Error('Wrong panel');
    expect(empty.selectedPlan?.selectedGroup?.rows).toMatchObject({
      total: 73,
      items: [],
      hasMore: false,
    });
    await expect(
      workspace({ panel: 'transfers', plan: { id: plan.id, version: 1, group: 'absent' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      workspace({ panel: 'transfers', plan: { id: plan.id, version: 99 } }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      workspace(
        { panel: 'transfers', plan: { id: plan.id, version: 1 } },
        person,
        otherExperiment.id,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses malformed persisted endpoints instead of returning an incomplete successful row', async () => {
    const broken = await create('transfer_plan', 'Broken', {
      experiment: experiment.id,
      plates: [],
      groups: [
        {
          id: 'broken',
          label: 'Broken',
          method: 'direct_dispense',
          reason: 'Test',
          transfers: [
            {
              from: { plate: 'missing', well: 'A1' },
              to: { plate: 'also_missing', well: 'A1' },
              volume: { value: '1', unit: 'uL' },
            },
          ],
        },
      ],
    });
    await expect(
      workspace({ panel: 'transfers', plan: { id: broken.id, version: 1, group: 'broken' } }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await db.update(records).set({ status: 'archived' }).where(eq(records.id, broken.id));
  });

  it('discloses bounded overview omissions and keeps evidence on the exact visible fact', async () => {
    const build = vi.spyOn(overviewModule, 'buildRecordOverview').mockResolvedValue({
      identity: Array.from({ length: 15 }, (_, n) => ({ text: `Part ${n}` })),
      facts: Array.from({ length: 75 }, (_, n) => ({
        label: `Fact ${n}`,
        value: 'Unknown',
        field: 'note',
      })),
    });
    try {
      const output = await workspace({ panel: 'design', detail: { id: sop.id, version: 1 } });
      expect(output.detail?.overview.identity).toHaveLength(12);
      expect(output.detail?.overview.facts).toHaveLength(50);
      expect(output.detail?.overview).toMatchObject({ omittedIdentityParts: 3, omittedFacts: 25 });
    } finally {
      build.mockRestore();
    }
  });

  it('revalidates assistant context before grounding and offers workspace, plate and transfer tools', async () => {
    const output = await workspace({ panel: 'plates', map: { id: map.id, version: 1, plate: 1 } });
    const page = PageContext.parse({
      path: `/records/${experiment.id}`,
      record: { id: experiment.id, name: 'Client invented name', version: 1 },
      workspace: output.selection,
    });
    const note = await pageNote(registry.deps, agent, page);
    expect(note).toContain('server-resolved');
    expect(note).toContain('Does it inhibit?');
    expect(note).toContain('read-only navigation');
    const tools = toolsFor(registry, pageNamespaces(page, kinds));
    expect(tools.operationOf.get('experiments_workspace')).toBe('experiments.workspace');
    expect(tools.operationOf.get('platemaps_wells')).toBe('platemaps.wells');
    expect(tools.operationOf.get('transfers_export')).toBeDefined();
    await expect(pageNote(registry.deps, foreign, page)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      pageNote(registry.deps, agent, {
        ...page,
        workspace: { ...output.selection, version: 99 },
        record: { id: experiment.id, name: experiment.name, version: 99 },
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      pageNote(registry.deps, agent, {
        ...page,
        workspace: {
          ...output.selection,
          view: { panel: 'plates', map: { id: map.id, version: 1, plate: 99 } },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps a 5000-subject experiment and a 200-plate map bounded with exact last-page counts', async () => {
    const campaign = (experiment.attributes as { campaign: string }).campaign;
    const now = new Date();
    const subjects = Array.from({ length: 5000 }, (_, n) => ({
      id: newId('ent'),
      kind: 'entity',
      name: `ENT-${String(n + 100).padStart(5, '0')}`,
      label: `Compound ${n}`,
      attributes: { note: 'Synthetic compound' },
      status: 'draft' as const,
      version: 1,
      orgId: person.orgId,
      labId: person.labId,
      evidence: {},
      reviews: {},
      createdBy: person.actor,
      updatedBy: person.actor,
      createdAt: now,
      updatedAt: now,
    }));
    // PostgreSQL limits bind parameters; keep bulk fixture setup below that limit.
    for (let offset = 0; offset < subjects.length; offset += 1000)
      await db.insert(records).values(subjects.slice(offset, offset + 1000));
    const large = await fixtureRecord('experiment', 'exp', 'EXP-0100', {
      campaign,
      question: 'Scale fixture',
      stage: 'designing',
      subjects: subjects.map((r) => ({ record: r.id })),
      protocol: [],
    });
    const output = await workspace(
      { panel: 'design', page: { offset: 4990, limit: 20 } },
      person,
      large.id,
    );
    if (output.panel !== 'design') throw new Error('Wrong panel');
    expect(output.experiment.subjectCount).toBe(5000);
    expect(output.related).toMatchObject({ total: 5001, hasMore: false });
    expect(output.related.items).toHaveLength(11);
    expect(JSON.stringify(output).length).toBeLessThan(15000);
    const layout = await create('layout', 'Scale six well', { wells: 6, subjectRole: 'compound' });
    // Give names explicitly to keep the existing generator's optional live-name lookup out of this workload.
    const largeMap = await fixtureRecord('plate_map', 'pmp', 'PMP-0100', {
      experiment: large.id,
      layout: { id: layout.id, version: 1 },
      subjects: subjects.slice(0, 1200).map((r) => ({ record: r.id, label: r.label })),
    });
    const plate = await workspace(
      {
        panel: 'plates',
        page: { offset: 20, limit: 20 },
        map: { id: largeMap.id, version: 1, plate: 200 },
      },
      person,
      large.id,
    );
    if (plate.panel !== 'plates') throw new Error('Wrong panel');
    expect(plate.selectedMap).toMatchObject({ plateCount: 200, plate: 200 });
    expect(plate.selectedMap?.wells).toHaveLength(6);
    expect(plate.selectedMap?.related.total).toBe(7);
    expect(JSON.stringify(plate).length).toBeLessThan(15000);
  }, 20000);
});

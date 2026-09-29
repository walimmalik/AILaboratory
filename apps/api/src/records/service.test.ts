import { convert } from '@ailab/domain';
import type { Actor, Quantity } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { RecordError } from './errors.ts';
import { KindRegistry } from './kinds.ts';
import { type RecordContext, RecordService } from './service.ts';
import { widget } from './test-kinds.ts';

let db: Db;
let close: () => Promise<void>;
let ctx: RecordContext;
let agentCtx: RecordContext;
let service: RecordService;

const attrs = (color: string, partOf?: string) => ({
  color,
  volume: { value: '50', unit: 'uL' },
  ...(partOf ? { partOf } : {}),
});

async function expectError(promise: Promise<unknown>, code: RecordError['code']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RecordError);
  expect((error as RecordError).code).toBe(code);
  return error as RecordError;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  const agent: Actor = { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId };
  ctx = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agentCtx = { ...ctx, actor: agent };
  service = new RecordService(db, new KindRegistry().register(widget));
});
afterEach(() => close());

describe('create and read', () => {
  it('creates a draft with a readable name and version 1', async () => {
    const record = await service.create(ctx, {
      kind: 'widget',
      label: 'Blue',
      attributes: attrs('blue'),
    });
    expect(record).toMatchObject({
      kind: 'widget',
      name: 'WDG-0001',
      label: 'Blue',
      status: 'draft',
      version: 1,
      createdBy: ctx.actor,
    });
    expect(record.id).toMatch(/^wdg_/);
    expect(await service.get(ctx, record.id)).toEqual(record);
  });

  it('numbers names per lab and never reuses them', async () => {
    const a = await service.create(ctx, { kind: 'widget', label: 'A', attributes: attrs('a') });
    await service.deleteDraft(ctx, a.id, { expectedVersion: 1 });
    const b = await service.create(ctx, { kind: 'widget', label: 'B', attributes: attrs('b') });
    expect(b.name).toBe('WDG-0002');

    const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'X' });
    const otherCtx = { actor: ctx.actor, orgId: other.orgId, labId: other.labId };
    const c = await service.create(otherCtx, {
      kind: 'widget',
      label: 'C',
      attributes: attrs('c'),
    });
    expect(c.name).toBe('WDG-0001');
  });

  it('keeps labs apart', async () => {
    const record = await service.create(ctx, {
      kind: 'widget',
      label: 'A',
      attributes: attrs('a'),
    });
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'X' });
    const otherCtx = { actor: ctx.actor, orgId: other.orgId, labId: other.labId };
    await expectError(service.get(otherCtx, record.id), 'not_found');
  });

  it('rejects unknown kinds and invalid attributes with a readable message', async () => {
    await expectError(
      service.create(ctx, { kind: 'gadget', label: 'x', attributes: {} }),
      'unknown_kind',
    );
    const error = await expectError(
      service.create(ctx, {
        kind: 'widget',
        label: 'x',
        attributes: { color: 'red', volume: { value: 5, unit: 'uL' } },
      }),
      'invalid_attributes',
    );
    expect(error.message).toContain('volume.value');
  });
});

describe('history', () => {
  it('records every change with its actor, operation and reason', async () => {
    const created = await service.create(ctx, {
      kind: 'widget',
      label: 'Blue',
      attributes: attrs('blue'),
    });
    await service.update(agentCtx, created.id, {
      expectedVersion: 1,
      attributes: attrs('navy'),
      reason: 'Matched the catalog color',
    });
    await service.confirmSection(ctx, created.id, { expectedVersion: 2, section: 'appearance' });
    await service.confirmSection(ctx, created.id, { expectedVersion: 3, section: 'volume' });
    await service.activate(ctx, created.id, { expectedVersion: 4 });

    const history = await service.history(ctx, created.id);
    expect(history.map((v) => [v.version, v.operation, v.actor.type])).toEqual([
      [1, 'create', 'user'],
      [2, 'update', 'agent'],
      [3, 'confirm_section', 'user'],
      [4, 'confirm_section', 'user'],
      [5, 'activate', 'user'],
    ]);
    expect(history[1]?.reason).toBe('Matched the catalog color');
    expect(history[1]?.snapshot.attributes).toMatchObject({ color: 'navy' });
    expect(history[1]?.snapshot.updatedBy).toEqual(agentCtx.actor);
    expect((await service.getVersion(ctx, created.id, 1)).snapshot.attributes).toMatchObject({
      color: 'blue',
    });
  });

  it('restores an earlier version as a new version', async () => {
    const created = await service.create(ctx, {
      kind: 'widget',
      label: 'Blue',
      attributes: attrs('blue'),
    });
    await service.update(ctx, created.id, {
      expectedVersion: 1,
      label: 'Red',
      attributes: attrs('red'),
    });
    const restored = await service.restore(ctx, created.id, { version: 1, expectedVersion: 2 });
    expect(restored).toMatchObject({ version: 3, label: 'Blue', attributes: { color: 'blue' } });
    const history = await service.history(ctx, created.id);
    expect(history.map((v) => v.operation)).toEqual(['create', 'update', 'restore']);
    expect(history[2]?.reason).toBe('Restored version 1');
    await expectError(
      service.restore(ctx, created.id, { version: 3, expectedVersion: 3 }),
      'invalid_state',
    );
  });

  it('refuses changes made against a stale version', async () => {
    const created = await service.create(ctx, {
      kind: 'widget',
      label: 'Blue',
      attributes: attrs('blue'),
    });
    await service.update(ctx, created.id, { expectedVersion: 1, label: 'Blue 2' });
    const error = await expectError(
      service.update(agentCtx, created.id, { expectedVersion: 1, label: 'Agent edit' }),
      'version_conflict',
    );
    expect(error.details).toEqual({ currentVersion: 2 });
  });
});

describe('archive and delete', () => {
  it('archives and unarchives to the earlier status', async () => {
    const created = await service.create(ctx, {
      kind: 'widget',
      label: 'Blue',
      attributes: attrs('blue'),
      status: 'active',
    });
    const archived = await service.archive(ctx, created.id, { expectedVersion: 1 });
    expect(archived.status).toBe('archived');
    await expectError(
      service.update(ctx, created.id, { expectedVersion: 2, label: 'x' }),
      'invalid_state',
    );
    await expectError(service.archive(ctx, created.id, { expectedVersion: 2 }), 'invalid_state');
    const unarchived = await service.unarchive(ctx, created.id, { expectedVersion: 2 });
    expect(unarchived).toMatchObject({ status: 'active', version: 3 });
  });

  it('deletes only drafts that nothing links to', async () => {
    const active = await service.create(ctx, {
      kind: 'widget',
      label: 'Active',
      attributes: attrs('a'),
      status: 'active',
    });
    await expectError(service.deleteDraft(ctx, active.id, { expectedVersion: 1 }), 'invalid_state');

    const parent = await service.create(ctx, {
      kind: 'widget',
      label: 'Parent',
      attributes: attrs('p'),
    });
    await service.create(ctx, {
      kind: 'widget',
      label: 'Child',
      attributes: attrs('c', parent.id),
    });
    await expectError(service.deleteDraft(ctx, parent.id, { expectedVersion: 1 }), 'linked');

    const lonely = await service.create(ctx, {
      kind: 'widget',
      label: 'Lonely',
      attributes: attrs('l'),
    });
    await service.deleteDraft(ctx, lonely.id, { expectedVersion: 1 });
    await expectError(service.get(ctx, lonely.id), 'not_found');
  });
});

describe('links', () => {
  it('keeps links in sync with attributes, both directions', async () => {
    const parent = await service.create(ctx, {
      kind: 'widget',
      label: 'Parent',
      attributes: attrs('p'),
    });
    const other = await service.create(ctx, {
      kind: 'widget',
      label: 'Other',
      attributes: attrs('o'),
    });
    const child = await service.create(ctx, {
      kind: 'widget',
      label: 'Child',
      attributes: attrs('c', parent.id),
    });

    expect(await service.linksFrom(ctx, child.id)).toEqual([
      { fromId: child.id, toId: parent.id, relation: 'part_of' },
    ]);
    expect(await service.linksTo(ctx, parent.id)).toEqual([
      { fromId: child.id, toId: parent.id, relation: 'part_of' },
    ]);

    await service.update(ctx, child.id, { expectedVersion: 1, attributes: attrs('c', other.id) });
    expect(await service.linksTo(ctx, parent.id)).toEqual([]);
    expect((await service.linksTo(ctx, other.id)).map((l) => l.fromId)).toEqual([child.id]);

    await service.update(ctx, child.id, { expectedVersion: 2, attributes: attrs('c') });
    expect(await service.linksFrom(ctx, child.id)).toEqual([]);
  });

  it('refuses links to missing, archived, other-lab or self records', async () => {
    const missing = 'wdg_01J9Z3K8Q4ABCDEFGHJKMNPQRS';
    await expectError(
      service.create(ctx, { kind: 'widget', label: 'x', attributes: attrs('x', missing) }),
      'invalid_link',
    );

    const archived = await service.create(ctx, {
      kind: 'widget',
      label: 'Old',
      attributes: attrs('o'),
    });
    await service.archive(ctx, archived.id, { expectedVersion: 1 });
    const error = await expectError(
      service.create(ctx, { kind: 'widget', label: 'x', attributes: attrs('x', archived.id) }),
      'invalid_link',
    );
    expect(error.message).toContain('archived');

    const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'X' });
    const otherCtx = { actor: ctx.actor, orgId: other.orgId, labId: other.labId };
    const foreign = await service.create(otherCtx, {
      kind: 'widget',
      label: 'F',
      attributes: attrs('f'),
    });
    await expectError(
      service.create(ctx, { kind: 'widget', label: 'x', attributes: attrs('x', foreign.id) }),
      'invalid_link',
    );

    const self = await service.create(ctx, {
      kind: 'widget',
      label: 'Self',
      attributes: attrs('s'),
    });
    await expectError(
      service.update(ctx, self.id, { expectedVersion: 1, attributes: attrs('s', self.id) }),
      'invalid_link',
    );
  });

  it('keeps an existing link when its target is archived later', async () => {
    const parent = await service.create(ctx, {
      kind: 'widget',
      label: 'Parent',
      attributes: attrs('p'),
    });
    const child = await service.create(ctx, {
      kind: 'widget',
      label: 'Child',
      attributes: attrs('c', parent.id),
    });
    await service.archive(ctx, parent.id, { expectedVersion: 1 });
    const updated = await service.update(ctx, child.id, {
      expectedVersion: 1,
      attributes: { ...attrs('green', parent.id) },
    });
    expect(updated.version).toBe(2);
    expect(await service.linksTo(ctx, parent.id)).toHaveLength(1);
  });
});

describe('quantities in attributes', () => {
  it('stores exact decimal strings unchanged', async () => {
    const record = await service.create(ctx, {
      kind: 'widget',
      label: 'Precise',
      attributes: { color: 'x', volume: { value: '0.1', unit: 'uL' } },
    });
    const stored = (await service.get(ctx, record.id)).attributes as { volume: Quantity };
    expect(stored.volume).toEqual({ value: '0.1', unit: 'uL' });
    expect(convert(stored.volume, 'nL')).toEqual({ value: '100', unit: 'nL' });
  });
});

describe('draft and confirm', () => {
  const draft = () =>
    service.create(agentCtx, {
      kind: 'widget',
      label: 'Drafted',
      attributes: attrs('blue'),
      evidence: { volume: { source: 'datasheet', reference: 'https://example.org/widget.pdf' } },
    });

  it('marks what an agent sets as assumed unless it names a source', async () => {
    const record = await draft();
    expect(record.evidence.color).toMatchObject({ source: 'assumed', by: agentCtx.actor });
    expect(record.evidence.volume).toMatchObject({
      source: 'datasheet',
      reference: 'https://example.org/widget.pdf',
    });
    const state = await service.readiness(ctx, record.id);
    expect(state).toMatchObject({ ready: false, assumed: ['color'] });
    expect(state.missing).toEqual(['Appearance is not confirmed', 'Volume is not confirmed']);
  });

  it("a person's edit replaces an agent's estimate, and unchanged values keep their evidence", async () => {
    const record = await draft();
    const edited = await service.update(ctx, record.id, {
      expectedVersion: 1,
      attributes: attrs('navy'),
    });
    expect(edited.evidence.color).toMatchObject({ source: 'person', by: ctx.actor });
    expect(edited.evidence.volume).toEqual(record.evidence.volume);
    expect((await service.readiness(ctx, record.id)).assumed).toEqual([]);
  });

  it('records values the person told the agent as stated, not assumed; people cannot name it', async () => {
    const record = await service.create(agentCtx, {
      kind: 'widget',
      label: 'Told',
      attributes: attrs('clear'),
      evidence: { color: { source: 'stated' } },
    });
    expect(record.evidence.color).toMatchObject({ source: 'stated', by: agentCtx.actor });
    const state = await service.readiness(ctx, record.id);
    expect(state.assumed).toEqual(['volume']);
    expect(state.sections[0]?.fields[0]).toMatchObject({ state: 'unconfirmed', assumed: false });
    await expectError(
      service.update(ctx, record.id, {
        expectedVersion: 1,
        attributes: attrs('red'),
        evidence: { color: { source: 'stated' } },
      }),
      'invalid_input',
    );
  });

  it('refuses evidence for an attribute that has no value', async () => {
    const error = await expectError(
      service.create(agentCtx, {
        kind: 'widget',
        label: 'x',
        attributes: attrs('blue'),
        evidence: { partOf: { source: 'measured' } },
      }),
      'invalid_input',
    );
    expect(error.message).toContain('partOf');
  });

  it('confirms section by section, then activates', async () => {
    const record = await draft();
    await expectError(service.activate(ctx, record.id, { expectedVersion: 1 }), 'not_ready');
    const one = await service.confirmSection(ctx, record.id, {
      expectedVersion: 1,
      section: 'appearance',
    });
    expect(one.reviews.appearance).toMatchObject({
      confirmedBy: ctx.actor,
      version: 1,
      values: { color: 'blue' },
    });
    await service.confirmSection(ctx, record.id, { expectedVersion: 2, section: 'volume' });
    const state = await service.readiness(ctx, record.id);
    expect(state).toMatchObject({ ready: true, missing: [], assumed: [] });
    const active = await service.activate(ctx, record.id, { expectedVersion: 3 });
    expect(active.status).toBe('active');
  });

  it('sends a confirmed section back to review when a value changes', async () => {
    const record = await draft();
    await service.confirmSection(ctx, record.id, { expectedVersion: 1, section: 'volume' });
    await service.update(agentCtx, record.id, {
      expectedVersion: 2,
      attributes: { ...attrs('blue'), volume: { value: '80', unit: 'uL' } },
    });
    const volume = (await service.readiness(ctx, record.id)).sections.find(
      (s) => s.id === 'volume',
    );
    expect(volume?.state).toBe('needs_review');
    expect(volume?.fields[0]).toMatchObject({
      field: 'volume',
      state: 'changed',
      assumed: true,
      value: { value: '80', unit: 'uL' },
      confirmedValue: { value: '50', unit: 'uL' },
    });
  });

  it('refuses unknown sections, repeat confirmations and failing blockers', async () => {
    const record = await draft();
    await expectError(
      service.confirmSection(ctx, record.id, { expectedVersion: 1, section: 'shape' }),
      'invalid_input',
    );
    await service.confirmSection(ctx, record.id, { expectedVersion: 1, section: 'appearance' });
    await expectError(
      service.confirmSection(ctx, record.id, { expectedVersion: 2, section: 'appearance' }),
      'invalid_state',
    );

    const empty = await service.create(ctx, {
      kind: 'widget',
      label: 'Empty',
      attributes: { color: 'red', volume: { value: '0', unit: 'uL' } },
    });
    await service.confirmSection(ctx, empty.id, { expectedVersion: 1, section: 'appearance' });
    await service.confirmSection(ctx, empty.id, { expectedVersion: 2, section: 'volume' });
    const error = await expectError(
      service.activate(ctx, empty.id, { expectedVersion: 3 }),
      'not_ready',
    );
    expect(error.message).toContain('Volume is 0 uL');
  });

  it('a person may create a record active, which confirms every section; an agent may not', async () => {
    const record = await service.create(ctx, {
      kind: 'widget',
      label: 'Mine',
      attributes: attrs('red'),
      status: 'active',
    });
    const state = await service.readiness(ctx, record.id);
    expect(state.sections.map((s) => s.state)).toEqual(['confirmed', 'confirmed']);
    await expectError(
      service.create(agentCtx, {
        kind: 'widget',
        label: 'x',
        attributes: attrs('red'),
        status: 'active',
      }),
      'invalid_state',
    );
  });

  it('restoring an earlier version brings back its evidence', async () => {
    const record = await draft();
    await service.update(ctx, record.id, { expectedVersion: 1, attributes: attrs('navy') });
    const restored = await service.restore(ctx, record.id, { expectedVersion: 2, version: 1 });
    expect(restored.attributes.color).toBe('blue');
    expect(restored.evidence.color).toMatchObject({ source: 'assumed', by: agentCtx.actor });
    expect((await service.history(ctx, record.id))[0]?.snapshot.evidence.color?.source).toBe(
      'assumed',
    );
  });
});

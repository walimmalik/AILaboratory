import type { RecordEnvelope, SopAttributes } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, records, recordVersions } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { labwareKinds } from '../labware/kinds.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { sop } from './kinds.ts';

let db: Db;
let close: () => Promise<void>;
let person: RecordContext;
let agent: RecordContext;
let foreign: RecordContext;
let kinds: KindRegistry;
let service: RecordService;

const registryOf = (method: typeof sop = sop) => {
  const registry = new KindRegistry();
  for (const kind of [...labwareKinds, ...reagentKinds, ...libraryKinds, method])
    registry.register(kind);
  return registry;
};
const fact = (record: RecordEnvelope) => ({ id: record.id, version: record.version });
const sorted = (rows: RecordEnvelope[]) => rows.map(fact).sort((a, b) => a.id.localeCompare(b.id));

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  person = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  agent = { ...person, actor: { type: 'agent', agentName: 'Test', onBehalfOf: tenant.userId } };
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
  foreign = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  kinds = registryOf();
  service = new RecordService(db, kinds);
});
afterEach(() => close());

async function fixture(ctx = agent) {
  const product = await service.create(ctx, {
    kind: 'product',
    label: 'Antibody',
    attributes: {
      category: 'antibody',
      origin: 'bought',
      lotFields: [
        {
          key: 'concentration',
          label: 'Concentration',
          unit: 'ug/mL',
          typical: { value: '2', unit: 'ug/mL' },
        },
      ],
    },
  });
  const lot = await service.create(ctx, {
    kind: 'lot',
    label: 'Antibody lot',
    attributes: { product: product.id, lotNumber: '1', status: 'unopened', values: [] },
  });
  const document = await service.create(ctx, {
    kind: 'document',
    label: 'Method source',
    attributes: { type: 'sop', license: { name: 'CC0', sharePolicy: 'shareable' }, files: [] },
  });
  const prerequisite = await service.create(ctx, {
    kind: 'sop',
    label: 'Prepare',
    attributes: {
      materials: [],
      variables: [],
      steps: [{ id: 'prepare', action: 'manual', text: 'Prepare.' }],
    },
  });
  const attributes: SopAttributes = {
    source: { document: document.id },
    derivedFrom: prerequisite.id,
    materials: [{ role: 'antibody', label: 'Antibody', type: 'reagent', default: lot.id }],
    solutions: [{ role: 'buffer', label: 'Buffer', recipe: product.id, text: 'Prepare buffer.' }],
    variables: [
      {
        name: 'concentration',
        label: 'Concentration',
        kind: 'record',
        readFrom: { role: 'antibody', field: 'concentration' },
      },
    ],
    steps: [
      {
        id: 'coat',
        action: 'manual',
        text: 'Coat.',
        uses: ['antibody'],
        prerequisite: prerequisite.id,
        cite: [{ document: document.id, quote: 'Coat.' }],
      },
    ],
    questions: [
      {
        id: 'temperature',
        about: { step: 'coat' },
        question: 'Which temperature?',
        stage: { stage: 'method', reason: 'Source conflict' },
        responses: [],
        disposition: { status: 'open' },
      },
    ],
  };
  const drafted = await createRegistry(db, kinds, new ActivityBus()).execute(ctx, 'sops.draft', {
    label: 'Coat',
    ...attributes,
    questions: attributes.questions?.map(
      ({ responses: _responses, disposition: _disposition, ...question }) => question,
    ),
  });
  if (drafted.status !== 'done') throw new Error('SOP draft did not execute');
  const target = drafted.output as RecordEnvelope;
  return {
    product,
    lot,
    document,
    prerequisite,
    target,
    attributes: target.attributes as SopAttributes,
  };
}

describe('private SOP readiness read capture', () => {
  it('observes real direct and recursive field reads, deduplicated, with unchanged scientific checks', async () => {
    const f = await fixture();
    const unrelated = await service.create(agent, {
      kind: 'product',
      label: 'Unrelated',
      attributes: { category: 'buffer', origin: 'bought' },
    });
    const operations = createRegistry(db, kinds, new ActivityBus());
    const response = await operations.execute(person, 'sops.answer_question', {
      sop: f.target.id,
      expectedVersion: f.target.version,
      question: 'temperature',
      action: { type: 'response', text: "I don't know" },
    });
    expect(response.status).toBe('done');
    if (response.status !== 'done') throw new Error('Question response did not execute');
    const target = response.output as RecordEnvelope;
    await db.transaction(async (tx) => {
      const local = new RecordService(tx, kinds);
      const captured = await local.captureSopReadiness(person, target.id);
      expect(captured.status).toBe('complete');
      expect(captured.target).toEqual(fact(target));
      expect(captured.reads).toEqual(sorted([f.product, f.lot, f.document, f.prerequisite]));
      expect(captured.reads.some((r) => r.id === unrelated.id)).toBe(false);
      expect(captured.readiness).toEqual(await local.readiness(person, target.id));
      expect(captured.readiness?.checks.find((c) => c.id === 'questions_answered')).toMatchObject({
        passed: false,
        severity: 'blocker',
      });
      expect((await local.get(person, target.id)).attributes.questions).toMatchObject([
        { disposition: { status: 'open' }, responses: [{ text: "I don't know" }] },
      ]);
    });
  });

  it('keeps before and after phases separate in a caller rollback, including newly reached recursive dependencies', async () => {
    const f = await fixture();
    const next = await fixture();
    // The next product is not otherwise mentioned by the proposed method: only its lot links it.
    const attributes = {
      ...f.attributes,
      materials: [{ ...f.attributes.materials[0], default: next.lot.id }],
    };
    const bus = new ActivityBus();
    const operations = createRegistry(db, kinds, bus);
    const delivered: unknown[] = [];
    bus.subscribe(person.labId, (entry) => delivered.push(entry));
    const beforeRows = await db.select().from(records);
    const beforeHistory = await db.select().from(recordVersions);
    const beforeActivity = await db.select().from(activity);
    const rollback = new Error('Preview rollback');
    await expect(
      operations.transaction(db, async (tx) => {
        const local = new RecordService(tx, kinds);
        const before = await local.captureSopReadiness(agent, f.target.id);
        expect(before.status).toBe('complete');
        const edit = await operations.execute(
          person,
          'records.update',
          { id: f.target.id, expectedVersion: f.target.version, attributes },
          {},
          tx,
        );
        expect(edit.status).toBe('done');
        if (edit.status !== 'done') throw new Error('Draft edit did not execute');
        const updated = edit.output as RecordEnvelope;
        const after = await local.captureSopReadiness(agent, f.target.id);
        expect(after.status).toBe('complete');
        expect(before.target).toEqual(fact(f.target));
        expect(after.target).toEqual(fact(updated));
        expect(after.reads).toEqual(
          sorted([f.product, next.product, next.lot, f.document, f.prerequisite]),
        );
        expect(after.readiness).toEqual(await local.readiness(agent, f.target.id));
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await db.select().from(records)).toEqual(beforeRows);
    expect(await db.select().from(recordVersions)).toEqual(beforeHistory);
    expect(await db.select().from(activity)).toEqual(beforeActivity);
    expect(delivered).toEqual([]);
  });

  it('reports missing and foreign dependencies as scoped unavailability while retaining the ordinary blocker', async () => {
    const f = await fixture();
    const other = await fixture(foreign);
    for (const id of [newId('lot'), other.lot.id]) {
      const attributes = {
        ...f.attributes,
        materials: [{ ...f.attributes.materials[0], default: id }],
      };
      const rollback = new Error('Rollback invalid stored fixture');
      await expect(
        db.transaction(async (tx) => {
          await tx.update(records).set({ attributes }).where(eq(records.id, f.target.id));
          const local = new RecordService(tx, kinds);
          const captured = await local.captureSopReadiness(agent, f.target.id);
          expect(captured).toMatchObject({
            status: 'incomplete',
            issues: [{ code: 'unavailable_record', id }],
          });
          expect(captured.readiness).toEqual(await local.readiness(agent, f.target.id));
          expect(
            captured.readiness?.checks.some(
              (c) => !c.passed && c.message?.includes('not a record in this lab'),
            ),
          ).toBe(true);
          await expect(
            local.update(agent, f.target.id, { expectedVersion: f.target.version, attributes }),
          ).rejects.toMatchObject({ code: 'invalid_attributes' });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    }
    await db.transaction(async (tx) => {
      expect(
        await new RecordService(tx, kinds).captureSopReadiness(foreign, f.target.id),
      ).toMatchObject({
        status: 'incomplete',
        reads: [],
        issues: [{ code: 'unavailable_record', id: f.target.id }],
      });
    });
  });

  it('fails closed for unsupported getters only in capture mode and refuses nontransaction or nonSOP use', async () => {
    const f = await fixture();
    const ordinary = await service.readiness(agent, f.target.id);
    expect(await service.captureSopReadiness(agent, f.target.id)).toMatchObject({
      status: 'incomplete',
      issues: [{ code: 'transaction_required' }],
    });
    for (const mode of ['getVersion', 'list'] as const) {
      const observed = registryOf({
        ...sop,
        related: async (a, ctx) => {
          if (mode === 'list') await ctx.list('product');
          else await ctx.getVersion(f.product.id, f.product.version);
          if (!sop.related) throw new Error('SOP rules are missing');
          return sop.related(a, ctx);
        },
      });
      await db.transaction(async (tx) => {
        const local = new RecordService(tx, observed);
        expect(await local.readiness(agent, f.target.id)).toEqual(ordinary);
        expect(await local.captureSopReadiness(agent, f.target.id)).toMatchObject({
          status: 'incomplete',
          issues: [{ code: 'unsupported_access', mode }],
        });
        expect(await local.captureSopReadiness(agent, f.product.id)).toMatchObject({
          status: 'incomplete',
          issues: [{ code: 'unsupported_target', id: f.product.id }],
        });
      });
    }
  });

  it('retains conflicting actual versions rather than arbitrarily choosing one', async () => {
    const f = await fixture();
    const rollback = new Error('Rollback conflicting reads');
    await expect(
      db.transaction(async (tx) => {
        const observed = registryOf({
          ...sop,
          related: async (a, ctx) => {
            await ctx.get(f.product.id);
            await new RecordService(tx, kinds).update(agent, f.product.id, {
              expectedVersion: f.product.version,
              label: 'Edited during checks',
            });
            if (!sop.related) throw new Error('SOP rules are missing');
            return sop.related(a, ctx);
          },
        });
        const captured = await new RecordService(tx, observed).captureSopReadiness(
          agent,
          f.target.id,
        );
        expect(captured).toMatchObject({
          status: 'incomplete',
          issues: [{ code: 'conflicting_version', id: f.product.id, versions: [1, 2] }],
        });
        expect(captured.reads.filter((r) => r.id === f.product.id)).toEqual([
          { id: f.product.id, version: 1 },
          { id: f.product.id, version: 2 },
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await service.get(agent, f.product.id)).toEqual(f.product);
  });

  it('isolates concurrent independent captures and scopes', async () => {
    const first = await fixture();
    const second = await fixture(foreign);
    await db.transaction(async (tx) => {
      const local = new RecordService(tx, kinds);
      const [a, b] = await Promise.all([
        local.captureSopReadiness(agent, first.target.id),
        local.captureSopReadiness(foreign, second.target.id),
      ]);
      expect(a.status).toBe('complete');
      expect(b.status).toBe('complete');
      expect(a.reads).toEqual(
        sorted([first.product, first.lot, first.document, first.prerequisite]),
      );
      expect(b.reads).toEqual(
        sorted([second.product, second.lot, second.document, second.prerequisite]),
      );
    });
  });
});

import { newId } from '@ailab/domain';

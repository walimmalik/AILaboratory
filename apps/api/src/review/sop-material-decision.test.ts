import { newId } from '@ailab/domain';
import { type Proposal, type SopAttributes, SopMaterialDecisionPreview } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, proposals, records, recordVersions, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { sop } from '../sops/kinds.ts';
import {
  executeSopInputDecision,
  executeSopMaterialDecision,
  prepareSopMaterialDecision,
  revalidateSopMaterialDecision,
  sopMaterialMeaningDigest,
} from './sop-input-decision.ts';
import { materialDecisionFixture } from './test-sop-material.ts';

let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());
type Fixture = Awaited<ReturnType<typeof materialDecisionFixture>>;
async function checked(f: Fixture, p: Proposal, tx: Db, person = f.person) {
  const r = await revalidateSopMaterialDecision(
    { ...f, db: tx },
    person,
    p.id,
    p.decision?.previewIdentity.digest ?? '',
  );
  if (r.status !== 'unchanged') throw new Error('Expected unchanged');
  return r;
}
async function tables() {
  return {
    records: await db.select().from(records),
    history: await db.select().from(recordVersions),
    activity: await db.select().from(activity),
  };
}

describe('private declared experiment-material decision producer', () => {
  it('captures whole material/question and real indirect reads with no scientific/history/activity/delivery leakage; public paths refuse', async () => {
    const f = await materialDecisionFixture(db),
      before = await tables();
    const delivery: unknown[] = [];
    f.bus.subscribe(f.person.labId, (e) => delivery.push(e));
    const p = await prepareSopMaterialDecision(f, f.agent, f.input);
    const preview = SopMaterialDecisionPreview.parse(p.preview);
    expect(preview.material).toEqual(f.target.attributes.materials.find((m) => m.role === 'plate'));
    expect(preview.question).toEqual(f.target.attributes.questions?.[0]);
    expect(preview.acceptance).toMatchObject({
      by: 'applying_person',
      proposedBy: f.agent.actor,
      action: {
        obligation: {
          stage: 'experiment',
          binding: { type: 'material_role', role: 'plate' },
          condition: 'Choose Assay plate explicitly for each experiment.',
        },
      },
    });
    expect(preview).toMatchObject({
      changedPath: '/questions/plate/disposition',
      consequence: 'Still requires an explicit material choice for the experiment.',
      methodChanges: 'none',
      sectionConfirmations: 'unchanged',
      resultingStatus: 'draft',
      finalConfirmation: 'separate',
      scientificValidation: 'not_claimed',
    });
    expect(JSON.stringify(preview.acceptance)).not.toContain('acceptedBy');
    expect(JSON.stringify(preview.acceptance)).not.toContain('"at"');
    expect(preview.before.reads.map((r) => r.id).sort()).toEqual(
      [f.product.id, f.lot.id, f.document.id].sort(),
    );
    expect(preview.after.reads).toEqual(preview.before.reads);
    expect(preview.before.readiness.checks).toEqual(preview.after.readiness.checks);
    expect(await tables()).toEqual(before);
    expect(delivery).toEqual([]);
    await expect(
      f.registry.execute(f.agent, 'review.prepare_decision', f.input),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      f.registry.execute(f.person, 'proposals.approve', {
        id: p.id,
        expectedPreview: p.decision?.previewIdentity.digest,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect(await db.select().from(proposals)).toHaveLength(1);
  });

  it('keeps historical person A and evidence, same meaning for B, only disposition changes under one exact single-use transaction authorization', async () => {
    const f = await materialDecisionFixture(db),
      applyingId = newId('usr');
    await db.insert(users).values({ id: applyingId, orgId: f.person.orgId, displayName: 'Sam' });
    const person = { ...f.person, actor: { type: 'user' as const, userId: applyingId } };
    const p = await prepareSopMaterialDecision(f, f.person, f.input);
    const preview = SopMaterialDecisionPreview.parse(p.preview);
    expect(preview.question.responses[0]?.by).toEqual(f.person.actor);
    await f.registry.transaction(db, async (tx) => {
      const r = await checked(f, p, tx, person);
      expect(r.prepared.decision.previewIdentity.digest).toBe(p.decision?.previewIdentity.digest);
      await expect(
        executeSopMaterialDecision({ ...f, db: tx }, { ...r.authorization }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(executeSopMaterialDecision(f, r.authorization)).rejects.toMatchObject({
        code: 'forbidden',
      });
      // Runtime mode separation also refuses a material token presented to the input consumer.
      await expect(
        executeSopInputDecision({ ...f, db: tx }, r.authorization as never),
      ).rejects.toMatchObject({ code: 'forbidden' });
      const out = await executeSopMaterialDecision({ ...f, db: tx }, r.authorization);
      expect(out.attributes.questions).toEqual([
        {
          ...f.target.attributes.questions?.[0],
          disposition: {
            status: 'deferred',
            proposal: p.id,
            proposedBy: f.person.actor,
            acceptedBy: person.actor,
            at: expect.any(String),
            action: r.prepared.input,
          },
        },
      ]);
      const { questions: _old, ...old } = f.target.attributes;
      const { questions: _new, ...now } = out.attributes;
      expect(now).toEqual(old);
      expect(out).toMatchObject({
        status: 'draft',
        updatedBy: person.actor,
        evidence: f.target.evidence,
        reviews: f.target.reviews,
        origin: f.target.origin,
      });
      await expect(
        executeSopMaterialDecision({ ...f, db: tx }, r.authorization),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  it('includes role type/requirements/citations/question/check meaning in digest and preserves unrelated edits while requiring a new token for changes', async () => {
    const f = await materialDecisionFixture(db);
    let p = await prepareSopMaterialDecision(f, f.agent, f.input);
    const preview = SopMaterialDecisionPreview.parse(p.preview),
      digest = sopMaterialMeaningDigest(preview);
    for (const material of [
      { ...preview.material, type: 'consumable' as const },
      { ...preview.material, requirements: 'Different declared requirements' },
      {
        ...preview.material,
        cite: [{ document: f.document.id, quote: 'Different quoted requirement' }],
      },
    ])
      expect(sopMaterialMeaningDigest({ ...preview, material })).not.toBe(digest);
    expect(
      sopMaterialMeaningDigest({
        ...preview,
        after: {
          ...preview.after,
          readiness: {
            ...preview.after.readiness,
            checks: [
              {
                id: 'changed',
                label: 'Different check meaning',
                passed: false,
                severity: 'blocker',
                source: 'sop',
                message: 'Changed',
              },
            ],
          },
        },
      }),
    ).not.toBe(digest);
    let current = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Retained unrelated note' },
    });
    await f.registry.transaction(db, async (tx) => {
      expect((await checked(f, p, tx)).prepared.input.expectedVersion).toBe(current.version);
    });
    current = await f.service.update(f.person, current.id, {
      expectedVersion: current.version,
      attributes: {
        ...current.attributes,
        materials: (current.attributes.materials as SopAttributes['materials']).map((m) =>
          m.role === 'plate'
            ? { ...m, requirements: 'New scientist-reviewed declared requirements' }
            : m,
        ),
      },
    });
    await f.registry.transaction(db, async (tx) => {
      const r = await revalidateSopMaterialDecision(
        { ...f, db: tx },
        f.person,
        p.id,
        p.decision?.previewIdentity.digest ?? '',
      );
      expect(r.status).toBe('refreshed');
      expect(r.proposal.status).toBe('pending');
      const old = p;
      p = r.proposal;
      expect(p.decision?.previewIdentity.digest).not.toBe(old.decision?.previewIdentity.digest);
      expect(
        (
          await revalidateSopMaterialDecision(
            { ...f, db: tx },
            f.person,
            p.id,
            old.decision?.previewIdentity.digest ?? '',
          )
        ).status,
      ).toBe('stale');
    });
    expect((await f.service.get(f.person, current.id)).version).toBe(current.version);
    await f.registry.transaction(db, async (tx) => {
      const r = await checked(f, p, tx);
      expect(r.prepared.preview.material.requirements).toBe(
        'New scientist-reviewed declared requirements',
      );
      const out = await executeSopMaterialDecision({ ...f, db: tx }, r.authorization);
      expect(out.attributes.notes).toBe('Retained unrelated note');
    });
  });

  it('refuses caller scope/authority, other labs, agents applying, direct/generic/restore bypass, accepted wording edits and role orphan/default', async () => {
    const f = await materialDecisionFixture(db);
    for (const extra of [
      { material: f.product.id },
      { role: 'antibody' },
      { condition: 'Optional' },
      { approvedBy: f.person.actor },
      { proposal: newId('prp') },
    ])
      await expect(
        prepareSopMaterialDecision(f, f.agent, { ...f.input, ...extra }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    const foreign = await createTenant(db, {
      orgName: 'Other',
      labName: 'Other',
      userName: 'Other',
    });
    await expect(
      prepareSopMaterialDecision(
        f,
        { ...f.person, orgId: foreign.orgId, labId: foreign.labId },
        f.input,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const p = await prepareSopMaterialDecision(f, f.agent, f.input);
    await expect(
      f.registry.transaction(db, (tx) =>
        revalidateSopMaterialDecision(
          { ...f, db: tx },
          f.agent,
          p.id,
          p.decision?.previewIdentity.digest ?? '',
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const action = SopMaterialDecisionPreview.parse(p.preview).acceptance.action;
    const attributes = {
      ...f.target.attributes,
      questions: f.target.attributes.questions?.map((q) => ({
        ...q,
        disposition: {
          status: 'deferred',
          proposal: p.id,
          proposedBy: f.agent.actor,
          acceptedBy: f.person.actor,
          at: new Date().toISOString(),
          action,
        },
      })),
    };
    await expect(
      f.service.update(
        { ...f.person, via: 'sops.answer_question', approvedBy: f.person.actor },
        f.target.id,
        { expectedVersion: f.target.version, attributes },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      f.registry.execute(f.person, 'records.update', {
        id: f.target.id,
        expectedVersion: f.target.version,
        attributes,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        ...f.input,
        reason: undefined,
        action: { type: 'defer', proposal: p.id },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const out = await f.registry.transaction(db, async (tx) =>
      executeSopMaterialDecision({ ...f, db: tx }, (await checked(f, p, tx)).authorization),
    );
    await expect(
      f.service.restore(f.person, out.id, {
        expectedVersion: out.version,
        version: f.target.version,
        reason: 'Undo',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        sop: out.id,
        expectedVersion: out.version,
        question: 'plate',
        action: { type: 'correct', text: 'Optional plate', reason: 'Rewrite' },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('reconsideration') });
    for (const materials of [
      (out.attributes.materials as SopAttributes['materials']).filter((m) => m.role !== 'plate'),
      (out.attributes.materials as SopAttributes['materials']).map((m) =>
        m.role === 'plate' ? { ...m, default: f.product.id } : m,
      ),
    ])
      await expect(
        f.service.update(f.person, out.id, {
          expectedVersion: out.version,
          attributes: { ...out.attributes, materials },
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
  });

  it('refuses defaulted/missing/mismatched targets and formerly confirmed SOPs, rolling back failed preparation', async () => {
    const f = await materialDecisionFixture(db);
    const before = await tables();
    for (const attributes of [
      {
        ...f.target.attributes,
        materials: f.target.attributes.materials.map((m) =>
          m.role === 'plate' ? { ...m, default: f.product.id } : m,
        ),
      },
      {
        ...f.target.attributes,
        materials: f.target.attributes.materials.filter((m) => m.role !== 'plate'),
      },
      {
        ...f.target.attributes,
        questions: f.target.attributes.questions?.map((q) => ({
          ...q,
          about: { material: 'antibody' },
        })),
      },
      {
        ...f.target.attributes,
        questions: f.target.attributes.questions?.map((q) => ({
          ...q,
          about: { material: 'plate', variable: 'well_volume' },
        })),
      },
    ]) {
      // Corrupt only disposable persisted fixtures to test defensive producer eligibility.
      await db.update(records).set({ attributes }).where(eq(records.id, f.target.id));
      await expect(prepareSopMaterialDecision(f, f.agent, f.input)).rejects.toMatchObject({
        code: 'invalid_input',
      });
    }
    await db
      .update(records)
      .set({ attributes: f.target.attributes })
      .where(eq(records.id, f.target.id));
    await db
      .update(recordVersions)
      .set({ snapshot: { ...f.target, status: 'active' } })
      .where(eq(recordVersions.recordId, f.target.id));
    await expect(prepareSopMaterialDecision(f, f.agent, f.input)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect(await db.select().from(proposals)).toEqual([]);
    expect(await db.select().from(activity)).toEqual(before.activity);
  });

  it('rolls back late owning failure and incomplete capture without history/activity/delivery or simulated acceptance leakage', async () => {
    const f = await materialDecisionFixture(db),
      p = await prepareSopMaterialDecision(f, f.agent, f.input),
      before = await tables();
    const priorProposals = await db.select().from(proposals),
      delivery: unknown[] = [];
    f.bus.subscribe(f.person.labId, (e) => delivery.push(e));
    const failure = new Error('Late downstream failure');
    await expect(
      f.registry.transaction(db, async (tx) => {
        await executeSopMaterialDecision({ ...f, db: tx }, (await checked(f, p, tx)).authorization);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await tables()).toEqual(before);
    expect(await db.select().from(proposals)).toEqual(priorProposals);
    expect(delivery).toEqual([]);
    const unsupported = {
      ...sop,
      related: async (a: SopAttributes, c: Parameters<NonNullable<typeof sop.related>>[1]) => {
        await c.list('product');
        return sop.related?.(a, c) ?? {};
      },
    };
    const g = await materialDecisionFixture(db, unsupported),
      snapshot = await g.service.get(g.person, g.target.id);
    await expect(prepareSopMaterialDecision(g, g.agent, g.input)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await g.service.get(g.person, g.target.id)).toEqual(snapshot);
    expect(await db.select().from(proposals)).toEqual(priorProposals);
  });

  it('refuses revalidation when the persisted role is defaulted without refreshing or granting an authorization', async () => {
    const f = await materialDecisionFixture(db),
      p = await prepareSopMaterialDecision(f, f.agent, f.input);
    const proposalBefore = await db.select().from(proposals),
      historyBefore = await db.select().from(recordVersions);
    // A normal update cannot violate stageProblem; persisted corruption still must fail closed.
    await db
      .update(records)
      .set({
        attributes: {
          ...f.target.attributes,
          materials: f.target.attributes.materials.map((m) =>
            m.role === 'plate' ? { ...m, default: f.product.id } : m,
          ),
        },
      })
      .where(eq(records.id, f.target.id));
    const recordBefore = await db.select().from(records);
    await expect(
      f.registry.transaction(db, (tx) =>
        revalidateSopMaterialDecision(
          { ...f, db: tx },
          f.person,
          p.id,
          p.decision?.previewIdentity.digest ?? '',
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.select().from(proposals)).toEqual(proposalBefore);
    expect(await db.select().from(recordVersions)).toEqual(historyBefore);
    expect(await db.select().from(records)).toEqual(recordBefore);
  });
});

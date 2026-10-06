import { newId } from '@ailab/domain';
import {
  type Proposal,
  type RecordEnvelope,
  type SopAttributes,
  SopInputDecisionPreview,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, proposals, records, recordVersions, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { sop } from '../sops/kinds.ts';
import {
  executeSopInputDecision,
  prepareSopInputDecision,
  revalidateSopInputDecision,
} from './sop-input-decision.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());
async function fixture(method: typeof sop = sop) {
  const f = await defaultDecisionFixture(db, method);
  let target = await f.draft({
    ...f.target.attributes,
    variables: [
      ...f.target.attributes.variables,
      { name: 'count', label: 'Sample count', kind: 'input', value: '1', min: '1', max: '100' },
    ],
    questions: [
      {
        id: 'count',
        question: 'How many samples?',
        about: { variable: 'count' },
        stage: {
          stage: 'experiment',
          reason: 'Chosen per experiment',
          binding: { type: 'input', variable: 'count' },
        },
        responses: [],
        disposition: { status: 'open' },
      },
    ],
  });
  const response = await f.registry.execute(f.person, 'sops.answer_question', {
    sop: target.id,
    expectedVersion: target.version,
    question: 'count',
    action: { type: 'response', text: 'The experiment owner will choose.' },
  });
  if (response.status !== 'done') throw new Error('Expected response');
  target = response.output as RecordEnvelope<SopAttributes>;
  return {
    ...f,
    target,
    input: {
      sop: target.id,
      expectedVersion: target.version,
      question: 'count',
      reason: 'Keep sample count explicit for each experiment',
    },
  };
}
async function unchanged(
  f: Awaited<ReturnType<typeof fixture>>,
  proposal: Proposal,
  tx: Db,
  person = f.person,
) {
  const result = await revalidateSopInputDecision(
    { ...f, db: tx },
    person,
    proposal.id,
    proposal.decision?.previewIdentity.digest ?? '',
  );
  if (result.status !== 'unchanged') throw new Error(`Expected unchanged, got ${result.status}`);
  return result;
}

describe('private existing experiment-input decision producer', () => {
  it('previews real scoped reads and acceptance while rolling back every scientific/history/activity effect', async () => {
    const f = await fixture();
    const before = {
      records: await db.select().from(records),
      history: await db.select().from(recordVersions),
      activity: await db.select().from(activity),
    };
    const deliveries: unknown[] = [];
    f.bus.subscribe(f.person.labId, (e) => deliveries.push(e));
    const proposal = await prepareSopInputDecision(f, f.agent, f.input);
    const p = SopInputDecisionPreview.parse(proposal.preview);
    expect(proposal).toMatchObject({
      status: 'pending',
      operationId: 'sops.answer_question',
      proposedBy: f.agent.actor,
      decision: {
        origin: f.agent.origin,
        scope: { type: 'question_disposition', disposition: { type: 'defer', question: 'count' } },
        sources: [],
      },
    });
    expect(p.question).toEqual(f.target.attributes.questions?.[0]);
    expect(p.acceptance).toMatchObject({
      by: 'applying_person',
      status: 'deferred',
      action: {
        obligation: {
          stage: 'experiment',
          binding: { type: 'input', variable: 'count' },
          condition: 'Supply an explicit value for Sample count before the experiment is ready.',
        },
      },
    });
    expect(p).toMatchObject({
      changedPath: '/questions/count/disposition',
      consequence: 'Still required for every experiment.',
      methodChanges: 'none',
      sectionConfirmations: 'unchanged',
      resultingStatus: 'draft',
      finalConfirmation: 'separate',
      scientificValidation: 'not_claimed',
    });
    expect(JSON.stringify(p.acceptance)).not.toContain('acceptedBy');
    expect(JSON.stringify(p.acceptance)).not.toContain('"at"');
    expect(p.before.reads.map((r) => r.id).sort()).toEqual(
      [f.product.id, f.lot.id, f.document.id].sort(),
    );
    expect(p.after.reads).toEqual(p.before.reads);
    expect(p.after.target.version).toBe(f.target.version + 1);
    expect(p.before.readiness.checks).toEqual(p.after.readiness.checks);
    expect(await db.select().from(records)).toEqual(before.records);
    expect(await db.select().from(recordVersions)).toEqual(before.history);
    expect(await db.select().from(activity)).toEqual(before.activity);
    expect(deliveries).toEqual([]);
    // Public response/correction input cannot forge the internal disposition action.
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        sop: f.target.id,
        expectedVersion: f.target.version,
        question: 'count',
        action: { type: 'defer', proposal: proposal.id },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('retains historical people and evidence, uses actual person B, and authorizes only one exact transaction-bound owning write', async () => {
    const f = await fixture();
    const applyingId = newId('usr');
    await db.insert(users).values({ id: applyingId, orgId: f.person.orgId, displayName: 'Sam' });
    const applying = { ...f.person, actor: { type: 'user' as const, userId: applyingId } };
    const proposal = await prepareSopInputDecision(f, f.person, f.input);
    const p = SopInputDecisionPreview.parse(proposal.preview);
    expect(p.question.responses[0]?.by).toEqual(f.person.actor);
    await f.registry.transaction(db, async (tx) => {
      const r = await unchanged(f, proposal, tx, applying);
      expect(r.prepared.decision.previewIdentity.digest).toBe(
        proposal.decision?.previewIdentity.digest,
      );
      const out = await executeSopInputDecision({ ...f, db: tx }, r.authorization);
      const a = out.attributes as SopAttributes;
      expect(a.questions?.[0]).toEqual({
        ...f.target.attributes.questions?.[0],
        disposition: {
          status: 'deferred',
          proposal: proposal.id,
          proposedBy: f.person.actor,
          acceptedBy: applying.actor,
          at: expect.any(String),
          action: r.prepared.input,
        },
      });
      expect(out.status).toBe('draft');
      expect(out.updatedBy).toEqual(applying.actor);
      expect(out.evidence).toEqual(f.target.evidence);
      expect(out.reviews).toEqual(f.target.reviews);
      const { questions: _was, ...was } = f.target.attributes;
      const { questions: _now, ...now } = a;
      expect(now).toEqual(was);
      await expect(
        executeSopInputDecision({ ...f, db: tx }, r.authorization),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
    expect((await f.service.history(f.person, f.target.id)).at(-1)?.via).toBe(
      'sops.answer_question',
    );
  });

  it('refreshes changed question meaning and requires the next token, but accepts unrelated mechanical version changes', async () => {
    const f = await fixture();
    let proposal = await prepareSopInputDecision(f, f.agent, f.input);
    const updated = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Other drafting note' },
    });
    await f.registry.transaction(db, async (tx) => {
      const r = await unchanged(f, proposal, tx);
      expect(r.prepared.input.expectedVersion).toBe(updated.version);
    });
    const current = await f.service.get(f.person, f.target.id);
    await f.registry.execute(f.person, 'sops.answer_question', {
      sop: current.id,
      expectedVersion: current.version,
      question: 'count',
      action: { type: 'response', text: 'Choose the number before planning.' },
    });
    await f.registry.transaction(db, async (tx) => {
      const r = await revalidateSopInputDecision(
        { ...f, db: tx },
        f.person,
        proposal.id,
        proposal.decision?.previewIdentity.digest ?? '',
      );
      expect(r.status).toBe('refreshed');
      expect(r.proposal.id).toBe(proposal.id);
      expect(r.proposal.status).toBe('pending');
      expect(r.proposal.decision?.previewIdentity.digest).not.toBe(
        proposal.decision?.previewIdentity.digest,
      );
      const old = proposal;
      proposal = r.proposal;
      expect(
        (
          await revalidateSopInputDecision(
            { ...f, db: tx },
            f.person,
            old.id,
            old.decision?.previewIdentity.digest ?? '',
          )
        ).status,
      ).toBe('stale');
    });
    await f.registry.transaction(db, async (tx) => {
      await unchanged(f, proposal, tx);
    });
    expect((await f.service.get(f.person, f.target.id)).attributes.questions).toMatchObject([
      { disposition: { status: 'open' } },
    ]);
  });

  it('refuses forged/mixed scopes, other labs, agents applying, wrong stored binding and cloned authorization without any scientific write', async () => {
    const f = await fixture();
    const before = await f.service.get(f.person, f.target.id);
    for (const extra of [
      { approvedBy: f.person.actor },
      { condition: 'Optional' },
      { stage: 'method' },
      { variable: 'count' },
      { proposal: newId('prp') },
    ])
      await expect(
        prepareSopInputDecision(f, f.agent, { ...f.input, ...extra }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    const proposal = await prepareSopInputDecision(f, f.agent, f.input);
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
    await expect(
      prepareSopInputDecision(f, { ...f.person, orgId: other.orgId, labId: other.labId }, f.input),
    ).rejects.toMatchObject({ code: 'not_found' });
    await f.registry.transaction(db, async (tx) => {
      await expect(
        revalidateSopInputDecision(
          { ...f, db: tx },
          f.agent,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      const r = await unchanged(f, proposal, tx);
      await expect(
        executeSopInputDecision({ ...f, db: tx }, { ...r.authorization }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(executeSopInputDecision(f, r.authorization)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });
    await db
      .update(proposals)
      .set({ input: { ...(proposal.input as object), question: 'temperature' } })
      .where(eq(proposals.id, proposal.id));
    await expect(
      f.registry.transaction(db, (tx) =>
        revalidateSopInputDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const parsed = SopInputDecisionPreview.parse(proposal.preview);
    const action = parsed.acceptance.action;
    const attrs = {
      ...f.target.attributes,
      questions: f.target.attributes.questions?.map((q) => ({
        ...q,
        disposition: {
          status: 'deferred',
          proposal: proposal.id,
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
        { expectedVersion: f.target.version, attributes: attrs },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await f.service.get(f.person, f.target.id)).toEqual(before);
  });

  it('keeps accepted wording and bound input honest while allowing response-only history', async () => {
    const f = await fixture();
    const proposal = await prepareSopInputDecision(f, f.agent, f.input);
    const out = await f.registry.transaction(db, async (tx) =>
      executeSopInputDecision({ ...f, db: tx }, (await unchanged(f, proposal, tx)).authorization),
    );
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        sop: out.id,
        expectedVersion: out.version,
        question: 'count',
        action: { type: 'correct', text: 'Samples are optional', reason: 'Rewrite' },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('reconsideration') });
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        sop: out.id,
        expectedVersion: out.version,
        question: 'count',
        action: {
          type: 'correct',
          text: 'How many samples?',
          reason: 'Even identical wording is not a new acceptance',
        },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('reconsideration') });
    for (const variables of [
      (out.attributes.variables as SopAttributes['variables']).filter((v) => v.name !== 'count'),
      (out.attributes.variables as SopAttributes['variables']).map((v) =>
        v.name === 'count' ? { ...v, kind: 'default' as const } : v,
      ),
    ])
      await expect(
        f.service.update(f.person, out.id, {
          expectedVersion: out.version,
          attributes: { ...out.attributes, variables },
        }),
      ).rejects.toMatchObject({ code: 'invalid_attributes' });
    const response = await f.registry.execute(f.person, 'sops.answer_question', {
      sop: out.id,
      expectedVersion: out.version,
      question: 'count',
      action: { type: 'response', text: 'Use 24 in the next experiment.' },
    });
    expect(response.status).toBe('done');
    if (response.status !== 'done') throw new Error('Expected response');
    const saved = response.output as RecordEnvelope<SopAttributes>;
    expect(saved.attributes.questions?.[0]?.disposition).toEqual(
      (out.attributes as SopAttributes).questions?.[0]?.disposition,
    );
    expect(saved.attributes.questions?.[0]?.responses).toHaveLength(2);
    await expect(
      f.service.restore(f.person, out.id, {
        expectedVersion: saved.version,
        version: f.target.version,
        reason: 'Undo acceptance',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses method/material/run questions, stale or previously confirmed SOPs, and incomplete captures atomically', async () => {
    const f = await fixture();
    await expect(
      prepareSopInputDecision(f, f.person, { ...f.input, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      prepareSopInputDecision(f, f.person, { ...f.input, sop: f.target.id, question: 'missing' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      prepareSopInputDecision(f, f.person, {
        ...f.input,
        sop: f.edit.sop,
        expectedVersion: f.edit.expectedVersion,
        question: 'temperature',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    for (const stage of [
      {
        stage: 'experiment' as const,
        reason: 'Later',
        binding: { type: 'material_role' as const, role: 'sample' },
      },
      {
        stage: 'run' as const,
        reason: 'Later',
        binding: { type: 'input' as const, variable: 'count' },
      },
    ]) {
      // Run questions have no operational authoring path; schema refusal remains explicit.
      const result = await f.registry
        .execute(f.person, 'sops.draft', {
          label: 'Outside scope',
          materials: [{ role: 'sample', label: 'Sample', type: 'sample' }],
          variables: [{ name: 'count', label: 'Count', kind: 'input' }],
          steps: [],
          questions: [
            {
              id: 'later',
              question: 'Choose later',
              about:
                stage.binding.type === 'material_role'
                  ? { material: 'sample' }
                  : { variable: 'count' },
              stage,
            },
          ],
        })
        .catch((e) => e);
      if (result.status === 'done')
        await expect(
          prepareSopInputDecision(f, f.person, {
            ...f.input,
            sop: result.output.id,
            expectedVersion: result.output.version,
            question: 'later',
          }),
        ).rejects.toMatchObject({ code: 'invalid_input' });
      else expect(result.code).toBe('invalid_input');
    }
    expect(await db.select().from(proposals)).toEqual([]);
    const unsupported = {
      ...sop,
      related: async (a: SopAttributes, c: Parameters<NonNullable<typeof sop.related>>[1]) => {
        await c.list('product');
        return sop.related?.(a, c) ?? {};
      },
    };
    const g = await fixture(unsupported);
    const prior = await g.service.get(g.person, g.target.id);
    await expect(prepareSopInputDecision(g, g.agent, g.input)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await g.service.get(g.person, g.target.id)).toEqual(prior);
    expect(await db.select().from(proposals)).toEqual([]);
  });

  it('rolls back an authorized late failure including history and rejects incomplete authorization after rollback', async () => {
    const f = await fixture();
    const proposal = await prepareSopInputDecision(f, f.agent, f.input);
    const before = await db.select().from(recordVersions);
    const beforeRecords = await db.select().from(records);
    const beforeActivity = await db.select().from(activity);
    const beforeProposals = await db.select().from(proposals);
    const deliveries: unknown[] = [];
    f.bus.subscribe(f.person.labId, (entry) => deliveries.push(entry));
    const late = new Error('Late failure');
    await expect(
      f.registry.transaction(db, async (tx) => {
        const r = await unchanged(f, proposal, tx);
        await executeSopInputDecision({ ...f, db: tx }, r.authorization);
        throw late;
      }),
    ).rejects.toBe(late);
    expect(await db.select().from(recordVersions)).toEqual(before);
    expect(await db.select().from(records)).toEqual(beforeRecords);
    expect(await db.select().from(activity)).toEqual(beforeActivity);
    expect(await db.select().from(proposals)).toEqual(beforeProposals);
    expect(deliveries).toEqual([]);
    expect((await f.service.get(f.person, f.target.id)).attributes).toEqual(f.target.attributes);
  });

  it('fails closed for missing and cross-lab indirect validation reads', async () => {
    const f = await fixture();
    const other = await createTenant(db, {
      orgName: 'Foreign',
      labName: 'Foreign',
      userName: 'Other',
    });
    const foreign = await f.service.create(
      { ...f.person, orgId: other.orgId, labId: other.labId },
      {
        kind: 'product',
        label: 'Foreign secret product',
        attributes: { category: 'antibody', origin: 'bought', lotFields: [] },
      },
    );
    for (const product of [newId('prd'), foreign.id]) {
      // Corrupt persisted fixture references only, to exercise actual scoped read capture refusal.
      await db
        .update(records)
        .set({ attributes: { ...f.lot.attributes, product } })
        .where(eq(records.id, f.lot.id));
      const before = await f.service.get(f.person, f.target.id);
      await expect(prepareSopInputDecision(f, f.agent, f.input)).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(await f.service.get(f.person, f.target.id)).toEqual(before);
      expect(await db.select().from(proposals)).toEqual([]);
    }
  });

  it('refuses accepted, archived and historical accepted SOPs; acceptance never manufactures editability', async () => {
    const f = await fixture();
    let confirmed: RecordEnvelope = f.target;
    for (const section of f.kinds.get('sop').sections ?? []) {
      const result = await f.registry.execute(f.person, 'records.confirm_section', {
        id: confirmed.id,
        expectedVersion: confirmed.version,
        section: section.id,
      });
      if (result.status !== 'done') throw new Error('Expected section confirmation');
      confirmed = result.output as RecordEnvelope;
    }
    expect(confirmed.status).toBe('active');
    await expect(
      prepareSopInputDecision(f, f.person, { ...f.input, expectedVersion: confirmed.version }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Archiving cannot make a previously accepted method eligible again.
    const archived = await f.service.archive(f.person, confirmed.id, {
      expectedVersion: confirmed.version,
    });
    await expect(
      prepareSopInputDecision(f, f.person, { ...f.input, expectedVersion: archived.version }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Persisted historical fixture: draft status cannot erase an earlier accepted version.
    await db.update(records).set({ status: 'draft' }).where(eq(records.id, archived.id));
    await expect(
      prepareSopInputDecision(f, f.person, { ...f.input, expectedVersion: archived.version }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await db.select().from(proposals)).toEqual([]);
  });
});

import { writeFile } from 'node:fs/promises';
import { newId } from '@ailab/domain';
import { type Proposal, type SopAttributes, SopDilutionDecisionPreview } from '@ailab/schema';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, librarySnapshots, records, recordVersions, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { createProposal } from '../operations/proposal-store.ts';
import { RecordService } from '../records/service.ts';
import {
  executeSopDilutionDecision,
  prepareSopDilutionDecision,
  revalidateSopDilutionDecision,
} from './sop-dilution-decision.ts';
import { dilutionDecisionFixture } from './test-sop-dilution.ts';

let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());
type Fixture = Awaited<ReturnType<typeof dilutionDecisionFixture>>;
const tables = async () => ({
  records: await db.select().from(records),
  history: await db.select().from(recordVersions),
  activity: await db.select().from(activity),
});
async function checked(f: Fixture, p: Proposal, tx: Db, person = f.person) {
  const r = await revalidateSopDilutionDecision(
    { ...f, db: tx },
    person,
    p.id,
    p.decision?.previewIdentity.digest ?? '',
  );
  if (r.status !== 'unchanged') throw new Error(`Expected unchanged, got ${r.status}`);
  return r;
}

describe('private source-backed dilution completion', () => {
  it('rejects either bound on both component formulas before preparation and after acceptance', async () => {
    const f = await dilutionDecisionFixture(db);
    const bounded = (attributes: SopAttributes, name: string, bound: 'min' | 'max') => ({
      ...attributes,
      variables: attributes.variables.map((v) =>
        v.name === name ? { ...v, [bound]: { value: '0.1', unit: 'mL' } } : v,
      ),
    });
    for (const name of ['culture_volume', 'lb_volume'])
      for (const bound of ['min', 'max'] as const) {
        await expect(
          f.registry.transaction(db, async (tx) => {
            const changed = await new RecordService(tx, f.kinds).update(f.agent, f.target.id, {
              expectedVersion: f.target.version,
              attributes: bounded(f.target.attributes, name, bound),
            });
            await prepareSopDilutionDecision({ ...f, db: tx }, f.agent, {
              ...f.input,
              expectedVersion: changed.version,
            });
          }),
        ).rejects.toThrow('unbounded');
        expect((await f.service.get(f.person, f.target.id)).version).toBe(f.target.version);
      }
    const p = await prepareSopDilutionDecision(f, f.agent, f.input);
    const accepted = await f.registry.transaction(db, async (tx) =>
      executeSopDilutionDecision({ ...f, db: tx }, (await checked(f, p, tx)).authorization),
    );
    const before = await tables();
    for (const name of ['culture_volume', 'lb_volume'])
      for (const bound of ['min', 'max'] as const)
        await expect(
          f.service.update(f.person, accepted.id, {
            expectedVersion: accepted.version,
            attributes: bounded(accepted.attributes as SopAttributes, name, bound),
          }),
        ).rejects.toThrow();
    expect(await tables()).toEqual(before);
  });

  it('protects accepted source evidence on evidence-only, same-value, approved and restore writes while unrelated evidence remains editable', async () => {
    const f = await dilutionDecisionFixture(db),
      p = await prepareSopDilutionDecision(f, f.agent, f.input);
    const accepted = await f.registry.transaction(db, async (tx) =>
      executeSopDilutionDecision({ ...f, db: tx }, (await checked(f, p, tx)).authorization),
    );
    const path = '/variables/final_volume';
    const acceptedEvidence = accepted.evidence[path];
    if (!acceptedEvidence) throw new Error('Expected accepted source evidence');
    const replacement = {
      [path]: {
        source: 'imported' as const,
        reference: 'unrelated-document',
        note: 'Replacement unrelated claim',
      },
    };
    const before = await tables();
    for (const attributes of [undefined, accepted.attributes]) {
      const input = {
        id: accepted.id,
        expectedVersion: accepted.version,
        ...(attributes ? { attributes } : {}),
        evidence: replacement,
      };
      await expect(f.run(f.agent, 'records.update', input)).rejects.toThrow('source evidence');
      await expect(
        f.service.update(
          { ...f.agent, via: 'records.update', approvedBy: f.person.actor },
          accepted.id,
          input,
        ),
      ).rejects.toThrow('source evidence');
      expect((await tables()).records).toEqual(before.records);
      expect((await tables()).history).toEqual(before.history);
      expect((await tables()).activity.at(-1)).toMatchObject({
        operationId: 'records.update',
        outcome: 'failed',
        error: { code: 'invalid_input' },
      });
      const ordinary = await createProposal(db, f.agent, {
        operationId: 'records.update',
        input,
        preview: null,
      });
      expect(
        await f.registry.execute(f.person, 'proposals.approve', { id: ordinary.id }),
      ).toMatchObject({
        status: 'done',
        output: { status: 'failed', error: { code: 'invalid_input' } },
      });
      expect((await tables()).records).toEqual(before.records);
      expect((await tables()).history).toEqual(before.history);
    }
    const unrelated = await f.run<{ version: number }>(f.agent, 'records.update', {
      id: accepted.id,
      expectedVersion: accepted.version,
      evidence: { notes: { source: 'assumed', note: 'Unrelated note evidence' } },
    });
    expect((await f.service.get(f.person, accepted.id)).evidence[path]).toEqual(
      accepted.evidence[path],
    );
    const current = await f.service.update(f.agent, accepted.id, {
      expectedVersion: unrelated.version,
      attributes: {
        ...accepted.attributes,
        variables: [
          ...(accepted.attributes.variables as SopAttributes['variables']),
          { name: 'other', label: 'Other', kind: 'default', value: '1' },
        ],
      },
    });
    const historical = (await f.service.history(f.person, accepted.id)).find(
      (v) => v.version === accepted.version,
    );
    if (!historical) throw new Error('Expected accepted history');
    const beforeRestore = await tables();
    // Disposable corrupted historical evidence must not be adopted by restore; the test setup rolls back too.
    await expect(
      f.registry.transaction(db, async (tx) => {
        await tx
          .update(recordVersions)
          .set({
            snapshot: {
              ...historical.snapshot,
              evidence: {
                ...historical.snapshot.evidence,
                [path]: { ...acceptedEvidence, ...replacement[path] },
              },
            },
          })
          .where(
            and(
              eq(recordVersions.recordId, accepted.id),
              eq(recordVersions.version, accepted.version),
            ),
          );
        await new RecordService(tx, f.kinds).restore(f.person, accepted.id, {
          expectedVersion: current.version,
          version: accepted.version,
        });
      }),
    ).rejects.toThrow('source evidence');
    expect(await tables()).toEqual(beforeRestore);
  });

  it('uses actual retained iGEM assertions, evaluator waits/values and rollback-only Values effects with no scientific leakage', async () => {
    const f = await dilutionDecisionFixture(db),
      before = await tables(),
      delivery: unknown[] = [];
    f.bus.subscribe(f.person.labId, (e) => delivery.push(e));
    const p = await prepareSopDilutionDecision(f, f.agent, f.input),
      preview = SopDilutionDecisionPreview.parse(p.preview);
    expect(preview.passage.text).toBe(f.quote);
    expect(preview.calculation).toMatchObject({
      before: { status: 'missing', waitsOn: ['culture_volume', 'final_volume'] },
      after: {
        status: 'calculated',
        final: { value: '5', unit: 'mL' },
        sample: { value: '0.5', unit: 'mL' },
        diluent: { value: '4.5', unit: 'mL' },
        recomposed: { value: '5', unit: 'mL' },
        factor: '10',
      },
    });
    expect(preview.acceptance).toMatchObject({
      status: 'resolved',
      by: 'applying_person',
      proposedBy: f.agent.actor,
    });
    expect(preview.confirmation.evidence['/variables/final_volume']?.by).toBe('applying_person');
    expect(preview.confirmation.evidence.variables?.by).toBe('applying_person');
    expect(preview.after.readiness.sections).toContainEqual(
      expect.objectContaining({ id: 'variables', state: 'confirmed' }),
    );
    expect(preview.after.readiness.missing).not.toContain('Values is not confirmed');
    expect(preview.confirmation.assumed).toContain('/variables/dilution_factor');
    expect(JSON.stringify(preview.after)).not.toContain('"acceptedBy":{"type":"user"');
    expect(preview.before.reads.map((r) => r.id)).toContain(f.document.id);
    expect(preview.before.reads.map((r) => r.id)).toContain(f.file.id);
    expect(await tables()).toEqual(before);
    expect(delivery).toEqual([]);
    await expect(
      f.registry.transaction(db, (tx) =>
        revalidateSopDilutionDecision(
          { ...f, db: tx },
          f.agent,
          p.id,
          p.decision?.previewIdentity.digest ?? '',
        ),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await f.service.get(f.person, f.target.id)).version).toBe(1);
    if (process.env.DILUTION_PREVIEW_OUT)
      await writeFile(
        process.env.DILUTION_PREVIEW_OUT,
        `${JSON.stringify({ selector: f.input, preview, decision: p.decision }, null, 2)}\n`,
        'utf8',
      );
  });

  it('preserves historical response/person, same meaning for a second person and one exact single-use authorization', async () => {
    const f = await dilutionDecisionFixture(db),
      userId = newId('usr');
    await db.insert(users).values({ id: userId, orgId: f.person.orgId, displayName: 'B' });
    const person = { ...f.person, actor: { type: 'user' as const, userId } };
    const prior = await f.run<{ version: number }>(f.person, 'sops.answer_question', {
      sop: f.target.id,
      expectedVersion: 1,
      question: f.input.question,
      action: { type: 'response', text: 'Recorded before acceptance' },
    });
    const p = await prepareSopDilutionDecision(f, f.person, {
      ...f.input,
      expectedVersion: prior.version,
    });
    await f.registry.transaction(db, async (tx) => {
      const r = await checked(f, p, tx, person);
      expect(r.prepared.decision.previewIdentity.digest).toBe(p.decision?.previewIdentity.digest);
      await expect(
        executeSopDilutionDecision({ ...f, db: tx }, { ...r.authorization }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(executeSopDilutionDecision(f, r.authorization)).rejects.toMatchObject({
        code: 'forbidden',
      });
      const out = await executeSopDilutionDecision({ ...f, db: tx }, r.authorization);
      const attributes = out.attributes as SopAttributes;
      expect(attributes.questions?.[0]?.responses[0]).toMatchObject({
        text: 'Recorded before acceptance',
        by: f.person.actor,
      });
      expect((p.preview as SopDilutionDecisionPreview).question.responses[0]?.by).toEqual(
        f.person.actor,
      );
      expect(attributes.questions?.[0]).toMatchObject({
        question: f.target.attributes.questions?.[0]?.question,
        stage: f.target.attributes.questions?.[0]?.stage,
        disposition: {
          status: 'resolved',
          proposedBy: f.person.actor,
          acceptedBy: person.actor,
          proposal: p.id,
        },
      });
      expect(attributes.variables[0]).toMatchObject({
        value: f.input.value,
        cite: [{ document: f.document.id, passage: f.input.passage, quote: f.quote }],
      });
      expect(attributes.steps).toEqual(f.target.attributes.steps);
      expect(attributes.source).toEqual(f.target.attributes.source);
      expect(attributes.variables.slice(1)).toEqual(f.target.attributes.variables.slice(1));
      expect(out).toMatchObject({
        status: 'draft',
        updatedBy: person.actor,
        origin: f.target.origin,
      });
      expect(out.reviews.variables).toMatchObject({
        confirmedBy: person.actor,
        values: { variables: attributes.variables },
      });
      expect(
        Object.fromEntries(Object.entries(out.reviews).filter(([id]) => id !== 'variables')),
      ).toEqual(
        Object.fromEntries(Object.entries(f.target.reviews).filter(([id]) => id !== 'variables')),
      );
      await expect(
        executeSopDilutionDecision({ ...f, db: tx }, r.authorization),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  it('allows unrelated edits, refreshes changed section meaning, requires a new click and rolls back late failure', async () => {
    const f = await dilutionDecisionFixture(db);
    let p = await prepareSopDilutionDecision(f, f.agent, f.input);
    let current = await f.service.update(f.agent, f.target.id, {
      expectedVersion: 1,
      attributes: { ...f.target.attributes, notes: 'Unrelated later note' },
    });
    await f.registry.transaction(db, async (tx) => {
      expect((await checked(f, p, tx)).prepared.input.expectedVersion).toBe(current.version);
    });
    current = await f.service.update(f.agent, current.id, {
      expectedVersion: current.version,
      attributes: {
        ...current.attributes,
        variables: (current.attributes.variables as SopAttributes['variables']).map((v) =>
          v.name === 'lb_volume' ? { ...v, label: 'Revised label' } : v,
        ),
      },
    });
    const old = p;
    await f.registry.transaction(db, async (tx) => {
      const r = await revalidateSopDilutionDecision(
        { ...f, db: tx },
        f.person,
        p.id,
        p.decision?.previewIdentity.digest ?? '',
      );
      expect(r.status).toBe('refreshed');
      p = r.proposal;
      expect(p.status).toBe('pending');
      expect(p.decision?.previewIdentity.digest).not.toBe(old.decision?.previewIdentity.digest);
      expect(
        (
          await revalidateSopDilutionDecision(
            { ...f, db: tx },
            f.person,
            p.id,
            old.decision?.previewIdentity.digest ?? '',
          )
        ).status,
      ).toBe('stale');
    });
    const before = await tables(),
      deliveries: unknown[] = [];
    f.bus.subscribe(f.person.labId, (e) => deliveries.push(e));
    let leaked: Parameters<typeof executeSopDilutionDecision>[1] | undefined;
    await expect(
      f.registry.transaction(db, async (tx) => {
        const r = await checked(f, p, tx);
        leaked = r.authorization;
        await executeSopDilutionDecision({ ...f, db: tx }, r.authorization);
        throw new Error('late failure');
      }),
    ).rejects.toThrow('late failure');
    expect(await tables()).toEqual(before);
    expect(deliveries).toEqual([]);
    await f.registry.transaction(db, async (tx) => {
      await expect(
        executeSopDilutionDecision({ ...f, db: tx }, leaked as never),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  it('retains A after document revision and same-file reparse, but refuses missing/corrupt/foreign evidence and wrong values', async () => {
    const f = await dilutionDecisionFixture(db),
      p = await prepareSopDilutionDecision(f, f.agent, f.input);
    await f.run(f.person, 'records.update', {
      id: f.document.id,
      expectedVersion: f.document.version,
      attributes: { ...f.document.attributes, version: 'B' },
      label: 'Edition B',
    });
    await f.reparse('Unrelated changed converted text');
    await f.registry.transaction(db, async (tx) => {
      expect((await checked(f, p, tx)).prepared.preview.passage.text).toBe(f.quote);
    });
    for (const failure of ['missing', 'corrupt'] as const) {
      f.fail(failure);
      await expect(f.registry.transaction(db, (tx) => checked(f, p, tx))).rejects.toThrow();
    }
    f.fail(undefined);
    await expect(
      prepareSopDilutionDecision(f, f.agent, { ...f.input, value: { value: '6', unit: 'mL' } }),
    ).rejects.toThrow('contradicts');
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
    await expect(
      prepareSopDilutionDecision(
        f,
        { orgId: other.orgId, labId: other.labId, actor: { type: 'user', userId: other.userId } },
        f.input,
      ),
    ).rejects.toThrow();
    if (f.source.parse.status !== 'parsed') throw new Error('Expected retained snapshot');
    await db.delete(librarySnapshots).where(eq(librarySnapshots.snapshot, f.source.parse.snapshot));
    await expect(f.registry.transaction(db, (tx) => checked(f, p, tx))).rejects.toThrow();
  });

  it('refuses populated values, conflicting factor/formulas/associations, mixed caller fields and ever-confirmed drafts', async () => {
    const f = await dilutionDecisionFixture(db);
    for (const extra of [
      { variable: 'final_volume' },
      { basis: {} },
      { affected: [] },
      { actor: f.person.actor },
      { action: { type: 'resolve' } },
    ])
      await expect(
        prepareSopDilutionDecision(f, f.agent, { ...f.input, ...extra }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    for (const attributes of [
      {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'final_volume' ? { ...v, value: { value: '5', unit: 'mL' } } : v,
        ),
      },
      {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'dilution_factor' ? { ...v, value: '20' } : v,
        ),
      },
      {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'culture_volume' ? { ...v, expression: 'final_volume * dilution_factor' } : v,
        ),
      },
      {
        ...f.target.attributes,
        steps: f.target.attributes.steps.map((s) => ({
          ...s,
          parameters: s.parameters?.map((p) =>
            p.name === 'final_volume' ? { ...p, variable: 'culture_volume' } : p,
          ),
        })),
      },
    ]) {
      await expect(
        f.registry.transaction(db, async (tx) => {
          const service = new RecordService(tx, f.kinds);
          const changed = await service.update(f.agent, f.target.id, {
            expectedVersion: 1,
            attributes,
          });
          await prepareSopDilutionDecision({ ...f, db: tx }, f.agent, {
            ...f.input,
            expectedVersion: changed.version,
          });
        }),
      ).rejects.toThrow();
      expect((await f.service.get(f.person, f.target.id)).version).toBe(1);
    }
    const p = await prepareSopDilutionDecision(f, f.agent, f.input);
    const before = await tables();
    const action = (p.preview as SopDilutionDecisionPreview).acceptance.action;
    const forged = {
      ...f.target.attributes,
      variables: f.target.attributes.variables.map((v) =>
        v.name === 'final_volume'
          ? { ...v, value: f.input.value, cite: f.target.attributes.steps[0]?.cite }
          : v,
      ),
      questions: f.target.attributes.questions?.map((q) => ({
        ...q,
        disposition: {
          status: 'resolved' as const,
          proposal: p.id,
          proposedBy: f.agent.actor,
          acceptedBy: f.person.actor,
          at: new Date().toISOString(),
          action,
          recheck: {
            version: 2,
            at: new Date().toISOString(),
            checks: [{ id: 'invented', passed: true as const }],
          },
        },
      })),
    };
    for (const ctx of [
      f.person,
      { ...f.agent, via: 'sops.answer_question', approvedBy: f.person.actor },
    ])
      await expect(
        f.service.update(ctx, f.target.id, { expectedVersion: 1, attributes: forged }),
      ).rejects.toThrow();
    const ordinary = await createProposal(db, f.agent, {
      operationId: 'records.update',
      input: { id: f.target.id, expectedVersion: 1, attributes: forged },
      preview: null,
    });
    const rejected = await f.registry.execute(f.person, 'proposals.approve', { id: ordinary.id });
    expect(rejected).toMatchObject({
      status: 'done',
      output: { status: 'failed', error: { code: 'forbidden' } },
    });
    expect((await tables()).records).toEqual(before.records);
    expect((await tables()).history).toEqual(before.history);
  });

  it('refuses direct/generic/approved/create/restore forgery, guards accepted method facts and permits only compatible downstream inputs', async () => {
    const f = await dilutionDecisionFixture(db),
      p = await prepareSopDilutionDecision(f, f.agent, f.input);
    let out = await f.registry.transaction(db, async (tx) =>
      executeSopDilutionDecision({ ...f, db: tx }, (await checked(f, p, tx)).authorization),
    );
    const accepted = out.attributes as SopAttributes;
    for (const ctx of [
      f.person,
      { ...f.agent, via: 'sops.answer_question', approvedBy: f.person.actor },
    ])
      await expect(
        f.service.create(ctx, { kind: 'sop', label: 'Forged acceptance', attributes: accepted }),
      ).rejects.toThrow();
    for (const attributes of [
      { ...accepted, questions: [] },
      { ...accepted, variables: accepted.variables.filter((v) => v.name !== 'final_volume') },
      {
        ...accepted,
        variables: accepted.variables.map((v) =>
          v.name === 'final_volume' ? { ...v, value: { value: '6', unit: 'mL' } } : v,
        ),
      },
      {
        ...accepted,
        steps: accepted.steps.map((s) => ({ ...s, text: 'Changed dilution instruction' })),
      },
      {
        ...accepted,
        questions: accepted.questions?.map((q) => ({ ...q, question: 'Different relationship' })),
      },
    ]) {
      await expect(
        f.service.update(f.person, out.id, { expectedVersion: out.version, attributes }),
      ).rejects.toThrow();
      await expect(
        f.run(f.person, 'records.update', { id: out.id, expectedVersion: out.version, attributes }),
      ).rejects.toThrow();
    }
    await expect(
      f.run(f.person, 'records.restore', { id: out.id, expectedVersion: out.version, version: 1 }),
    ).rejects.toThrow();
    out = await f.service.update(f.agent, out.id, {
      expectedVersion: out.version,
      attributes: { ...accepted, notes: 'Unrelated edit retained' },
    });
    out = await f.run(f.person, 'sops.answer_question', {
      sop: out.id,
      expectedVersion: out.version,
      question: f.input.question,
      action: { type: 'response', text: 'Observed note' },
    });
    await f.run(f.person, 'records.confirm', { id: out.id, expectedVersion: out.version });
    const pin = await f.service.get(f.person, out.id),
      before = await f.service.history(f.person, out.id);
    const campaign = await f.service.create(f.agent, {
      kind: 'campaign',
      label: 'Dilution trial',
      attributes: { goal: 'Calculate source-backed dilution', aims: [], stage: 'proposed' },
    });
    const experiment = await f.service.create(f.agent, {
      kind: 'experiment',
      label: 'Planned dilution',
      attributes: {
        campaign: campaign.id,
        question: 'Check the pinned source-backed calculation',
        stage: 'designing',
        protocol: [{ id: 'dilution', sop: { id: pin.id, version: pin.version } }],
      },
    });
    expect(experiment.attributes.protocol).toEqual([
      { id: 'dilution', sop: { id: pin.id, version: pin.version } },
    ]);
    const experimentCalculation = await f.run<{
      ready: boolean;
      parts: { variables: unknown[] }[];
    }>(f.person, 'experiments.calculate', { id: experiment.id });
    expect(experimentCalculation.ready).toBe(true);
    expect(experimentCalculation.parts[0]?.variables).toContainEqual(
      expect.objectContaining({ name: 'lb_volume', quantity: { value: '4.5', unit: 'mL' } }),
    );
    const calc = await f.run<{ variables: { name: string; value?: unknown }[] }>(
      f.person,
      'sops.calculate',
      { sop: pin.id, version: pin.version },
    );
    expect(calc.variables).toContainEqual(
      expect.objectContaining({ name: 'culture_volume', quantity: { value: '0.5', unit: 'mL' } }),
    );
    await expect(
      f.run(f.person, 'sops.calculate', {
        sop: pin.id,
        version: pin.version,
        inputs: [{ name: 'final_volume', value: { value: '6', unit: 'mL' } }],
      }),
    ).rejects.toThrow('override');
    await expect(
      f.service.update(f.agent, experiment.id, {
        expectedVersion: experiment.version,
        attributes: {
          ...experiment.attributes,
          protocol: [
            {
              id: 'dilution',
              sop: { id: pin.id, version: pin.version },
              inputs: [{ name: 'dilution_factor', value: '20' }],
            },
          ],
        },
      }),
    ).rejects.toThrow('override');
    await f.run(f.person, 'sops.calculate', {
      sop: pin.id,
      version: pin.version,
      inputs: [{ name: 'final_volume', value: { value: '5000', unit: 'uL' } }],
    });
    expect(await f.service.history(f.person, pin.id)).toEqual(before);
    await db.update(records).set({ status: 'draft' }).where(eq(records.id, pin.id));
    await expect(
      prepareSopDilutionDecision(f, f.person, { ...f.input, expectedVersion: pin.version }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

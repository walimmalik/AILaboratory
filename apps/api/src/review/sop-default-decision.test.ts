import { newId } from '@ailab/domain';
import {
  ScientificDecisionMetadata,
  type SopAttributes,
  SopDefaultDecisionPreview,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activity, proposals, records, recordVersions } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { listProposals } from '../operations/proposal-store.ts';
import { sop } from '../sops/kinds.ts';
import {
  lockedSopDefaultPreview,
  prepareSopDefaultDecision,
  revalidateSopDefaultDecision,
  sopDefaultMeaningDigest,
} from './sop-default-decision.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());
const path = '/variables/well_volume';

describe('staged SOP volume-default decision producer', () => {
  it('stores exact approved-execution scope without scientific/history/activity or simulated approval leakage', async () => {
    const f = await defaultDecisionFixture(db);
    const beforeRecords = await db.select().from(records);
    const beforeHistory = await db.select().from(recordVersions);
    const beforeActivity = await db.select().from(activity);
    const deliveries: unknown[] = [];
    f.bus.subscribe(f.person.labId, (entry) => deliveries.push(entry));
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    const preview = SopDefaultDecisionPreview.parse(proposal.preview);
    expect(proposal).toMatchObject({
      status: 'pending',
      operationId: 'records.update',
      proposedBy: f.agent.actor,
      decision: {
        origin: f.agent.origin,
        scope: { type: 'operation_change' },
        sources: [],
        writes: [{ id: f.target.id, version: f.target.version, paths: [`${path}/value`] }],
      },
    });
    expect(ScientificDecisionMetadata.safeParse(proposal.decision).success).toBe(true);
    expect(preview.variable).toMatchObject({
      before: { value: '100', unit: 'uL' },
      after: { value: '80', unit: 'uL' },
      path: `${path}/value`,
    });
    expect(preview.changes).toEqual([
      {
        path: `${path}/value`,
        change: 'changed',
        before: { value: '100', unit: 'uL' },
        after: f.edit.value,
      },
    ]);
    expect(preview.confirmation).toMatchObject({
      by: 'applying_person',
      section: {
        id: 'variables',
        title: 'Values',
        before: { variables: f.target.attributes.variables },
        after: { variables: expect.any(Array) },
      },
      assumed: expect.arrayContaining([path, '/variables/wash_volume', '/variables/concentration']),
    });
    expect(preview.evidence).toMatchObject({
      before: { source: 'datasheet', reference: 'Unchecked draft note' },
      after: { source: 'assumed', by: f.agent.actor },
    });
    expect(preview.evidence.after.reference).toBeUndefined();
    expect(preview.before.readiness.checks).toEqual(
      await f.service.readiness(f.agent, f.target.id).then((r) => r.checks),
    );
    expect(preview.after.readiness.sections.find((s) => s.id === 'variables')?.state).toBe(
      'confirmed',
    );
    expect(preview.after.readiness.checks.find((c) => c.id === 'questions_answered')).toMatchObject(
      { passed: false },
    );
    expect(preview).toMatchObject({
      remainingQuestions: 1,
      resultingStatus: 'draft',
      finalConfirmation: 'separate',
      scientificValidation: 'not_claimed',
    });
    expect(proposal.decision?.reads.map((r) => r.id).sort()).toEqual(
      [f.product.id, f.lot.id, f.document.id].sort(),
    );
    expect(preview.before.target.version).toBe(f.target.version);
    expect(preview.after.target.version).toBe(f.target.version + 1);
    expect(JSON.stringify(preview)).not.toContain('confirmedBy');
    expect(JSON.stringify(preview)).not.toContain('confirmedAt');
    expect(await db.select().from(records)).toEqual(beforeRecords);
    expect(await db.select().from(recordVersions)).toEqual(beforeHistory);
    expect(await db.select().from(activity)).toEqual(beforeActivity);
    expect(deliveries).toEqual([]);
    await expect(
      f.registry.execute(f.agent, 'review.prepare_decision', f.edit),
    ).rejects.toMatchObject({ code: 'unknown_operation' });
  });

  it('uses an honest applying-person placeholder for human changed-value evidence and explicit unknown origin', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.person, f.edit);
    const preview = SopDefaultDecisionPreview.parse(proposal.preview);
    expect(preview.evidence.after).toEqual({ source: 'person', by: 'applying_person' });
    expect(preview.confirmation.evidence[path]).toEqual(preview.evidence.after);
    expect(
      preview.after.readiness.sections
        .find((s) => s.id === 'variables')
        ?.fields[0]?.items?.find((i) => i.path === path)?.evidence,
    ).toEqual(preview.evidence.after);
    expect(proposal.decision?.origin).toEqual({ type: 'unknown' });
    expect(proposal.proposedBy).toEqual(f.person.actor);
  });

  it('refuses unsupported input claims, stale versions and out-of-scope defaults without proposals', async () => {
    const f = await defaultDecisionFixture(db);
    for (const input of [
      { ...f.edit, origin: f.agent.origin },
      { ...f.edit, operationId: 'records.update' },
      { ...f.edit, value: { ...f.edit.value, source: 'validated' } },
      { ...f.edit, value: { value: '0', unit: 'uL' } },
      { ...f.edit, value: { value: '-1', unit: 'uL' } },
      { ...f.edit, value: { value: '0.08', unit: 'mL' } },
      { ...f.edit, value: { value: '80', unit: 'mystery' } },
      { ...f.edit, value: { value: '100.0', unit: 'uL' } },
      { ...f.edit, variable: 'added' },
      { ...f.edit, variable: 'concentration' },
      { ...f.edit, expectedVersion: f.target.version - 1 },
    ])
      await expect(prepareSopDefaultDecision(f, f.agent, input)).rejects.toMatchObject({
        code: expect.stringMatching(/invalid_input|version_conflict/),
      });
    const selected = f.target.attributes.variables[0];
    if (!selected) throw new Error('Expected default');
    for (const variable of [
      { ...selected, kind: 'input' as const },
      { ...selected, kind: 'computed' as const, expression: '2 uL' },
      { ...selected, value: [{ value: '100', unit: 'uL' }] },
      { ...selected, value: '100' },
      { ...selected, min: { value: '50', unit: 'uL' } },
      { ...selected, max: { value: '200', unit: 'uL' } },
      { ...selected, cite: [{ document: f.document.id, quote: '100 uL' }] },
      { ...selected, value: { value: '100', unit: 'min' } },
      { ...selected, value: { value: '-100', unit: 'uL' } },
    ]) {
      const attributes: SopAttributes = {
        ...f.target.attributes,
        variables: [variable, ...f.target.attributes.variables.slice(1)],
      };
      const target = await f.draft(attributes);
      await expect(
        prepareSopDefaultDecision(f, f.agent, {
          ...f.edit,
          sop: target.id,
          expectedVersion: target.version,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    const blocked = await f.draft({
      ...f.target.attributes,
      questions: [
        {
          id: 'default_question',
          about: { variable: 'well_volume' },
          question: 'Which volume?',
          stage: { stage: 'method', reason: 'Unclear' },
          responses: [],
          disposition: { status: 'open' },
        },
      ],
    });
    await expect(
      prepareSopDefaultDecision(f, f.agent, {
        ...f.edit,
        sop: blocked.id,
        expectedVersion: blocked.version,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('open method question'),
    });
    expect(await listProposals(db, f.person)).toEqual([]);
    expect(await f.service.get(f.agent, f.target.id)).toEqual(f.target);
  });

  it('refuses scoped foreign targets and accepted/formerly-confirmed SOPs', async () => {
    const f = await defaultDecisionFixture(db);
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
    const foreign = {
      actor: { type: 'user' as const, userId: other.userId },
      orgId: other.orgId,
      labId: other.labId,
    };
    await expect(prepareSopDefaultDecision(f, foreign, f.edit)).rejects.toMatchObject({
      code: 'not_found',
    });
    const accepted = await f.service.create(f.person, {
      kind: 'sop',
      label: 'Accepted',
      status: 'active',
      attributes: {
        materials: [],
        variables: [f.target.attributes.variables[0]],
        steps: [{ id: 'coat', action: 'manual', text: 'Coat.' }],
      },
    });
    await expect(
      prepareSopDefaultDecision(f, f.agent, {
        ...f.edit,
        sop: accepted.id,
        expectedVersion: accepted.version,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const rollback = new Error('Restore historical fixture');
    await expect(
      f.registry.transaction(db, async (tx) => {
        await tx.update(records).set({ status: 'draft' }).where(eq(records.id, accepted.id));
        await expect(
          prepareSopDefaultDecision({ ...f, db: tx }, f.agent, {
            ...f.edit,
            sop: accepted.id,
            expectedVersion: accepted.version,
          }),
        ).rejects.toMatchObject({
          code: 'invalid_state',
          message: expect.stringContaining('confirmed method'),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await listProposals(db, f.person)).toEqual([]);
  });

  it('refreshes only versions when meaning is unchanged and rebuilds from current attributes without overwriting unrelated edits', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    const edited = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Unrelated latest notes' },
    });
    const product = await f.service.update(f.agent, f.product.id, {
      expectedVersion: f.product.version,
      label: 'Same concentration, newer record version',
    });
    const applying = {
      ...f.person,
      origin: {
        type: 'user_message' as const,
        conversation: newId('cnv'),
        message: 'Unrelated applying request',
      },
    };
    await f.registry.transaction(db, async (tx) => {
      const result = await revalidateSopDefaultDecision(
        { ...f, db: tx },
        applying,
        proposal.id,
        proposal.decision?.previewIdentity.digest ?? '',
      );
      expect(result.status).toBe('unchanged');
      if (result.status !== 'unchanged') throw new Error('Expected same meaning');
      expect(result.prepared.input.attributes).toMatchObject({
        notes: 'Unrelated latest notes',
        variables: expect.arrayContaining([
          expect.objectContaining({ name: 'well_volume', value: f.edit.value }),
        ]),
      });
      expect(result.prepared.decision.previewIdentity.digest).toBe(
        proposal.decision?.previewIdentity.digest,
      );
      expect(result.prepared.decision.writes[0]?.version).toBe(edited.version);
      expect(result.prepared.decision.reads.find((r) => r.id === product.id)?.version).toBe(
        product.version,
      );
      expect(result.executionContext).toMatchObject({
        actor: f.agent.actor,
        approvedBy: f.person.actor,
        origin: f.agent.origin,
      });
      expect(result.proposal.status).toBe('pending');
    });
    expect((await f.service.get(f.agent, f.target.id)).attributes).toEqual(edited.attributes);
    expect((await listProposals(db, f.person))[0]?.receipt).toBeUndefined();
  });

  it('refreshes the same pending proposal for changed whole-section meaning and requires a new token', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'wash_volume' ? { ...v, value: { value: '250', unit: 'uL' } } : v,
        ),
      },
    });
    const oldToken = proposal.decision?.previewIdentity.digest ?? '';
    const refreshed = await f.registry.transaction(db, (tx) =>
      revalidateSopDefaultDecision({ ...f, db: tx }, f.person, proposal.id, oldToken),
    );
    expect(refreshed.status).toBe('refreshed');
    expect(refreshed.proposal.id).toBe(proposal.id);
    expect(refreshed.proposal.status).toBe('pending');
    expect(refreshed.proposal.decision?.previewIdentity.digest).not.toBe(oldToken);
    const stale = await f.registry.transaction(db, (tx) =>
      revalidateSopDefaultDecision({ ...f, db: tx }, f.person, proposal.id, oldToken),
    );
    expect(stale.status).toBe('stale');
    const next = await f.registry.transaction(db, (tx) =>
      revalidateSopDefaultDecision(
        { ...f, db: tx },
        f.person,
        proposal.id,
        refreshed.proposal.decision?.previewIdentity.digest ?? '',
      ),
    );
    expect(next.status).toBe('unchanged');
    const current = await f.service.get(f.person, f.target.id);
    expect((current.attributes.variables as SopAttributes['variables'])[0]?.value).toEqual({
      value: '100',
      unit: 'uL',
    });
    expect(await listProposals(db, f.person)).toHaveLength(1);
  });

  it('refreshes when an actual indirect dependency changes a server check consequence', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    await f.service.update(f.agent, f.product.id, {
      expectedVersion: f.product.version,
      attributes: { ...f.product.attributes, lotFields: [] },
    });
    const result = await f.registry.transaction(db, (tx) =>
      revalidateSopDefaultDecision(
        { ...f, db: tx },
        f.person,
        proposal.id,
        proposal.decision?.previewIdentity.digest ?? '',
      ),
    );
    expect(result.status).toBe('refreshed');
    const preview = SopDefaultDecisionPreview.parse(result.proposal.preview);
    expect(
      preview.before.readiness.checks.find((c) => c.id === 'record_values_readable'),
    ).toMatchObject({ passed: false });
    expect(
      preview.after.readiness.checks.find((c) => c.id === 'record_values_readable'),
    ).toMatchObject({ passed: false });
    expect((await f.service.get(f.person, f.target.id)).version).toBe(f.target.version);
  });

  it('rejects incomplete capture and transaction/actor misuse; generic approval stays unavailable', async () => {
    const missing = newId('prd');
    const f = await defaultDecisionFixture(db, {
      ...sop,
      related: async (a, ctx) => {
        if (!sop.related) throw new Error('Missing SOP rules');
        const result = await sop.related(a, ctx);
        if (ctx.current) await ctx.get(missing);
        return result;
      },
    });
    await expect(prepareSopDefaultDecision(f, f.agent, f.edit)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await listProposals(db, f.person)).toEqual([]);
    await expect(lockedSopDefaultPreview(f, f.agent, f.edit)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    await expect(
      revalidateSopDefaultDecision(f, f.person, newId('prp'), 'a'.repeat(64)),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('retains ordinary approval refusal and lets caller rollback a refreshed pending preview', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    await expect(
      f.registry.execute(f.person, 'proposals.approve', { id: proposal.id }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const snapshot = (await listProposals(db, f.person))[0];
    await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'well_volume' ? { ...v, value: { value: '90', unit: 'uL' } } : v,
        ),
      },
    });
    const rollback = new Error('Later consumer failed');
    await expect(
      f.registry.transaction(db, async (tx) => {
        await expect(
          revalidateSopDefaultDecision(
            { ...f, db: tx },
            f.agent,
            proposal.id,
            proposal.decision?.previewIdentity.digest ?? '',
          ),
        ).rejects.toMatchObject({ code: 'forbidden' });
        const refreshed = await revalidateSopDefaultDecision(
          { ...f, db: tx },
          f.person,
          proposal.id,
          proposal.decision?.previewIdentity.digest ?? '',
        );
        expect(refreshed.status).toBe('refreshed');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect((await listProposals(db, f.person))[0]).toEqual(snapshot);
  });

  it('ignores only mechanical versions/time and keyed-variable display ordering in decision meaning', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    const preview = SopDefaultDecisionPreview.parse(proposal.preview);
    const changed = structuredClone(preview);
    changed.target.version += 1;
    changed.before.target.version += 1;
    changed.after.target.version += 1;
    changed.before.readiness.version += 1;
    changed.after.readiness.version += 1;
    for (const read of [...changed.before.reads, ...changed.after.reads]) read.version += 1;
    (changed.confirmation.section.before.variables as SopAttributes['variables']).reverse();
    (changed.confirmation.section.after.variables as SopAttributes['variables']).reverse();
    expect(sopDefaultMeaningDigest(changed)).toBe(sopDefaultMeaningDigest(preview));
    changed.confirmation.evidence['/variables/wash_volume'] = {
      source: 'datasheet',
      by: f.agent.actor,
      reference: 'New unchecked basis',
    };
    expect(sopDefaultMeaningDigest(changed)).not.toBe(sopDefaultMeaningDigest(preview));
  });

  it('refuses contradictory persisted facts rather than treating an arbitrary decision as this supported edit', async () => {
    const f = await defaultDecisionFixture(db);
    const proposal = await prepareSopDefaultDecision(f, f.agent, f.edit);
    const preview = SopDefaultDecisionPreview.parse(proposal.preview);
    preview.variable.before.value = '90';
    const rollback = new Error('Restore contradictory fixture');
    await expect(
      f.registry.transaction(db, async (tx) => {
        await tx.update(proposals).set({ preview }).where(eq(proposals.id, proposal.id));
        await expect(
          revalidateSopDefaultDecision(
            { ...f, db: tx },
            f.person,
            proposal.id,
            proposal.decision?.previewIdentity.digest ?? '',
          ),
        ).rejects.toMatchObject({
          code: 'invalid_input',
          message: expect.stringContaining('inconsistent'),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect((await listProposals(db, f.person))[0]).toEqual(proposal);
  });
});

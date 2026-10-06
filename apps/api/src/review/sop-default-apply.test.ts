import { newId } from '@ailab/domain';
import {
  type ActivityEntry,
  type Conversation,
  proposalsApprove,
  type SopAttributes,
} from '@ailab/schema';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Assistant } from '../assistant/assistant.ts';
import type { ChatModel } from '../assistant/model.ts';
import { createConversation } from '../assistant/store.ts';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import {
  activity,
  conversations,
  proposals,
  records,
  recordVersions,
  users,
} from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { createRegistry } from '../operations/index.ts';
import type { RecordContext } from '../records/service.ts';
import { sop } from '../sops/kinds.ts';
import { defaultDecisionFixture } from './test-sop-default.ts';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});
type Fixture = Awaited<ReturnType<typeof defaultDecisionFixture>>;
async function prepare(f: Fixture, ctx = f.agent) {
  const result = await f.registry.execute(ctx, 'review.prepare_decision', f.edit);
  if (result.status !== 'proposed') throw new Error('Preparation must return a proposed result');
  return result.proposal;
}
async function apply(f: Fixture, id: string, expectedPreview: string, ctx = f.person) {
  const result = await f.registry.execute(ctx, 'proposals.approve', { id, expectedPreview });
  if (result.status !== 'done') throw new Error('Expected approval result');
  return proposalsApprove.output.parse(result.output);
}

describe('paired SOP default preparation and Apply', () => {
  it('returns proposed for people and agents, logs truthful preparation and refuses nesting that could bypass pause', async () => {
    const f = await defaultDecisionFixture(db);
    const before = await db.select().from(records);
    const history = await db.select().from(recordVersions);
    const ledgerBefore = await db.select().from(activity);
    const agentProposal = await prepare(f);
    const humanProposal = await prepare(f, f.person);
    expect(agentProposal.decision?.origin).toEqual(f.agent.origin);
    expect(humanProposal.proposedBy).toEqual(f.person.actor);
    const added = (await db.select().from(activity)).slice(ledgerBefore.length);
    expect(added).toHaveLength(2);
    expect(
      added.map((e) => ({ outcome: e.outcome, proposalId: e.proposalId, recordIds: e.recordIds })),
    ).toEqual([
      { outcome: 'proposed', proposalId: agentProposal.id, recordIds: [f.target.id] },
      { outcome: 'proposed', proposalId: humanProposal.id, recordIds: [f.target.id] },
    ]);
    await expect(
      f.registry.execute(f.agent, 'changes.apply', {
        steps: [{ operation: 'review.prepare_decision', input: f.edit }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.select().from(records)).toEqual(before);
    expect(await db.select().from(recordVersions)).toEqual(history);
    expect(await db.select().from(proposals)).toHaveLength(2);
  });

  it('refuses invalid public authority, unsupported edits, missing token, agents and foreign labs', async () => {
    const f = await defaultDecisionFixture(db);
    for (const input of [
      { ...f.edit, origin: f.agent.origin },
      { ...f.edit, operation: 'records.update' },
      { ...f.edit, value: { value: '0', unit: 'uL' } },
      { ...f.edit, variable: 'concentration' },
    ])
      await expect(
        f.registry.execute(f.agent, 'review.prepare_decision', input),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    const p = await prepare(f);
    await expect(
      f.registry.execute(f.person, 'proposals.approve', { id: p.id }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      apply(f, p.id, p.decision?.previewIdentity.digest ?? '', f.agent),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
    const foreign: RecordContext = {
      actor: { type: 'user', userId: other.userId },
      orgId: other.orgId,
      labId: other.labId,
    };
    await expect(prepare(f, foreign)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      apply(f, p.id, p.decision?.previewIdentity.digest ?? '', foreign),
    ).rejects.toMatchObject({ code: 'not_found' });
    if (!p.decision) throw new Error('Expected prepared decision metadata');
    await db
      .update(proposals)
      .set({
        decision: {
          ...p.decision,
          scope: {
            type: 'confirmation_scope',
            records: [{ id: f.target.id, version: f.target.version, kind: 'sop' }],
          },
        },
      })
      .where(eq(proposals.id, p.id));
    await expect(apply(f, p.id, p.decision?.previewIdentity.digest ?? '')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect((await db.select().from(proposals))[0]?.status).toBe('pending');
  });

  it('applies only the rebuilt default and disclosed review effects, keeping draft, source and questions', async () => {
    const f = await defaultDecisionFixture(db);
    const p = await prepare(f);
    const applying = {
      ...f.person,
      origin: {
        type: 'user_message' as const,
        conversation: newId('cnv'),
        message: 'Unrelated approval request',
      },
    };
    const result = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '', applying);
    expect(result).toMatchObject({
      status: 'approved',
      proposedBy: f.agent.actor,
      decidedBy: f.person.actor,
      decision: { origin: f.agent.origin },
      receipt: { recordIds: [f.target.id] },
    });
    expect(result.previewStatus).toBeUndefined();
    const current = await f.service.get(f.person, f.target.id);
    expect(current.status).toBe('draft');
    expect(current.attributes).toEqual({
      ...f.target.attributes,
      variables: f.target.attributes.variables.map((v) =>
        v.name === 'well_volume' ? { ...v, value: f.edit.value } : v,
      ),
    });
    expect(current.updatedBy).toEqual(f.agent.actor);
    expect(current.evidence['/variables/well_volume']).toMatchObject({
      source: 'assumed',
      by: f.agent.actor,
    });
    expect(current.reviews.variables).toMatchObject({ confirmedBy: f.person.actor });
    expect(current.evidence['/variables/wash_volume']).toEqual(
      f.target.evidence['/variables/wash_volume'],
    );
    expect(
      (await f.service.readiness(f.person, current.id)).checks.find(
        (c) => c.id === 'questions_answered',
      ),
    ).toMatchObject({ passed: false });
    expect(result.receipt?.output).toEqual(current);
  });

  it('applies as the actual person after human preparation and preserves unchanged historical authors', async () => {
    const f = await defaultDecisionFixture(db);
    const target = await f.service.update(f.person, f.target.id, {
      expectedVersion: f.target.version,
      evidence: { '/variables/wash_volume': { source: 'measured' } },
    });
    f.edit.expectedVersion = target.version;
    const p = await prepare(f, f.person);
    const id = newId('usr');
    await db.insert(users).values({ id, orgId: f.person.orgId, displayName: 'Sam' });
    const applying = { ...f.person, actor: { type: 'user' as const, userId: id } };
    const approved = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '', applying);
    expect(approved.status).toBe('approved');
    const current = await f.service.get(f.person, target.id);
    expect(current.updatedBy).toEqual(applying.actor);
    expect(current.evidence.variables).toMatchObject({ source: 'person', by: applying.actor });
    expect(current.evidence['/variables/well_volume']).toMatchObject({
      source: 'person',
      by: applying.actor,
    });
    expect(current.evidence['/variables/wash_volume']).toEqual(
      target.evidence['/variables/wash_volume'],
    );
    expect(current.reviews.variables).toMatchObject({ confirmedBy: applying.actor });
    expect(approved.proposedBy).toEqual(f.person.actor);
  });

  it('refreshes mechanical versions and applies on the same click without overwriting unrelated edits', async () => {
    const f = await defaultDecisionFixture(db);
    const p = await prepare(f);
    const edited = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Keep this latest note' },
    });
    await f.service.update(f.agent, f.product.id, {
      expectedVersion: f.product.version,
      label: 'New label, identical check facts',
    });
    const result = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '');
    expect(result.status).toBe('approved');
    expect(result.decision?.previewIdentity.digest).toBe(p.decision?.previewIdentity.digest);
    expect(result.decision?.writes[0]?.version).toBe(edited.version);
    expect((await f.service.get(f.person, f.target.id)).attributes.notes).toBe(
      'Keep this latest note',
    );
  });

  it('persists changed section meaning as pending, rejects the old token and requires a new click', async () => {
    const f = await defaultDecisionFixture(db);
    const p = await prepare(f);
    const edited = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'wash_volume' ? { ...v, value: { value: '250', unit: 'uL' } } : v,
        ),
      },
    });
    const token = p.decision?.previewIdentity.digest ?? '';
    const first = await apply(f, p.id, token);
    expect(first).toMatchObject({ id: p.id, status: 'pending', previewStatus: 'refreshed' });
    expect(first.decision?.previewIdentity.digest).not.toBe(token);
    expect(await f.service.get(f.person, f.target.id)).toEqual(edited);
    const oldTab = await apply(f, p.id, token);
    expect(oldTab).toMatchObject({
      status: 'pending',
      previewStatus: 'stale',
      decision: first.decision,
    });
    expect(
      (await db.select().from(activity))
        .filter((e) => e.operationId === 'proposals.approve')
        .map((e) => e.outcome),
    ).toEqual(['proposed', 'proposed']);
    const result = await apply(f, p.id, first.decision?.previewIdentity.digest ?? '');
    expect(result.status).toBe('approved');
    const current = await f.service.get(f.person, f.target.id);
    expect(
      (current.attributes.variables as SopAttributes['variables']).map((v) => v.value),
    ).toEqual([f.edit.value, { value: '250', unit: 'uL' }, { value: '2', unit: 'ug/mL' }]);
  });

  it('refuses Apply while its assistant is running and refuses a newly ineligible cited default', async () => {
    const f = await defaultDecisionFixture(db);
    const conversation = await createConversation(db, f.person, {
      title: 'Decision',
      agentName: 'Test',
      provider: 'test',
      model: 'test',
    });
    if (f.agent.actor.type !== 'agent') throw new Error('Expected agent');
    const p = await prepare(f, {
      ...f.agent,
      actor: { ...f.agent.actor, sessionRef: conversation.id },
    });
    await db
      .update(conversations)
      .set({ status: 'running' })
      .where(eq(conversations.id, conversation.id));
    await expect(apply(f, p.id, p.decision?.previewIdentity.digest ?? '')).rejects.toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('still working'),
    });
    await db
      .update(conversations)
      .set({ status: 'idle' })
      .where(eq(conversations.id, conversation.id));
    const current = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'well_volume'
            ? { ...v, cite: [{ document: f.document.id, quote: 'Source volume' }] }
            : v,
        ),
      },
    });
    await expect(apply(f, p.id, p.decision?.previewIdentity.digest ?? '')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await f.service.get(f.person, f.target.id)).toEqual(current);
    expect((await db.select().from(proposals))[0]?.status).toBe('pending');
  });

  it('rolls back scientific writes, receipts and success delivery after late proposal persistence failure', async () => {
    const f = await defaultDecisionFixture(db);
    const p = await prepare(f);
    const before = await db.select().from(records);
    const history = await db.select().from(recordVersions);
    const ledgerBefore = await db.select().from(activity);
    const live: ActivityEntry[] = [];
    f.bus.subscribe(f.person.labId, (entry) => live.push(entry));
    await db.execute(
      sql`CREATE FUNCTION refuse_decision_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'approved' THEN RAISE EXCEPTION 'Receipt storage unavailable'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER refuse_decision_receipt BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION refuse_decision_receipt()`,
    );
    await expect(apply(f, p.id, p.decision?.previewIdentity.digest ?? '')).rejects.toThrow();
    expect(await db.select().from(records)).toEqual(before);
    expect(await db.select().from(recordVersions)).toEqual(history);
    expect(live.map((e) => e.outcome)).toEqual(['failed']);
    expect(
      (await db.select().from(activity)).slice(ledgerBefore.length).map((e) => e.outcome),
    ).toEqual(['failed']);
    expect((await db.select().from(proposals))[0]).toMatchObject({
      status: 'pending',
      receipt: null,
      decision: p.decision,
    });
  });

  it('recovers one durable result on double click, delivery failure and retry after restart/later edits', async () => {
    const f = await defaultDecisionFixture(db);
    const p = await prepare(f);
    const token = p.decision?.previewIdentity.digest ?? '';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.spyOn(f.bus, 'publish').mockImplementation(() => {
      throw new Error('Delivery lost');
    });
    const [first, second] = await Promise.all([apply(f, p.id, token), apply(f, p.id, token)]);
    expect(first.status).toBe('approved');
    expect(second).toEqual(first);
    expect(log).toHaveBeenCalled();
    publish.mockRestore();
    const current = await f.service.get(f.person, f.target.id);
    expect(current.version).toBe(f.target.version + 1);
    await f.service.update(f.person, current.id, {
      expectedVersion: current.version,
      attributes: { ...current.attributes, notes: 'Later note' },
    });
    f.registry = createRegistry(db, f.kinds, f.bus);
    const delivered = vi.fn();
    f.bus.subscribe(f.person.labId, delivered);
    expect(await apply(f, p.id, token)).toEqual(first);
    expect(delivered).not.toHaveBeenCalled();
    expect(
      (await db.select().from(activity)).filter(
        (e) => e.operationId === 'proposals.approve' && e.outcome === 'approved',
      ),
    ).toHaveLength(1);
    expect((await f.service.get(f.person, current.id)).attributes.notes).toBe('Later note');
  });

  it('really prepares through the assistant then pauses and skips the following mutation', async () => {
    let edit: Fixture['edit'];
    const complete = vi.fn<ChatModel['complete']>(async () => ({
      text: 'Prepared for review.',
      stop: 'tool_use',
      toolCalls: [
        {
          id: 'prepare',
          name: 'run_operation',
          input: { operation: 'review.prepare_decision', input: edit },
        },
        {
          id: 'later',
          name: 'records_update',
          input: { id: edit.sop, expectedVersion: edit.expectedVersion, label: 'Must not run' },
        },
      ],
    }));
    const assistant = new Assistant({
      model: { provider: 'test', model: 'test', complete },
      agentName: 'Test assistant',
    });
    const f = await defaultDecisionFixture(db, sop, assistant);
    edit = f.edit;
    const ask = await f.registry.execute(f.person, 'assistant.ask', {
      message: 'Prepare volume 80 uL for my review',
    });
    if (ask.status !== 'done') throw new Error('Expected conversation');
    const id = (ask.output as { id: string }).id;
    await assistant.wait(id);
    const got = await f.registry.execute(f.person, 'assistant.get_conversation', { id });
    if (got.status !== 'done') throw new Error('Expected conversation read');
    const conversation = got.output as Conversation;
    expect(conversation.status).toBe('idle');
    expect(complete).toHaveBeenCalledTimes(1);
    const tool = conversation.messages.find((m) => m.role === 'tool' && m.toolCallId === 'prepare');
    expect(tool).toMatchObject({
      outcome: 'proposed',
      result: {
        status: 'proposed',
        proposal: { operationId: 'records.update', status: 'pending' },
      },
    });
    expect(
      conversation.messages.find((m) => m.role === 'tool' && m.toolCallId === 'later'),
    ).toMatchObject({ outcome: 'failed', error: { code: 'invalid_state' } });
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: expect.stringContaining('ready for your review'),
    });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    const root = conversation.messages.find((m) => m.role === 'user');
    if (tool?.role !== 'tool' || root?.role !== 'user') throw new Error('Expected stored messages');
    expect((await db.select().from(proposals))[0]?.decision?.origin).toEqual(root.origin);
  });
});

import { newId } from '@ailab/domain';
import {
  type ActivityEntry,
  type Conversation,
  proposalsApprove,
  type RecordEnvelope,
  type SopAttributes,
  SopInputDecisionPreview,
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
import { inputDecisionFixture } from './test-sop-input.ts';

let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});
type Fixture = Awaited<ReturnType<typeof inputDecisionFixture>>;
async function prepare(f: Fixture, ctx = f.agent) {
  const result = await f.registry.execute(ctx, 'review.prepare_decision', f.input);
  if (result.status !== 'proposed') throw new Error('Expected proposed result');
  return result.proposal;
}
async function apply(f: Fixture, id: string, expectedPreview: string, ctx = f.person) {
  const result = await f.registry.execute(ctx, 'proposals.approve', { id, expectedPreview });
  if (result.status !== 'done') throw new Error('Expected approval response');
  return proposalsApprove.output.parse(result.output);
}

describe('paired existing experiment-input preparation and Apply', () => {
  it('returns proposed for people/agents, records truthful activity and refuses a change-set pause bypass', async () => {
    const f = await inputDecisionFixture(db);
    const before = await db.select().from(records),
      history = await db.select().from(recordVersions),
      ledger = await db.select().from(activity);
    const a = await prepare(f),
      b = await prepare(f, f.person);
    expect(a.decision?.origin).toEqual(f.agent.origin);
    expect(b.proposedBy).toEqual(f.person.actor);
    expect(SopInputDecisionPreview.parse(a.preview).acceptance.by).toBe('applying_person');
    expect(
      (await db.select().from(activity))
        .slice(ledger.length)
        .map((e) => ({ outcome: e.outcome, id: e.proposalId, records: e.recordIds })),
    ).toEqual([
      { outcome: 'proposed', id: a.id, records: [f.target.id] },
      { outcome: 'proposed', id: b.id, records: [f.target.id] },
    ]);
    for (const ctx of [f.agent, f.person])
      await expect(
        f.registry.execute(ctx, 'changes.apply', {
          steps: [{ operation: 'review.prepare_decision', input: f.input }],
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.select().from(records)).toEqual(before);
    expect(await db.select().from(recordVersions)).toEqual(history);
    expect(await db.select().from(proposals)).toHaveLength(2);
  });

  it('refuses mixed/caller authority, unsupported scientific scope, missing token, agents and cross-lab access', async () => {
    const f = await inputDecisionFixture(db);
    for (const extra of [
      { variable: 'well_volume', value: { value: '80', unit: 'uL' } },
      { origin: f.agent.origin },
      { proposal: newId('prp') },
      { approvedBy: f.person.actor },
      { condition: 'Optional' },
      { stage: 'method' },
      { operation: 'records.update' },
    ])
      await expect(
        f.registry.execute(f.agent, 'review.prepare_decision', { ...f.input, ...extra }),
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
    if (!p.decision) throw new Error('Expected metadata');
    await db
      .update(proposals)
      .set({
        decision: {
          ...p.decision,
          scope: {
            type: 'question_disposition',
            disposition: {
              type: 'resolve',
              sop: f.target.id,
              expectedVersion: f.target.version,
              question: 'count',
              reason: 'Prose cannot settle this',
              basis: {
                type: 'scientific_rationale',
                rationale: 'No evidence',
                validation: 'unvalidated_method_variation',
                sources: [],
              },
              affected: [],
            },
          },
        },
      })
      .where(eq(proposals.id, p.id));
    await expect(apply(f, p.id, p.decision.previewIdentity.digest)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect((await db.select().from(proposals))[0]?.status).toBe('pending');
  });

  it.each(['agent', 'person'] as const)(
    'accepts a %s-prepared input as actual second person without changing method/evidence/reviews or original request',
    async (proposer) => {
      const f = await inputDecisionFixture(db);
      const id = newId('usr');
      await db.insert(users).values({ id, orgId: f.person.orgId, displayName: 'Sam' });
      const applying = {
        ...f.person,
        actor: { type: 'user' as const, userId: id },
        origin: {
          type: 'user_message' as const,
          conversation: newId('cnv'),
          message: 'Unrelated approver request',
        },
      };
      const p = await prepare(f, proposer === 'agent' ? f.agent : f.person);
      const result = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '', applying);
      expect(result).toMatchObject({
        status: 'approved',
        decidedBy: applying.actor,
        proposedBy: proposer === 'agent' ? f.agent.actor : f.person.actor,
        decision: { origin: proposer === 'agent' ? f.agent.origin : { type: 'unknown' } },
        receipt: { recordIds: [f.target.id] },
      });
      expect(result.previewStatus).toBeUndefined();
      const current = await f.service.get(f.person, f.target.id),
        a = current.attributes as SopAttributes;
      expect(current.status).toBe('draft');
      expect(current.updatedBy).toEqual(applying.actor);
      expect(current.evidence).toEqual(f.target.evidence);
      expect(current.reviews).toEqual(f.target.reviews);
      expect(a.questions?.[0]).toEqual({
        ...f.target.attributes.questions?.[0],
        disposition: {
          status: 'deferred',
          proposal: p.id,
          proposedBy: p.proposedBy,
          acceptedBy: applying.actor,
          at: expect.any(String),
          action: result.input,
        },
      });
      expect(a.questions?.slice(1)).toEqual(f.target.attributes.questions?.slice(1));
      const { questions: _old, ...method } = f.target.attributes;
      const { questions: _new, ...after } = a;
      expect(after).toEqual(method);
      expect(
        (await f.service.readiness(f.person, current.id)).checks.find(
          (c) => c.id === 'questions_answered',
        ),
      ).toMatchObject({ passed: false });
      expect(result.receipt?.output).toEqual(current);
      expect((await f.service.history(f.person, current.id)).at(-1)).toMatchObject({
        via: 'sops.answer_question',
        snapshot: { origin: f.target.origin },
      });
      expect(current.origin).toEqual(f.target.origin);
    },
  );

  it('keeps an unrelated edit while refreshing versions on the same accepted click', async () => {
    const f = await inputDecisionFixture(db),
      p = await prepare(f);
    const edited = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Preserve current unrelated note' },
    });
    await f.service.update(f.agent, f.product.id, {
      expectedVersion: f.product.version,
      label: 'Display-only product label',
    });
    const result = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '');
    expect(result.status).toBe('approved');
    expect(result.decision?.previewIdentity.digest).toBe(p.decision?.previewIdentity.digest);
    expect(result.decision?.writes[0]?.version).toBe(edited.version);
    if (!result.receipt) throw new Error('Expected durable receipt');
    expect((result.receipt.output as RecordEnvelope).attributes.notes).toBe(
      'Preserve current unrelated note',
    );
  });

  it('returns refreshed/stale pending facts without scientific write, then accepts only the new click', async () => {
    const f = await inputDecisionFixture(db),
      p = await prepare(f),
      token = p.decision?.previewIdentity.digest ?? '';
    const current = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'count' ? { ...v, label: 'Number of specimens', max: '48' } : v,
        ),
      },
    });
    const history = await db.select().from(recordVersions);
    const first = await apply(f, p.id, token);
    expect(first).toMatchObject({ id: p.id, status: 'pending', previewStatus: 'refreshed' });
    expect(first.receipt).toBeUndefined();
    expect(first.decidedBy).toBeUndefined();
    expect(first.decision?.previewIdentity.digest).not.toBe(token);
    expect(SopInputDecisionPreview.parse(first.preview).input).toMatchObject({
      label: 'Number of specimens',
      max: '48',
    });
    expect(await f.service.get(f.person, f.target.id)).toEqual(current);
    expect(await db.select().from(recordVersions)).toEqual(history);
    const stale = await apply(f, p.id, token);
    expect(stale).toMatchObject({
      status: 'pending',
      previewStatus: 'stale',
      decision: first.decision,
    });
    expect(
      (await db.select().from(activity))
        .filter((e) => e.operationId === 'proposals.approve')
        .map((e) => e.outcome),
    ).toEqual(['proposed', 'proposed']);
    const accepted = await apply(f, p.id, first.decision?.previewIdentity.digest ?? '');
    expect(accepted.status).toBe('approved');
    if (!accepted.receipt) throw new Error('Expected durable receipt');
    expect(
      (accepted.receipt.output as RecordEnvelope<SopAttributes>).attributes.questions?.[0]
        ?.disposition,
    ).toMatchObject({
      status: 'deferred',
      action: {
        obligation: {
          condition:
            'Supply an explicit value for Number of specimens before the experiment is ready.',
        },
      },
    });
  });

  it('retains the assistant-running approval guard and refuses newly ineligible input scope', async () => {
    const f = await inputDecisionFixture(db);
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
    const corrected = await f.registry.execute(f.person, 'sops.answer_question', {
      sop: f.target.id,
      expectedVersion: f.target.version,
      question: 'count',
      action: { type: 'correct', text: 'Clarify the exact number', reason: 'New wording' },
    });
    expect(corrected.status).toBe('done');
    const refreshed = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '');
    expect(refreshed.previewStatus).toBe('refreshed');
    await db.update(records).set({ status: 'active' }).where(eq(records.id, f.target.id));
    await expect(
      apply(f, p.id, refreshed.decision?.previewIdentity.digest ?? ''),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await db.select().from(proposals))[0]?.status).toBe('pending');
  });

  it('rolls back acceptance/history/receipt and success activity/delivery on a late persistence failure', async () => {
    const f = await inputDecisionFixture(db),
      p = await prepare(f);
    const before = await db.select().from(records),
      history = await db.select().from(recordVersions),
      ledger = await db.select().from(activity);
    const live: ActivityEntry[] = [];
    f.bus.subscribe(f.person.labId, (e) => live.push(e));
    await db.execute(
      sql`CREATE FUNCTION refuse_input_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'approved' THEN RAISE EXCEPTION 'Receipt storage unavailable'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER refuse_input_receipt BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION refuse_input_receipt()`,
    );
    await expect(apply(f, p.id, p.decision?.previewIdentity.digest ?? '')).rejects.toThrow();
    expect(await db.select().from(records)).toEqual(before);
    expect(await db.select().from(recordVersions)).toEqual(history);
    expect((await db.select().from(proposals))[0]).toMatchObject({
      status: 'pending',
      receipt: null,
      decision: p.decision,
    });
    expect((await db.select().from(activity)).slice(ledger.length).map((e) => e.outcome)).toEqual([
      'failed',
    ]);
    expect(live.map((e) => e.outcome)).toEqual(['failed']);
  });

  it('stores one durable receipt despite double click/lost delivery and returns it after restart/later edits', async () => {
    const f = await inputDecisionFixture(db),
      p = await prepare(f),
      token = p.decision?.previewIdentity.digest ?? '';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const delivery = vi.spyOn(f.bus, 'publish').mockImplementation(() => {
      throw new Error('Lost delivery');
    });
    const [first, second] = await Promise.all([apply(f, p.id, token), apply(f, p.id, token)]);
    expect(first.status).toBe('approved');
    expect(second).toEqual(first);
    delivery.mockRestore();
    const current = await f.service.get(f.person, f.target.id);
    expect(current.version).toBe(f.target.version + 1);
    await f.service.update(f.person, current.id, {
      expectedVersion: current.version,
      attributes: { ...current.attributes, notes: 'Later note' },
    });
    f.registry = createRegistry(db, f.kinds, f.bus);
    const received = vi.fn();
    f.bus.subscribe(f.person.labId, received);
    expect(await apply(f, p.id, token)).toEqual(first);
    expect(received).not.toHaveBeenCalled();
    expect((await f.service.get(f.person, current.id)).attributes.notes).toBe('Later note');
    expect(
      (await db.select().from(activity)).filter(
        (e) => e.operationId === 'proposals.approve' && e.outcome === 'approved',
      ),
    ).toHaveLength(1);
  });

  it('prepares through the actual assistant and pauses without executing the following call', async () => {
    let input: Fixture['input'];
    const complete = vi.fn<ChatModel['complete']>(async () => ({
      text: 'Ready for review.',
      stop: 'tool_use',
      toolCalls: [
        {
          id: 'prepare',
          name: 'run_operation',
          input: { operation: 'review.prepare_decision', input },
        },
        {
          id: 'later',
          name: 'records_update',
          input: { id: input.sop, expectedVersion: input.expectedVersion, label: 'Must not run' },
        },
      ],
    }));
    const assistant = new Assistant({
      model: { provider: 'test', model: 'test', complete },
      agentName: 'Test assistant',
    });
    const f = await inputDecisionFixture(db, assistant);
    input = f.input;
    const ask = await f.registry.execute(f.person, 'assistant.ask', {
      message: 'Prepare accepting the sample count question as an experiment input.',
    });
    if (ask.status !== 'done') throw new Error('Expected conversation');
    const id = (ask.output as { id: string }).id;
    await assistant.wait(id);
    const got = await f.registry.execute(f.person, 'assistant.get_conversation', { id });
    if (got.status !== 'done') throw new Error('Expected conversation');
    const conversation = got.output as Conversation;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(conversation.status).toBe('idle');
    const tool = conversation.messages.find((m) => m.role === 'tool' && m.toolCallId === 'prepare');
    expect(tool).toMatchObject({
      outcome: 'proposed',
      result: {
        status: 'proposed',
        proposal: {
          operationId: 'sops.answer_question',
          status: 'pending',
          preview: { type: 'sop_experiment_input' },
        },
      },
    });
    expect(
      conversation.messages.find((m) => m.role === 'tool' && m.toolCallId === 'later'),
    ).toMatchObject({ outcome: 'failed', error: { code: 'invalid_state' } });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect((await db.select().from(proposals))[0]?.decision?.origin).toEqual(
      conversation.messages.find((m) => m.role === 'user')?.origin,
    );
  });
});

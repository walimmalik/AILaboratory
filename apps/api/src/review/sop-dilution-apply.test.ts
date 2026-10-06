import { writeFile } from 'node:fs/promises';
import { newId } from '@ailab/domain';
import {
  type ActivityEntry,
  type Conversation,
  proposalsApprove,
  type RecordEnvelope,
  type SopAttributes,
  SopDilutionDecisionPreview,
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
import { dilutionDecisionFixture } from './test-sop-dilution.ts';

let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});
type Fixture = Awaited<ReturnType<typeof dilutionDecisionFixture>>;
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

describe('paired exact-source dilution completion', () => {
  it('publicly prepares and applies retained A after edition B and reparse of the original file A', async () => {
    const f = await dilutionDecisionFixture(db);
    await f.run(f.person, 'records.update', {
      id: f.document.id,
      expectedVersion: f.document.version,
      label: 'Edition B',
      attributes: { ...f.document.attributes, version: 'B' },
    });
    await f.reparse('Changed converted text from the original file A');
    const p = await prepare(f),
      preview = SopDilutionDecisionPreview.parse(p.preview);
    expect(preview.completion.source).toEqual(f.source);
    expect(preview.passage.text).toBe(f.quote);
    const applied = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '');
    expect(applied.status).toBe('approved');
    if (!applied.receipt) throw new Error('Expected durable receipt');
    const out = applied.receipt.output as RecordEnvelope<SopAttributes>;
    expect(out.attributes.source?.exact).toEqual(f.source);
    expect(out.attributes.variables[0]?.cite?.[0]?.quote).toBe(f.quote);
  });
  it('returns proposed for people and agents, preserves scientific state and refuses preparation inside changes.apply', async () => {
    const f = await dilutionDecisionFixture(db),
      before = await db.select().from(records),
      history = await db.select().from(recordVersions),
      ledger = await db.select().from(activity);
    const a = await prepare(f),
      b = await prepare(f, f.person);
    expect(a.decision?.origin).toEqual(f.agent.origin);
    expect(b.proposedBy).toEqual(f.person.actor);
    expect(SopDilutionDecisionPreview.parse(a.preview).type).toBe('sop_dilution_final_volume');
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
  });

  it('refuses mixed/caller authority, absent token, agent/foreign Apply and ordinary scientific resolution', async () => {
    const f = await dilutionDecisionFixture(db);
    for (const extra of [
      { variable: 'final_volume' },
      { affected: [] },
      { origin: f.agent.origin },
      { approvedBy: f.person.actor },
      { operation: 'records.update' },
      { source: f.source },
    ])
      await expect(
        f.registry.execute(f.agent, 'review.prepare_decision', { ...f.input, ...extra }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    const p = await prepare(f),
      token = p.decision?.previewIdentity.digest ?? '';
    await expect(
      f.registry.execute(f.person, 'proposals.approve', { id: p.id }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(apply(f, p.id, token, f.agent)).rejects.toMatchObject({ code: 'forbidden' });
    const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
    const foreign: RecordContext = {
      orgId: other.orgId,
      labId: other.labId,
      actor: { type: 'user', userId: other.userId },
    };
    await expect(prepare(f, foreign)).rejects.toMatchObject({ code: 'not_found' });
    await expect(apply(f, p.id, token, foreign)).rejects.toMatchObject({ code: 'not_found' });
    const action = SopDilutionDecisionPreview.parse(p.preview).acceptance.action;
    await expect(
      f.registry.execute(f.person, 'sops.answer_question', {
        sop: f.target.id,
        expectedVersion: f.target.version,
        question: f.input.question,
        action,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    if (!p.decision) throw new Error('Expected metadata');
    const { completion: _completion, ...unsupported } = action;
    await db
      .update(proposals)
      .set({
        input: unsupported,
        decision: {
          ...p.decision,
          scope: { type: 'question_disposition', disposition: unsupported },
        },
      })
      .where(eq(proposals.id, p.id));
    await expect(apply(f, p.id, token)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await f.service.get(f.person, f.target.id)).toEqual(f.target);
    expect((await db.select().from(proposals))[0]?.status).toBe('pending');
  });

  it.each(['agent', 'person'] as const)(
    'accepts a %s-prepared decision as actual second person with original request and plain durable SOP receipt',
    async (proposer) => {
      const f = await dilutionDecisionFixture(db),
        id = newId('usr');
      await db.insert(users).values({ id, orgId: f.person.orgId, displayName: 'B' });
      const applying = {
        ...f.person,
        actor: { type: 'user' as const, userId: id },
        origin: {
          type: 'user_message' as const,
          conversation: newId('cnv'),
          message: 'Unrelated applying request',
        },
      };
      const p = await prepare(f, proposer === 'agent' ? f.agent : f.person);
      const result = await apply(f, p.id, p.decision?.previewIdentity.digest ?? '', applying);
      const current = await f.service.get(f.person, f.target.id),
        a = current.attributes as SopAttributes;
      expect(result).toMatchObject({
        status: 'approved',
        decidedBy: applying.actor,
        proposedBy: p.proposedBy,
        decision: { origin: proposer === 'agent' ? f.agent.origin : { type: 'unknown' } },
        receipt: { recordIds: [current.id] },
      });
      expect(result.previewStatus).toBeUndefined();
      expect(result.receipt?.output).toEqual(current);
      expect(current).toMatchObject({
        status: 'draft',
        updatedBy: applying.actor,
        origin: f.target.origin,
      });
      expect(a.questions?.[0]).toMatchObject({
        question: f.target.attributes.questions?.[0]?.question,
        responses: [],
        disposition: {
          status: 'resolved',
          proposal: p.id,
          proposedBy: p.proposedBy,
          acceptedBy: applying.actor,
        },
      });
      expect(a.source).toEqual(f.target.attributes.source);
      expect(a.steps).toEqual(f.target.attributes.steps);
      expect(a.variables.slice(1)).toEqual(f.target.attributes.variables.slice(1));
      expect(a.variables[0]).toMatchObject({
        value: f.input.value,
        cite: [{ document: f.document.id, passage: f.input.passage, quote: f.quote }],
      });
      expect(current.evidence['/variables/final_volume']).toMatchObject({
        source: 'imported',
        reference: f.document.id,
        by: applying.actor,
      });
      expect(current.reviews.variables).toMatchObject({
        confirmedBy: applying.actor,
        values: { variables: a.variables },
      });
      expect(
        Object.fromEntries(Object.entries(current.reviews).filter(([key]) => key !== 'variables')),
      ).toEqual(f.target.reviews);
      expect((await f.service.history(f.person, current.id)).at(-1)).toMatchObject({
        via: 'sops.answer_question',
        actor: applying.actor,
      });
      if (process.env.DILUTION_APPLY_OUT && proposer === 'agent')
        await writeFile(
          process.env.DILUTION_APPLY_OUT,
          `${JSON.stringify({ selector: f.input, proposal: p, result }, null, 2)}\n`,
          'utf8',
        );
    },
  );

  it('preserves unrelated version changes and refreshed/stale pending results never claim completion', async () => {
    const f = await dilutionDecisionFixture(db),
      p = await prepare(f),
      token = p.decision?.previewIdentity.digest ?? '';
    let current = await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: { ...f.target.attributes, notes: 'Unrelated note' },
    });
    current = await f.service.update(f.agent, current.id, {
      expectedVersion: current.version,
      attributes: {
        ...current.attributes,
        variables: (current.attributes.variables as SopAttributes['variables']).map((v) =>
          v.name === 'lb_volume' ? { ...v, label: 'Revised diluent label' } : v,
        ),
      },
    });
    const history = await db.select().from(recordVersions),
      refreshed = await apply(f, p.id, token);
    expect(refreshed).toMatchObject({ id: p.id, status: 'pending', previewStatus: 'refreshed' });
    expect(refreshed.receipt).toBeUndefined();
    expect(refreshed.decidedBy).toBeUndefined();
    expect(await f.service.get(f.person, f.target.id)).toEqual(current);
    expect(await db.select().from(recordVersions)).toEqual(history);
    expect(await apply(f, p.id, token)).toMatchObject({
      status: 'pending',
      previewStatus: 'stale',
      decision: refreshed.decision,
    });
    expect(
      (await db.select().from(activity))
        .filter((e) => e.operationId === 'proposals.approve')
        .map((e) => e.outcome),
    ).toEqual(['proposed', 'proposed']);
    current = await f.service.update(f.agent, current.id, {
      expectedVersion: current.version,
      attributes: { ...current.attributes, notes: 'Preserve newest unrelated note' },
    });
    const approved = await apply(f, p.id, refreshed.decision?.previewIdentity.digest ?? '');
    expect(approved.status).toBe('approved');
    expect(approved.decision?.previewIdentity.digest).toBe(
      refreshed.decision?.previewIdentity.digest,
    );
    expect(approved.decision?.writes[0]?.version).toBe(current.version);
    if (!approved.receipt) throw new Error('Expected committed receipt');
    expect((approved.receipt.output as RecordEnvelope).attributes.notes).toBe(
      'Preserve newest unrelated note',
    );
  });

  it('retains running-assistant guard and freshly refuses missing source bytes or newly ineligible facts', async () => {
    const f = await dilutionDecisionFixture(db);
    const conversation = await createConversation(db, f.person, {
      title: 'Dilution',
      agentName: 'Test',
      provider: 'test',
      model: 'test',
    });
    if (f.agent.actor.type !== 'agent') throw new Error('Expected agent');
    const p = await prepare(f, {
        ...f.agent,
        actor: { ...f.agent.actor, sessionRef: conversation.id },
      }),
      token = p.decision?.previewIdentity.digest ?? '';
    await db
      .update(conversations)
      .set({ status: 'running' })
      .where(eq(conversations.id, conversation.id));
    await expect(apply(f, p.id, token)).rejects.toMatchObject({
      code: 'invalid_state',
      message: expect.stringContaining('still working'),
    });
    await db
      .update(conversations)
      .set({ status: 'idle' })
      .where(eq(conversations.id, conversation.id));
    f.fail('missing');
    await expect(apply(f, p.id, token)).rejects.toThrow();
    f.fail(undefined);
    await f.service.update(f.agent, f.target.id, {
      expectedVersion: f.target.version,
      attributes: {
        ...f.target.attributes,
        variables: f.target.attributes.variables.map((v) =>
          v.name === 'dilution_factor' ? { ...v, value: '20' } : v,
        ),
      },
    });
    const before = await f.service.get(f.person, f.target.id);
    await expect(apply(f, p.id, token)).rejects.toThrow('contradicts');
    expect(await f.service.get(f.person, f.target.id)).toEqual(before);
    expect((await db.select().from(proposals))[0]).toMatchObject({
      status: 'pending',
      receipt: null,
    });
  });

  it('rolls back owning write, history, receipt and success delivery on late receipt persistence failure', async () => {
    const f = await dilutionDecisionFixture(db),
      p = await prepare(f),
      before = await db.select().from(records),
      history = await db.select().from(recordVersions),
      ledger = await db.select().from(activity);
    const live: ActivityEntry[] = [];
    f.bus.subscribe(f.person.labId, (e) => live.push(e));
    await db.execute(
      sql`CREATE FUNCTION refuse_dilution_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'approved' THEN RAISE EXCEPTION 'Receipt storage unavailable'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER refuse_dilution_receipt BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION refuse_dilution_receipt()`,
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

  it('double click/lost delivery commits once and durable retry after restart returns original receipt', async () => {
    const f = await dilutionDecisionFixture(db),
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

  it('prepares through the actual assistant and pauses the following mutation', async () => {
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
    const f = await dilutionDecisionFixture(db, assistant);
    input = f.input;
    const ask = await f.registry.execute(f.person, 'assistant.ask', {
      message: 'Prepare the final volume from the retained dilution passage.',
    });
    if (ask.status !== 'done') throw new Error('Expected conversation');
    const id = (ask.output as { id: string }).id;
    await assistant.wait(id);
    const got = await f.registry.execute(f.person, 'assistant.get_conversation', { id });
    if (got.status !== 'done') throw new Error('Expected conversation');
    const conversation = got.output as Conversation;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(conversation.status).toBe('idle');
    expect(
      conversation.messages.find((m) => m.role === 'tool' && m.toolCallId === 'prepare'),
    ).toMatchObject({
      outcome: 'proposed',
      result: {
        status: 'proposed',
        proposal: {
          status: 'pending',
          operationId: 'sops.answer_question',
          preview: { type: 'sop_dilution_final_volume' },
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

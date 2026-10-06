import { newId } from '@ailab/domain';
import type {
  Actor,
  Conversation,
  ConversationSummary,
  OperationResult,
  Proposal,
  Readiness,
  RecordEnvelope,
  SopAttributes,
} from '@ailab/schema';
import { defineKind, ScientificQuestion } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTenant } from '../auth.ts';
import { run } from '../campaigns/kinds.ts';
import type { Db } from '../db/client.ts';
import { conversationMessages, records, users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import { memoryKinds } from '../memory/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { widget } from '../records/test-kinds.ts';
import { findSkill } from '../skills/skills.ts';
import { sop } from '../sops/kinds.ts';
import {
  Assistant,
  describeAttachment,
  MAX_STEPS,
  toModelMessages,
  toolsFor,
} from './assistant.ts';
import { type ChatModel, ModelError, type ModelRequest, type ModelTurn } from './model.ts';
import { OpenAiResponsesModel } from './responses.ts';
import { SCIENTIFIC_INTAKE_PROMPT } from './scientific-intake.ts';
import { ScriptedModel } from './scripted.ts';
import {
  appendMessage,
  createConversation,
  getConversation,
  messageRows,
  updateConversation,
} from './store.ts';

let db: Db;
let close: () => Promise<void>;
let person: RecordContext;
let other: RecordContext;
const attributes = { color: 'teal', volume: { value: '50', unit: 'uL' } };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Bench 3', userName: 'Wali' });
  person = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  const otherId = newId('usr');
  await db.insert(users).values({ id: otherId, orgId: tenant.orgId, displayName: 'Sam' });
  other = { ...person, actor: { type: 'user', userId: otherId } };
});
afterEach(() => close());

function setup(model: ChatModel | null = new ScriptedModel()) {
  const assistant = new Assistant(
    model
      ? { model, agentName: 'Test assistant' }
      : { reason: 'AGENT_PROVIDER is not set in .env' },
  );
  const registry = createRegistry(
    db,
    memoryKinds.reduce((kinds, kind) => kinds.register(kind), new KindRegistry().register(widget)),
    new ActivityBus(),
    assistant,
  );
  return { assistant, registry };
}

async function ask(
  registry: OperationRegistry,
  assistant: Assistant,
  message: string,
  extra: Record<string, unknown> = {},
  ctx = person,
): Promise<Conversation> {
  const result = await registry.execute(ctx, 'assistant.ask', { message, ...extra });
  if (result.status !== 'done') throw new Error('ask was not done');
  const { id } = result.output as ConversationSummary;
  await assistant.wait(id);
  const got = await registry.execute(ctx, 'assistant.get_conversation', { id });
  return (got as { output: Conversation }).output;
}

async function output(promise: Promise<OperationResult<unknown>>): Promise<unknown> {
  const result = await promise;
  if (result.status === 'proposed') throw new Error('unexpectedly proposed');
  return result.output;
}

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  return error as OperationError;
}

const createWidget = (label: string) =>
  `/op records.create ${JSON.stringify({ kind: 'widget', label, attributes })}`;

/** A model that replies with the given turns in order, recording each request. */
class FakeModel implements ChatModel {
  readonly provider = 'fake';
  readonly model = 'fake-1';
  readonly requests: ModelRequest[] = [];
  constructor(readonly turns: (ModelTurn | Error | (() => Promise<ModelTurn>))[]) {}
  async complete(request: ModelRequest): Promise<ModelTurn> {
    const { signal: _, ...rest } = request;
    this.requests.push(structuredClone(rest));
    const next = this.turns.shift() ?? { text: 'ok', toolCalls: [], stop: 'end' };
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }
}

describe('assistant.ask', () => {
  it('durably stamps distinct actual fresh-request roots on drafts in one conversation', async () => {
    const { assistant, registry } = setup();
    const first = await ask(registry, assistant, createWidget('First request draft'));
    const second = await ask(registry, assistant, createWidget('Second request draft'), {
      conversationId: first.id,
    });
    const roots = second.messages.filter((message) => message.role === 'user');
    const made = (await output(registry.execute(person, 'records.list', { kind: 'widget' }))) as {
      records: RecordEnvelope[];
    };
    const a = made.records.find((record) => record.label === 'First request draft');
    const b = made.records.find((record) => record.label === 'Second request draft');
    expect(a?.origin).toEqual(roots[0]?.origin);
    expect(b?.origin).toEqual(roots[1]?.origin);
    expect(a?.origin?.type).toBe('user_message');
    expect(a?.origin).not.toEqual(b?.origin);
    expect(a?.createdBy).toEqual(b?.createdBy);
    if (!a || !b) throw new Error('Expected both drafts');
    const restarted = setup();
    for (const record of [a, b])
      expect(
        await output(restarted.registry.execute(person, 'records.get', { id: record.id })),
      ).toMatchObject({ origin: record.origin });
  });

  it('persists the validated open-question reply root while a fresh ask creates a distinct root', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    registry.deps.kinds.register(
      defineKind({
        kind: 'sop',
        idPrefix: 'sop',
        namePrefix: 'SOP',
        nameWidth: 4,
        attributes: z.strictObject({ questions: z.array(ScientificQuestion) }),
      }),
    );
    const method = (await output(
      registry.execute(person, 'records.create', {
        kind: 'sop',
        label: 'Question method',
        attributes: {
          questions: [
            {
              id: 'wash',
              question: 'Which wash source applies?',
              stage: { stage: 'method', reason: 'Conflicting sources' },
              responses: [],
              disposition: { status: 'open' },
            },
          ],
        },
      }),
    )) as RecordEnvelope;
    const page = {
      path: `/records/${method.id}`,
      record: { id: method.id, name: method.name, version: method.version },
      activeQuestion: { id: 'wash', stage: 'method' },
    };
    model.turns.push({
      text: '',
      toolCalls: [{ id: 'read-method', name: 'records_get', input: { id: method.id } }],
      stop: 'tool_use',
    });
    const original = await ask(registry, assistant, 'Investigate this open wash question', {
      page,
    });
    const root = original.messages[0];
    if (root?.role !== 'user') throw new Error('Expected actual root message');
    const createTurn = (label: string): ModelTurn => ({
      text: '',
      toolCalls: [
        { id: label, name: 'records_create', input: { kind: 'widget', label, attributes } },
      ],
      stop: 'tool_use',
    });
    model.turns.push(createTurn('Supporting draft'));
    const reply = await ask(registry, assistant, 'Continue with a supporting draft', {
      page,
      replyTo: { conversation: original.id, message: root.id },
    });
    model.turns.push(createTurn('Unrelated fresh draft'));
    const fresh = await ask(registry, assistant, 'A separate fresh request', {
      page,
      conversationId: reply.id,
    });
    const newRoot = fresh.messages.findLast((message) => message.role === 'user');
    const made = (await output(registry.execute(person, 'records.list', { kind: 'widget' }))) as {
      records: RecordEnvelope[];
    };
    expect(made.records.find((record) => record.label === 'Supporting draft')?.origin).toEqual(
      root.origin,
    );
    expect(made.records.find((record) => record.label === 'Unrelated fresh draft')?.origin).toEqual(
      newRoot?.origin,
    );
    expect(newRoot?.origin).not.toEqual(root.origin);
    expect(reply.messages[0]).toMatchObject({ origin: root.origin });
  });

  it('cleans up running status after a preflight read fails', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    const conversation = await createConversation(db, person, {
      title: 'Preflight fault',
      agentName: assistant.agentName,
      provider: model.provider,
      model: model.model,
    });
    await updateConversation(db, conversation.id, { status: 'running' });
    const fault = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('Injected preflight failure');
    });
    assistant.start(registry.deps, person, conversation.id);
    await assistant.wait(conversation.id);
    fault.mockRestore();
    expect(assistant.isRunning(conversation.id)).toBe(false);
    expect(model.requests).toHaveLength(0);
    expect(await getConversation(db, person, conversation.id)).toMatchObject({
      status: 'failed',
      error: 'The assistant stopped because of a server error.',
    });
  });
  it('stamps distinct requests and retains only a validated pending reply origin after reload or new chat', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    const first = await ask(registry, assistant, 'First request');
    const second = await ask(registry, assistant, 'Second request', { conversationId: first.id });
    const [a, b] = second.messages.filter((message) => message.role === 'user');
    expect(a?.origin).toEqual({ type: 'user_message', conversation: first.id, message: a?.id });
    expect(b?.origin).toEqual({ type: 'user_message', conversation: first.id, message: b?.id });
    expect(a?.origin).not.toEqual(b?.origin);
    expect(model.requests[0]?.system).toContain(SCIENTIFIC_INTAKE_PROMPT);

    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'widget',
        label: 'Stock',
        attributes,
        status: 'active',
      }),
    )) as RecordEnvelope;
    model.turns.push({
      text: '',
      toolCalls: [
        {
          id: 'proposal',
          name: 'records_update',
          input: { id: record.id, expectedVersion: 1, label: 'Updated' },
        },
      ],
      stop: 'tool_use',
    });
    const proposed = await ask(registry, assistant, 'Update the stock');
    const root = proposed.messages.findLast((message) => message.role === 'user');
    const tool = proposed.messages.find(
      (message) => message.role === 'tool' && message.outcome === 'proposed',
    );
    if (root?.role !== 'user' || tool?.role !== 'tool')
      throw new Error('Expected pending proposal');
    const proposal = (tool.result as { proposal: Proposal }).proposal;
    const continuation = {
      page: { path: '/review', proposal: { id: proposal.id } },
      replyTo: { conversation: proposed.id, message: root.id },
    };
    const reply = await ask(registry, assistant, 'Explain the pending change', continuation);
    expect(reply.messages[0]).toMatchObject({ role: 'user', origin: root.origin });
    expect(model.requests.at(-1)?.system).toContain(`"id":"${proposal.id}"`);
    expect(model.requests.at(-1)?.system).toContain('"status":"pending"');
    const reload = await registry.execute(person, 'assistant.get_conversation', { id: reply.id });
    expect((reload as { output: Conversation }).output.messages[0]).toMatchObject({
      origin: root.origin,
    });
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', {
            message: 'Unrelated reply',
            ...continuation,
            replyTo: { conversation: first.id, message: a?.id },
          }),
        )
      ).code,
    ).toBe('invalid_input');
    expect(
      (
        await refused(
          registry.execute(other, 'assistant.ask', {
            message: 'Wrong person',
            ...continuation,
          }),
        )
      ).code,
    ).toBe('not_found');
    const tenant = await createTenant(db, {
      orgName: 'Other org',
      labName: 'Other lab',
      userName: 'Other scientist',
    });
    const outsider: RecordContext = {
      actor: { type: 'user', userId: tenant.userId },
      orgId: tenant.orgId,
      labId: tenant.labId,
    };
    expect(
      (
        await refused(
          registry.execute(outsider, 'assistant.ask', {
            message: 'Wrong lab',
            ...continuation,
          }),
        )
      ).code,
    ).toBe('not_found');
    await registry.execute(person, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      label: 'Concurrent edit',
    });
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', {
            message: 'Stale pending change',
            ...continuation,
          }),
        )
      ).code,
    ).toBe('version_conflict');
    await registry.execute(person, 'proposals.reject', { id: proposal.id });
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', { message: 'Continue', ...continuation }),
        )
      ).code,
    ).toBe('invalid_state');
  });

  it.each(['root', 'immediate'] as const)(
    'retains the root intent across pending proposal chains through %s replies',
    async (reference) => {
      const model = new FakeModel([]);
      const { assistant, registry } = setup(model);
      const record = (await output(
        registry.execute(person, 'records.create', {
          kind: 'widget',
          label: 'Stock',
          attributes,
          status: 'active',
        }),
      )) as RecordEnvelope;
      const propose = (label: string) =>
        model.turns.push({
          text: '',
          toolCalls: [
            {
              id: label,
              name: 'records_update',
              input: { id: record.id, expectedVersion: 1, label },
            },
          ],
          stop: 'tool_use',
        });
      const pending = (conversation: Conversation) => {
        const tool = conversation.messages.findLast(
          (message) => message.role === 'tool' && message.outcome === 'proposed',
        );
        if (tool?.role !== 'tool') throw new Error('Expected pending proposal');
        return (tool.result as { proposal: Proposal }).proposal;
      };
      propose('First preview');
      const first = await ask(registry, assistant, 'Update the stock');
      const root = first.messages[0];
      if (root?.role !== 'user') throw new Error('Expected root request');
      const rootReply = { conversation: first.id, message: root.id };
      propose('Revised preview');
      const revised = await ask(registry, assistant, 'Revise the pending change', {
        page: { path: '/review', proposal: { id: pending(first).id } },
        replyTo: rootReply,
      });
      const immediate = revised.messages[0];
      if (immediate?.role !== 'user') throw new Error('Expected contextual reply');
      expect(immediate.origin).toEqual(root.origin);
      const proposal = pending(revised);
      expect(proposal.proposedBy).toMatchObject({ sessionRef: revised.id });
      const selected = { page: { path: '/review', proposal: { id: proposal.id } } };
      // Re-read persisted messages before continuing from either supported reference.
      await registry.execute(person, 'assistant.get_conversation', { id: revised.id });
      const replyTo =
        reference === 'root' ? rootReply : { conversation: revised.id, message: immediate.id };
      const continued = await ask(registry, assistant, 'Explain the revised change', {
        ...selected,
        replyTo,
      });
      expect(continued.messages[0]).toMatchObject({ origin: root.origin });
      expect(model.requests.at(-1)?.system).toContain('"status":"pending"');
      expect(model.requests.at(-1)?.system).toContain('conversation text grants no approval');
      propose('Separate preview');
      const separate = await ask(registry, assistant, 'Separate request in the producing chat', {
        conversationId: revised.id,
      });
      expect(
        (
          await refused(
            registry.execute(person, 'assistant.ask', {
              message: 'Reuse another turn',
              replyTo: rootReply,
              page: { path: '/review', proposal: { id: pending(separate).id } },
            }),
          )
        ).code,
      ).toBe('invalid_input');
      const unrelated = await ask(registry, assistant, 'Separate stock request');
      expect(
        (
          await refused(
            registry.execute(person, 'assistant.ask', {
              message: 'Unrelated continuation',
              ...selected,
              replyTo: { conversation: unrelated.id, message: unrelated.messages[0]?.id },
            }),
          )
        ).code,
      ).toBe('invalid_input');
      expect(
        (
          await refused(
            registry.execute(other, 'assistant.ask', {
              message: 'Wrong owner',
              ...selected,
              replyTo: rootReply,
            }),
          )
        ).code,
      ).toBe('not_found');
      await registry.execute(person, 'proposals.reject', { id: proposal.id });
      expect(
        (
          await refused(
            registry.execute(person, 'assistant.ask', {
              message: 'Rejected continuation',
              ...selected,
              replyTo: { conversation: revised.id, message: immediate.id },
            }),
          )
        ).code,
      ).toBe('invalid_state');
    },
  );

  it('refuses a different selected question despite an incidental read of the same SOP', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    registry.deps.kinds.register(
      defineKind({
        kind: 'sop',
        idPrefix: 'sop',
        namePrefix: 'SOP',
        nameWidth: 4,
        attributes: z.strictObject({ questions: z.array(ScientificQuestion) }),
      }),
    );
    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'sop',
        label: 'Method',
        attributes: {
          questions: ['wash', 'incubation'].map((id) => ({
            id,
            question: `Which ${id} instruction applies?`,
            stage: { stage: 'method', reason: 'Conflicting source instructions' },
            responses: [],
            disposition: { status: 'open' },
          })),
        },
      }),
    )) as RecordEnvelope;
    const page = {
      path: `/records/${record.id}`,
      record: { id: record.id, name: record.name, version: 1 },
      activeQuestion: { id: 'wash', stage: 'method' },
    };
    model.turns.push({
      text: '',
      toolCalls: [{ id: 'read', name: 'records_get', input: { id: record.id } }],
      stop: 'tool_use',
    });
    const original = await ask(registry, assistant, 'Investigate the wash question', { page });
    expect(original.messages.find((message) => message.role === 'tool')).toMatchObject({
      outcome: 'done',
      result: { output: { id: record.id } },
    });
    const root = original.messages[0];
    if (root?.role !== 'user') throw new Error('Expected root request');
    const replyTo = { conversation: original.id, message: root.id };
    const error = await refused(
      registry.execute(person, 'assistant.ask', {
        message: 'Continue',
        replyTo,
        page: { ...page, activeQuestion: { id: 'incubation', stage: 'method' } },
      }),
    );
    expect(error.code).toBe('invalid_input');
    const continued = await ask(registry, assistant, 'Continue the wash investigation', {
      page,
      replyTo,
    });
    expect(continued.messages[0]).toMatchObject({ origin: root.origin });
  });

  it('passes trusted origins to tools and pauses remaining tool calls when a proposal is pending', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'widget',
        label: 'Stock',
        attributes,
        status: 'active',
      }),
    )) as RecordEnvelope;
    const proposalInput = {
      operation: 'records.update',
      input: { id: record.id, expectedVersion: 1, label: 'Updated' },
    };
    const laterInput = { kind: 'widget', label: 'Must not create', attributes };
    const raw = {
      output: [
        {
          type: 'function_call',
          call_id: 'proposal',
          name: 'run_operation',
          arguments: JSON.stringify(proposalInput),
        },
        {
          type: 'function_call',
          call_id: 'later',
          name: 'records_create',
          arguments: JSON.stringify(laterInput),
        },
      ],
    };
    model.turns.push({
      text: 'I prepared a change.',
      raw,
      toolCalls: [
        {
          id: 'proposal',
          name: 'run_operation',
          input: proposalInput,
        },
        {
          id: 'later',
          name: 'records_create',
          input: laterInput,
        },
      ],
      stop: 'tool_use',
    });
    const execute = vi.spyOn(registry, 'execute');
    const conversation = await ask(registry, assistant, 'Change the stock');
    const user = conversation.messages[0];
    expect(execute.mock.calls.find(([, id]) => id === 'records.update')?.[0].origin).toEqual(
      user?.role === 'user' ? user.origin : undefined,
    );
    execute.mockRestore();
    expect(model.requests).toHaveLength(1);
    expect(conversation.status).toBe('idle');
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: expect.stringContaining('ready for your review'),
      toolCalls: [],
    });
    expect(
      conversation.messages.find(
        (message) => message.role === 'tool' && message.toolCallId === 'later',
      ),
    ).toMatchObject({ outcome: 'failed', error: { code: 'invalid_state' } });
    expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
      records: [expect.objectContaining({ id: record.id })],
    });
    await ask(registry, assistant, 'What is pending?', { conversationId: conversation.id });
    expect(model.requests.at(-1)?.system).toContain(
      'Current proposal states from this conversation',
    );
    const history = model.requests.at(-1)?.messages ?? [];
    expect(
      history.find((message) => message.role === 'assistant' && message.toolCalls.length),
    ).toMatchObject({ raw });
    expect(
      history.find((message) => message.role === 'assistant' && message.toolCalls.length),
    ).toMatchObject({
      toolCalls: [
        expect.objectContaining({ id: 'proposal', name: 'records_update' }),
        expect.objectContaining({ id: 'later', name: 'records_create' }),
      ],
    });
    for (const id of ['proposal', 'later'])
      expect(
        history.filter((message) => message.role === 'tool' && message.toolCallId === id),
      ).toHaveLength(1);

    // A restart after storing the calls but before storing a deferred result must still pair both.
    const missing = conversation.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'later',
    );
    if (!missing) throw new Error('Expected deferred result');
    await db.delete(conversationMessages).where(eq(conversationMessages.id, missing.id));
    const restarted = setup(model);
    await ask(restarted.registry, restarted.assistant, 'Explain after restart', {
      conversationId: conversation.id,
    });
    const restartedHistory = model.requests.at(-1)?.messages ?? [];
    for (const id of ['proposal', 'later'])
      expect(
        restartedHistory.filter((message) => message.role === 'tool' && message.toolCallId === id),
      ).toHaveLength(1);
    expect(
      restartedHistory.find((message) => message.role === 'tool' && message.toolCallId === 'later'),
    ).toMatchObject({ isError: true, content: expect.stringContaining('not run') });
  });

  it('rejects stale or cross-lab page context and contextual replies without active work', async () => {
    const { assistant, registry } = setup();
    const record = (await output(
      registry.execute(person, 'records.create', { kind: 'widget', label: 'Stock', attributes }),
    )) as RecordEnvelope;
    const page = {
      path: `/records/${record.id}`,
      record: { id: record.id, name: record.name, version: record.version },
    };
    await registry.execute(person, 'records.update', {
      id: record.id,
      expectedVersion: 1,
      label: 'Changed',
    });
    expect(
      (await refused(registry.execute(person, 'assistant.ask', { message: 'This record', page })))
        .code,
    ).toBe('version_conflict');
    const tenant = await createTenant(db, {
      orgName: 'Other org',
      labName: 'Other lab',
      userName: 'Other scientist',
    });
    const outsider: RecordContext = {
      actor: { type: 'user', userId: tenant.userId },
      orgId: tenant.orgId,
      labId: tenant.labId,
    };
    expect(
      (await refused(registry.execute(outsider, 'assistant.ask', { message: 'This record', page })))
        .code,
    ).toBe('not_found');
    const original = await ask(registry, assistant, 'A new request');
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', {
            message: 'Continuation',
            replyTo: { conversation: original.id, message: original.messages[0]?.id },
          }),
        )
      ).code,
    ).toBe('invalid_input');
  });

  it('recovers current scientific questions and unknown responses in new chat, and refuses missing, changed or historical questions', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    // Consumer fixture uses the SG-01 schema without depending on the SG-02 operation rollout.
    registry.deps.kinds.register(
      defineKind({
        kind: 'sop',
        idPrefix: 'sop',
        namePrefix: 'SOP',
        nameWidth: 4,
        attributes: z.strictObject({ questions: z.array(ScientificQuestion) }),
      }),
    );
    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'sop',
        label: 'Wash method',
        attributes: {
          questions: [
            {
              id: 'wash',
              question: 'Which supported wash instruction applies?',
              stage: { stage: 'method', reason: 'Conflicting source instructions' },
              responses: [
                {
                  text: "I don't know",
                  by: person.actor,
                  at: new Date().toISOString(),
                  version: 1,
                },
              ],
              disposition: { status: 'open' },
            },
          ],
        },
      }),
    )) as RecordEnvelope;
    const page = {
      path: `/records/${record.id}`,
      record: { id: record.id, name: record.name, version: 1 },
      activeQuestion: { id: 'wash', stage: 'method' },
    };
    const original = await ask(registry, assistant, 'Investigate this method', { page });
    expect(model.requests[0]?.system).toContain("I don't know");
    expect(model.requests[0]?.system).toContain('"status":"open"');
    const root = original.messages[0];
    if (root?.role !== 'user') throw new Error('Expected originating user message');
    const continued = await ask(registry, assistant, 'Continue investigating', {
      page,
      replyTo: { conversation: original.id, message: root.id },
    });
    expect(continued.messages[0]).toMatchObject({ role: 'user', origin: root.origin });
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', {
            message: 'Missing',
            page: { ...page, activeQuestion: { id: 'missing', stage: 'method' } },
          }),
        )
      ).code,
    ).toBe('not_found');
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', {
            message: 'Changed stage',
            page: { ...page, activeQuestion: { id: 'wash', stage: 'run' } },
          }),
        )
      ).code,
    ).toBe('invalid_state');
    // Historical payload is preserved in storage, but never interpreted as the current contract.
    await db
      .update(records)
      .set({
        attributes: {
          questions: [
            { id: 'wash', question: 'Wash?', status: 'answered', answer: "I don't know" },
          ],
        },
      })
      .where(eq(records.id, record.id));
    expect(
      (await refused(registry.execute(person, 'assistant.ask', { message: 'Historical', page })))
        .code,
    ).toBe('unavailable');
    const historical = await ask(registry, assistant, 'Inspect method', {
      page: { path: page.path, record: page.record },
    });
    expect(historical.status).toBe('idle');
    expect(model.requests.at(-1)?.system).toContain('unsupported historical questions');
  });

  it('continues with a human-saved unknown response without granting chat or agents response authority', async () => {
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    registry.deps.kinds.register(sop);
    const draft = (await output(
      registry.execute(person, 'sops.draft', {
        label: 'Unfinished wash',
        materials: [],
        variables: [],
        steps: [{ id: 'wash', action: 'wash', text: 'Wash the plate.' }],
        questions: [
          {
            id: 'wash-volume',
            question: 'Which wash volume does the protocol require?',
            about: { step: 'wash' },
            stage: { stage: 'method', reason: 'The wash volume is missing' },
          },
        ],
      }),
    )) as RecordEnvelope<SopAttributes>;
    const pageFor = (record: RecordEnvelope) => ({
      path: `/records/${record.id}`,
      record: { id: record.id, name: record.name, version: record.version },
      activeQuestion: { id: 'wash-volume', stage: 'method' },
    });
    await ask(registry, assistant, "I don't know. Please note that.", { page: pageFor(draft) });
    const beforeSave = model.requests.at(-1)?.system;
    expect(beforeSave).toContain('Record response beneath their reply in this chat');
    expect(beforeSave).toContain('SOP page is an alternative');
    expect(beforeSave).toContain('Ordinary chat or notes do not save a response');
    expect(beforeSave).not.toContain('Continue from saved responses');
    const afterChat = (await output(
      registry.execute(person, 'records.get', { id: draft.id }),
    )) as RecordEnvelope<SopAttributes>;
    expect(afterChat).toEqual(draft);
    const noted = (await output(
      registry.execute(person, 'records.update', {
        id: draft.id,
        expectedVersion: draft.version,
        attributes: { ...draft.attributes, notes: "The scientist said: I don't know." },
      }),
    )) as RecordEnvelope<SopAttributes>;
    expect(noted.attributes.questions?.[0]?.responses).toEqual([]);
    const saved = (await output(
      registry.execute(person, 'sops.answer_question', {
        sop: draft.id,
        expectedVersion: noted.version,
        question: 'wash-volume',
        action: { type: 'response', text: "I don't know" },
      }),
    )) as RecordEnvelope<SopAttributes>;
    const continued = await ask(registry, assistant, 'Find the evidence needed next', {
      page: pageFor(saved),
    });
    const request = model.requests.at(-1);
    // A new chat has no transcript to supply this answer: its context comes from the saved SOP.
    expect(continued.messages[0]).toMatchObject({
      role: 'user',
      page: pageFor(saved),
    });
    expect(request?.messages).toHaveLength(1);
    const contextPrefix = `Current scientific questions for ${saved.name} at version ${saved.version}: `;
    const questionsLine = request?.system
      .split('\n')
      .find((line) => line.startsWith(contextPrefix));
    expect(questionsLine).toBeDefined();
    const questionsJson = questionsLine?.slice(contextPrefix.length).split('. Responses are')[0];
    expect(JSON.parse(questionsJson ?? 'null')).toEqual(saved.attributes.questions);
    expect(request?.system).toContain('do not ask an identical already-answered question');
    expect(request?.system).toContain('disputed method settings unchanged');
    expect(request?.system).toContain('suggest a specific next action to obtain it');
    expect(request?.system).toContain('ordinary chat or notes do not');
    expect(request?.tools.map((tool) => tool.name)).not.toContain('sops_answer_question');
    expect(saved.attributes.questions?.[0]).toMatchObject({
      id: 'wash-volume',
      responses: [
        { text: "I don't know", by: person.actor, version: saved.version, at: expect.any(String) },
      ],
      disposition: { status: 'open' },
    });
    expect(saved.attributes.steps).toEqual(draft.attributes.steps);
    model.turns.push({
      text: '',
      toolCalls: [
        {
          id: 'agent-response',
          name: 'run_operation',
          input: {
            operation: 'sops.answer_question',
            input: {
              sop: saved.id,
              expectedVersion: saved.version,
              question: 'wash-volume',
              action: { type: 'response', text: '300 uL' },
            },
          },
        },
      ],
      stop: 'tool_use',
    });
    const attempted = await ask(registry, assistant, 'Record this for me', {
      conversationId: continued.id,
      page: pageFor(saved),
    });
    expect(attempted.messages.find((message) => message.role === 'tool')).toMatchObject({
      operationId: 'sops.answer_question',
      outcome: 'failed',
      error: { code: 'unknown_operation' },
    });
    expect(await output(registry.execute(person, 'records.get', { id: saved.id }))).toEqual(saved);
    const readiness = (await output(
      registry.execute(person, 'records.readiness', { id: saved.id }),
    )) as Readiness;
    expect(readiness.checks.find((check) => check.id === 'questions_answered')).toMatchObject({
      passed: false,
    });
    expect(readiness.ready).toBe(false);
  });

  it('blocks Apply while an assistant turn runs, allows a lab colleague after idle, and returns an approved receipt during a later turn', async () => {
    let release: (turn: ModelTurn) => void = () => undefined;
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'widget',
        label: 'Stock',
        attributes,
        status: 'active',
      }),
    )) as RecordEnvelope;
    model.turns.push({
      text: '',
      toolCalls: [
        {
          id: 'proposal',
          name: 'records_update',
          input: { id: record.id, expectedVersion: 1, label: 'Updated' },
        },
      ],
      stop: 'tool_use',
    });
    const conversation = await ask(registry, assistant, 'Change stock');
    const tool = conversation.messages.find(
      (message) => message.role === 'tool' && message.outcome === 'proposed',
    );
    if (tool?.role !== 'tool') throw new Error('Expected proposal');
    const proposal = (tool.result as { proposal: Proposal }).proposal;
    model.turns.push(() => new Promise<ModelTurn>((resolve) => (release = resolve)));
    await registry.execute(person, 'assistant.ask', {
      message: 'More evidence',
      conversationId: conversation.id,
    });
    await expect.poll(() => model.requests.length).toBe(2);
    expect(
      (await refused(registry.execute(other, 'proposals.approve', { id: proposal.id }))).code,
    ).toBe('invalid_state');
    release({ text: 'Ready.', toolCalls: [], stop: 'end' });
    await assistant.wait(conversation.id);
    const applied = (await output(
      registry.execute(other, 'proposals.approve', { id: proposal.id }),
    )) as Proposal;
    expect(applied.status).toBe('approved');
    expect(applied.decidedBy).toEqual(other.actor);
    model.turns.push(() => new Promise<ModelTurn>((resolve) => (release = resolve)));
    await registry.execute(person, 'assistant.ask', {
      message: 'Another request',
      conversationId: conversation.id,
    });
    await expect.poll(() => model.requests.length).toBe(3);
    expect(await output(registry.execute(other, 'proposals.approve', { id: proposal.id }))).toEqual(
      applied,
    );
    release({ text: 'Done.', toolCalls: [], stop: 'end' });
    await assistant.wait(conversation.id);
  });

  it('makes an empty model reply an explicit limit instead of a blank terminal turn', async () => {
    const { assistant, registry } = setup(
      new FakeModel([{ text: '', toolCalls: [], stop: 'end' }]),
    );
    const conversation = await ask(registry, assistant, 'Investigate');
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: expect.stringContaining('no usable reply'),
    });
  });
  it('runs operations as an agent for the person and saves the conversation', async () => {
    const { assistant, registry } = setup();
    const conversation = await ask(registry, assistant, createWidget('Tip box'), {
      page: { path: '/records', title: 'Records' },
    });

    expect(conversation.status).toBe('idle');
    expect(conversation.title).toContain('/op records.create');
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    const tool = conversation.messages[2];
    expect(tool).toMatchObject({ role: 'tool', operationId: 'records.create', outcome: 'done' });
    expect(conversation.messages[3]).toMatchObject({
      role: 'assistant',
      text: expect.stringMatching(/^Done/),
    });

    const { entries } = (await output(registry.execute(person, 'activity.list', {}))) as {
      entries: { operationId: string; actor: Actor }[];
    };
    const created = entries.find((e) => e.operationId === 'records.create');
    expect(created?.actor).toEqual({
      type: 'agent',
      agentName: 'Test assistant',
      onBehalfOf: (person.actor as { userId: string }).userId,
      sessionRef: conversation.id,
    });
    expect(entries.find((e) => e.operationId === 'assistant.ask')?.actor).toEqual(person.actor);
  });

  it('proposes changes to active records instead of making them', async () => {
    const { assistant, registry } = setup();
    const made = await registry.execute(person, 'records.create', {
      kind: 'widget',
      label: 'Stock',
      attributes,
      status: 'active',
    });
    const record = (made as { output: RecordEnvelope }).output;
    const conversation = await ask(
      registry,
      assistant,
      `/op records.update ${JSON.stringify({ id: record.id, expectedVersion: 1, label: 'Renamed' })}`,
    );
    expect(conversation.messages[2]).toMatchObject({ role: 'tool', outcome: 'proposed' });
    const { proposals } = (await output(
      registry.execute(person, 'proposals.list', { status: 'pending' }),
    )) as {
      proposals: { proposedBy: Actor }[];
    };
    expect(proposals[0]?.proposedBy).toMatchObject({
      agentName: 'Test assistant',
      sessionRef: conversation.id,
    });
  });

  it("tells the model which of its proposals people rejected, and why, when it's asked again", async () => {
    const scripted = new ScriptedModel();
    const systems: string[] = [];
    const model: ChatModel = {
      provider: 'scripted',
      model: 'scripted',
      complete: (request) => {
        systems.push(request.system);
        return scripted.complete(request);
      },
    };
    const { assistant, registry } = setup(model);
    const made = await registry.execute(person, 'records.create', {
      kind: 'widget',
      label: 'Stock',
      attributes,
      status: 'active',
    });
    const record = (made as { output: RecordEnvelope }).output;
    const first = await ask(
      registry,
      assistant,
      `/op records.update ${JSON.stringify({ id: record.id, expectedVersion: 1, label: 'Renamed', reason: 'Clearer name' })}`,
    );
    expect(systems[0]).not.toContain('What people decided');
    const { proposals } = (await output(
      registry.execute(person, 'proposals.list', { status: 'pending' }),
    )) as { proposals: { id: string }[] };
    await registry.execute(person, 'proposals.reject', {
      id: proposals[0]?.id as string,
      reason: 'Keep the vendor name',
    });
    await ask(registry, assistant, 'Try again', { conversationId: first.id });
    const system = systems.at(-1) ?? '';
    expect(system).toContain('What people decided about the changes you proposed');
    expect(system).toContain('records.update (Clearer name): rejected: "Keep the vendor name"');
    // Another conversation hears nothing of it.
    await ask(registry, assistant, 'Hello');
    expect(systems.at(-1)).not.toContain('Keep the vendor name');
  });

  it('tells the model which values it filled a person changed since, as possible lab memory', async () => {
    const scripted = new ScriptedModel();
    const systems: string[] = [];
    const model: ChatModel = {
      provider: 'scripted',
      model: 'scripted',
      complete: (request) => {
        systems.push(request.system);
        return scripted.complete(request);
      },
    };
    const { assistant, registry } = setup(model);
    const first = await ask(
      registry,
      assistant,
      `/op records.create ${JSON.stringify({ kind: 'widget', label: 'Stock', attributes })}`,
    );
    const {
      records: [record],
    } = (await output(registry.execute(person, 'records.list', { kind: 'widget' }))) as {
      records: RecordEnvelope[];
    };
    if (!record) throw new Error('The assistant made no widget');
    await registry.execute(person, 'records.update', {
      id: record.id,
      expectedVersion: record.version,
      attributes: { ...attributes, color: 'amber' },
    });
    await ask(registry, assistant, 'Again', { conversationId: first.id });
    const system = systems.at(-1) ?? '';
    expect(system).toContain(
      'Values you filled in this conversation that a person has since changed',
    );
    expect(system).toContain('color: you filled "teal"; a person changed it to "amber"');
  });

  it('gives the model the lab-wide memories and keeps them on its final reply', async () => {
    const model = new FakeModel([
      { text: '', toolCalls: [{ id: 'a', name: 'records_list', input: {} }], stop: 'tool_use' },
      { text: 'Done.', toolCalls: [], stop: 'end' },
    ]);
    const { assistant, registry } = setup(model);
    const memory = (await output(
      registry.execute(person, 'memory.remember', {
        statement: 'Seal plates before they leave the bench',
        kind: 'convention',
        strength: 'rule',
        source: { from: 'stated' },
      }),
    )) as RecordEnvelope;
    const conversation = await ask(registry, assistant, 'List my records');
    expect(model.requests[0]?.system).toContain('Seal plates before they leave the bench');
    const replies = conversation.messages.filter((m) => m.role === 'assistant');
    expect(replies[0]?.memory).toBeUndefined();
    expect(replies[1]?.memory).toEqual([
      {
        id: memory.id,
        name: memory.name,
        statement: 'Seal plates before they leave the bench',
        strength: 'rule',
      },
    ]);
  });

  it('continues a conversation with the history so far', async () => {
    const model = new FakeModel([
      { text: 'Hello.', toolCalls: [], stop: 'end' },
      { text: 'Still here.', toolCalls: [], stop: 'end' },
    ]);
    const { assistant, registry } = setup(model);
    const first = await ask(registry, assistant, 'Hi');
    const second = await ask(registry, assistant, 'Again', { conversationId: first.id });
    expect(second.id).toBe(first.id);
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(model.requests[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(model.requests[1]?.system).toContain('Wali in Bench 3');
  });

  it('persists commentary and raw history, stays running, then runs a tool and finishes', async () => {
    let release: (turn: ModelTurn) => void = () => undefined;
    const raw = { output: [{ type: 'message', phase: 'commentary', text: 'Checking.' }] };
    const model = new FakeModel([
      { text: 'Checking.', toolCalls: [], stop: 'continue', raw },
      {
        text: '',
        toolCalls: [
          {
            id: 'create',
            name: 'records_create',
            input: { kind: 'widget', label: 'Made', attributes },
          },
        ],
        stop: 'tool_use',
      },
      () => new Promise<ModelTurn>((resolve) => (release = resolve)),
    ]);
    const { assistant, registry } = setup(model);
    const result = await registry.execute(person, 'assistant.ask', { message: 'Make a widget' });
    const { id } = (result as { output: ConversationSummary }).output;
    await expect.poll(() => model.requests.length).toBe(3);
    expect((await getConversation(db, person, id)).status).toBe('running');
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Checking.',
      raw,
    });
    expect(model.requests[2]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'create',
      isError: false,
    });
    expect((await messageRows(db, id))[1]?.providerRaw).toEqual(raw);
    release({ text: 'Made it.', toolCalls: [], stop: 'end' });
    await assistant.wait(id);
    const conversation = await getConversation(db, person, id);
    expect(conversation.status).toBe('idle');
    expect(conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
      records: [expect.objectContaining({ label: 'Made' })],
    });
  });

  it('bounds repeated commentary by the existing step limit', async () => {
    const model = new FakeModel(
      Array.from({ length: MAX_STEPS + 1 }, () => ({
        text: 'Still checking.',
        toolCalls: [],
        stop: 'continue',
      })),
    );
    const { assistant, registry } = setup(model);
    const conversation = await ask(registry, assistant, 'Check forever');
    expect(model.requests).toHaveLength(MAX_STEPS + 1);
    expect(model.requests.at(-1)?.tools).toEqual([]);
    expect(conversation.status).toBe('failed');
    expect(conversation.messages.at(-1)).toMatchObject({
      text: expect.stringContaining(`limit of ${MAX_STEPS}`),
    });
  });

  it.each(['refusal', 'max_tokens'] as const)(
    'does not execute valid tool calls from a %s turn with text',
    async (stop) => {
      const model = new FakeModel([
        {
          text: 'This looks complete.',
          toolCalls: [
            {
              id: 'unsafe',
              name: 'records_create',
              input: { kind: 'widget', label: 'Must not create', attributes },
            },
          ],
          stop,
          raw: { stop },
        },
      ]);
      const { assistant, registry } = setup(model);
      const conversation = await ask(registry, assistant, 'Make a widget');
      expect(model.requests).toHaveLength(1);
      expect(conversation.status).toBe(stop === 'refusal' ? 'idle' : 'failed');
      expect(conversation.messages[1]).toMatchObject({
        role: 'assistant',
        text: 'This looks complete.',
      });
      expect(conversation.messages[2]).toMatchObject({
        role: 'tool',
        toolCallId: 'unsafe',
        outcome: 'failed',
        error: { code: 'invalid_state', message: expect.stringContaining('not executed') },
      });
      expect(conversation.messages.at(-1)).toMatchObject({
        role: 'assistant',
        text: expect.stringContaining(stop === 'refusal' ? 'declined' : 'cut off'),
      });
      expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
        records: [],
      });
      await ask(registry, assistant, 'Try again', { conversationId: conversation.id });
      expect(
        model.requests[1]?.messages.filter(
          (message) => message.role === 'tool' && message.toolCallId === 'unsafe',
        ),
      ).toHaveLength(1);
    },
  );

  it('reports refused tool calls back to the model and keeps going', async () => {
    const model = new FakeModel([
      {
        text: '',
        toolCalls: [
          {
            id: 'a',
            name: 'records_create',
            input: { kind: 'widget', label: 'X', attributes: {} },
          },
          { id: 'b', name: 'no_such_tool', input: {} },
          { id: 'c', name: 'records_list', input: undefined, rawInput: '{oops' },
        ],
        stop: 'tool_use',
      },
      { text: 'I need a color and a volume.', toolCalls: [], stop: 'end' },
    ]);
    const { assistant, registry } = setup(model);
    const conversation = await ask(registry, assistant, 'Make a widget');
    const tools = conversation.messages.filter((m) => m.role === 'tool');
    expect(tools.map((m) => [m.outcome, m.error?.code])).toEqual([
      ['failed', 'invalid_attributes'],
      ['failed', 'unknown_operation'],
      ['failed', 'invalid_input'],
    ]);
    const results = model.requests[1]?.messages.filter((m) => m.role === 'tool');
    expect(results?.every((m) => m.role === 'tool' && m.isError)).toBe(true);
    expect(conversation.status).toBe('idle');
  });

  it('marks the conversation failed when the model fails, and can be asked again', async () => {
    const model = new FakeModel([
      new ModelError('openrouter refused the request: Insufficient credits'),
      { text: 'Back.', toolCalls: [], stop: 'end' },
    ]);
    const { assistant, registry } = setup(model);
    const failed = await ask(registry, assistant, 'Hi');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('openrouter refused the request: Insufficient credits');
    const again = await ask(registry, assistant, 'Hi again', { conversationId: failed.id });
    expect(again.status).toBe('idle');
    expect(again.error).toBeUndefined();
  });

  it('reports a Responses deadline and can continue the failed conversation', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(5));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const fetch = (async (_url, init) => {
      if (++calls === 1) {
        const signal = init?.signal;
        if (!signal) throw new Error('Missing model deadline');
        return new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Back.' }],
            },
          ],
        }),
      );
    }) as typeof globalThis.fetch;
    try {
      const model = new OpenAiResponsesModel({
        provider: 'openai-compatible',
        baseUrl: 'https://example.org/v1',
        model: 'test',
        apiKey: 'sk-test-secret',
        fetch,
      });
      const { assistant, registry } = setup(model);
      const failed = await ask(registry, assistant, 'Hi');
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('The model did not answer within 180 seconds.');
      deadline.mockRestore();
      const again = await ask(registry, assistant, 'Hi again', { conversationId: failed.id });
      expect(again.status).toBe('idle');
      expect(again.error).toBeUndefined();
      expect(again.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Back.' });
      expect(calls).toBe(2);
    } finally {
      deadline.mockRestore();
      log.mockRestore();
    }
  });

  it(`summarizes saved and failed outcomes after ${MAX_STEPS} action turns without extending execution`, async () => {
    const raw = { summary: 'provider reply' };
    const summaryText =
      'Saved the draft. One call failed; scientific questions and remaining work still need review.';
    const turns: ModelTurn[] = Array.from({ length: MAX_STEPS }, (_, index) => ({
      text: '',
      toolCalls: [
        {
          id: `call_${index}`,
          name: index === 0 ? 'records_create' : index === 1 ? 'unknown_operation' : 'records_list',
          input: index === 0 ? { kind: 'widget', label: 'Saved before limit', attributes } : {},
        },
      ],
      stop: 'tool_use',
    }));
    turns.push({
      text: summaryText,
      toolCalls: [],
      stop: 'end',
      raw,
    });
    const model = new FakeModel(turns);
    const { assistant, registry } = setup(model);
    const execute = vi.spyOn(registry, 'execute');
    const conversation = await ask(registry, assistant, 'Create a draft and investigate');
    expect(conversation.status).toBe('failed');
    expect(conversation.error).toBe(
      'The assistant action limit was reached; completed changes remain saved.',
    );
    expect(model.requests).toHaveLength(MAX_STEPS + 1);
    expect(model.requests.slice(0, MAX_STEPS).every((request) => request.tools.length > 0)).toBe(
      true,
    );
    const summary = model.requests.at(-1);
    expect(summary?.tools).toEqual([]);
    expect(summary?.system).toContain('ONLY a final read-only summary');
    expect(summary?.system).toContain(
      'failed or not-executed calls, unresolved scientific questions',
    );
    expect(summary?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: `call_${MAX_STEPS - 1}`,
      isError: false,
      content: expect.stringContaining('Saved before limit'),
    });
    expect(summary?.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'call_1', isError: true }),
    );
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: summaryText,
      toolCalls: [],
    });
    expect((await messageRows(db, conversation.id)).at(-1)?.providerRaw).toEqual(raw);
    expect(
      execute.mock.calls.filter(([, operation]) => operation === 'records.create'),
    ).toHaveLength(1);
    expect(execute.mock.calls.filter(([, operation]) => operation === 'records.list')).toHaveLength(
      MAX_STEPS - 2,
    );
    execute.mockRestore();
    expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
      records: [expect.objectContaining({ label: 'Saved before limit', version: 1 })],
    });
  });

  it('shows the committed late write in an action-limit summary after a long earlier read', async () => {
    const model = new FakeModel(
      Array.from(
        { length: MAX_STEPS - 1 },
        (): ModelTurn => ({ text: '', toolCalls: [], stop: 'continue' }),
      ),
    );
    const { assistant, registry } = setup(model);
    let record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'widget',
        label: 'Earlier',
        attributes,
      }),
    )) as RecordEnvelope;
    for (let version = 1; version < 6; version++) {
      record = (await output(
        registry.execute(person, 'records.update', {
          id: record.id,
          expectedVersion: version,
          label: `Earlier ${'x'.repeat(32_000)}`,
        }),
      )) as RecordEnvelope;
    }
    expect(record.version).toBe(6);
    model.turns.push({
      text: '',
      toolCalls: [
        {
          id: 'batch67',
          name: 'changes_apply',
          input: {
            steps: [
              { operation: 'records.get', input: { id: record.id } },
              {
                operation: 'records.update',
                input: { id: record.id, expectedVersion: 6, label: 'Saved at v7' },
              },
            ],
          },
        },
      ],
      stop: 'tool_use',
    });
    model.turns.push({
      text: 'Saved the v7 edit; inspect its contents before scientific use.',
      toolCalls: [],
      stop: 'end',
    });
    const conversation = await ask(registry, assistant, 'Read and edit the widget');
    const stored = conversation.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'batch67',
    );
    expect(stored).toMatchObject({ outcome: 'done', result: { status: 'done' } });
    if (stored?.role !== 'tool') throw new Error('Missing stored result');
    const results = (stored.result as { output: { results: { output: RecordEnvelope }[] } }).output
      .results;
    expect(results[0]?.output).toMatchObject({ id: record.id, version: 6 });
    expect(results[0]?.output.label.length).toBeGreaterThan(32_000);
    expect(results[1]?.output).toMatchObject({ id: record.id, version: 7, label: 'Saved at v7' });
    const summary = model.requests.at(-1);
    expect(summary?.tools).toEqual([]);
    const replay = summary?.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'batch67',
    );
    if (replay?.role !== 'tool') throw new Error('Missing model replay');
    expect(replay.content.length).toBeLessThanOrEqual(30_000);
    expect(replay.content).toContain('"operation":"records.update","step":2');
    expect(replay.content).toContain('"version":7,"status":"draft"');
    expect(replay.content).not.toContain('"operation":"records.get","step":1');
    expect(replay.content).toContain('record contents and readiness not verified');
    expect(await output(registry.execute(person, 'records.get', { id: record.id }))).toMatchObject({
      version: 7,
    });
  });

  it('pauses for a proposal on the last action turn without requesting a summary', async () => {
    const model = new FakeModel(
      Array.from(
        { length: MAX_STEPS - 1 },
        (): ModelTurn => ({ text: 'Investigating.', toolCalls: [], stop: 'continue' }),
      ),
    );
    const { assistant, registry } = setup(model);
    const record = (await output(
      registry.execute(person, 'records.create', {
        kind: 'widget',
        label: 'Active stock',
        attributes,
        status: 'active',
      }),
    )) as RecordEnvelope;
    model.turns.push({
      text: 'Prepared a change.',
      toolCalls: [
        {
          id: 'proposal',
          name: 'records_update',
          input: { id: record.id, expectedVersion: record.version, label: 'Proposed stock' },
        },
        {
          id: 'later',
          name: 'records_create',
          input: { kind: 'widget', label: 'Must not save', attributes },
        },
      ],
      stop: 'tool_use',
    });
    const conversation = await ask(registry, assistant, 'Change the stock');
    expect(model.requests).toHaveLength(MAX_STEPS);
    expect(model.requests.every((request) => request.tools.length > 0)).toBe(true);
    expect(conversation.status).toBe('idle');
    expect(conversation.messages.at(-1)).toMatchObject({
      text: expect.stringContaining('ready for your review'),
    });
    expect(conversation.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'proposal', outcome: 'proposed' }),
    );
    expect(conversation.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'later', outcome: 'failed' }),
    );
    expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
      records: [expect.objectContaining({ label: 'Active stock', version: 1 })],
    });
  });

  it.each([
    ['exception', new ModelError('Provider diagnostic must not appear')],
    ['timeout', new DOMException('Provider diagnostic must not appear', 'TimeoutError')],
    ['empty', { text: '  ', toolCalls: [], stop: 'end' }],
    ['refusal', { text: 'Discard this answer', toolCalls: [], stop: 'refusal' }],
    ['truncated', { text: 'Discard this answer', toolCalls: [], stop: 'max_tokens' }],
    ['commentary', { text: 'Discard this answer', toolCalls: [], stop: 'continue' }],
    [
      'tool use',
      {
        text: 'Discard this answer',
        toolCalls: [
          {
            id: 'forbidden',
            name: 'records_create',
            input: { kind: 'widget', label: 'Must not save', attributes },
          },
        ],
        stop: 'tool_use',
      },
    ],
    [
      'final with call',
      {
        text: 'Discard this answer',
        toolCalls: [
          {
            id: 'forbidden',
            name: 'records_create',
            input: { kind: 'widget', label: 'Must not save', attributes },
          },
        ],
        stop: 'end',
      },
    ],
  ] satisfies [string, ModelTurn | Error][])(
    'uses the deterministic action-limit fallback for %s without execution or retry',
    async (_case, summary) => {
      const model = new FakeModel([
        ...Array.from(
          { length: MAX_STEPS },
          (): ModelTurn => ({ text: 'Still investigating.', toolCalls: [], stop: 'continue' }),
        ),
        summary,
      ]);
      const { assistant, registry } = setup(model);
      const conversation = await ask(registry, assistant, 'Investigate');
      expect(model.requests).toHaveLength(MAX_STEPS + 1);
      expect(model.requests.at(-1)?.tools).toEqual([]);
      expect(conversation.status).toBe('failed');
      expect(conversation.error).toBe(
        'The assistant action limit was reached; completed changes remain saved.',
      );
      expect(conversation.messages.at(-1)).toMatchObject({
        role: 'assistant',
        toolCalls: [],
        text: `I reached the action limit of ${MAX_STEPS} turns. Completed changes remain saved. Review the saved work and unresolved questions before sending a new request.`,
      });
      expect(conversation.messages).not.toContainEqual(
        expect.objectContaining({ text: 'Discard this answer' }),
      );
      expect((await messageRows(db, conversation.id)).at(-1)?.providerRaw).toBeNull();
      expect(await output(registry.execute(person, 'records.list', {}))).toMatchObject({
        records: [],
      });
    },
  );

  it('refuses a new message while the last one is being answered', async () => {
    let release: (turn: ModelTurn) => void = () => undefined;
    const model = new FakeModel([() => new Promise<ModelTurn>((resolve) => (release = resolve))]);
    const { assistant, registry } = setup(model);
    const result = await registry.execute(person, 'assistant.ask', { message: 'Slow' });
    const { id } = (result as { output: ConversationSummary }).output;
    await expect.poll(() => model.requests.length).toBe(1);
    const error = await refused(
      registry.execute(person, 'assistant.ask', { message: 'Hurry', conversationId: id }),
    );
    expect(error.code).toBe('invalid_state');
    release({ text: 'Done.', toolCalls: [], stop: 'end' });
    await assistant.wait(id);
  });

  it('passes an attached file to a tool by reference, never through the reply', async () => {
    const { assistant, registry } = setup();
    const file = {
      name: 'widget.json',
      mediaType: 'application/json',
      text: JSON.stringify({ color: 'amber', volume: { value: '75', unit: 'uL' } }),
    };
    const conversation = await ask(
      registry,
      assistant,
      '/op records.create {"kind": "widget", "label": "From a file", "attributes": {"$file": "$attached"}}',
      { attachments: [file] },
    );
    const [asked] = conversation.messages;
    expect(asked).toMatchObject({
      role: 'user',
      attachments: [{ ...file, id: expect.stringMatching(/^file_/) }],
    });
    const done = conversation.messages.find((m) => m.role === 'tool');
    expect(done).toMatchObject({
      outcome: 'done',
      result: { output: { attributes: { color: 'amber', volume: { value: '75' } } } },
    });

    const { entries } = (await output(registry.execute(person, 'activity.list', { limit: 5 }))) as {
      entries: { operationId: string; input: unknown }[];
    };
    expect(entries.find((e) => e.operationId === 'assistant.ask')?.input).toMatchObject({
      attachments: [{ name: 'widget.json', characters: file.text.length }],
    });

    const empty = await refused(
      registry.execute(person, 'assistant.ask', { message: '', attachments: [] }),
    );
    expect(empty).toMatchObject({ code: 'invalid_input' });
  });

  it('shows the model an attached file by reference and preview', () => {
    const text = describeAttachment({
      id: 'file_abc',
      name: 'big.csv',
      mediaType: 'text/csv',
      text: 'x'.repeat(5000),
    });
    expect(text).toContain('{"$file": "file_abc"}');
    expect(text).toContain('[1000 more characters]');
  });

  it('rejects invalid input', async () => {
    const { registry } = setup();
    expect((await refused(registry.execute(person, 'assistant.ask', { message: '  ' }))).code).toBe(
      'invalid_input',
    );
    expect(
      (
        await refused(
          registry.execute(person, 'assistant.ask', { message: 'x', conversationId: 'cnv_1' }),
        )
      ).code,
    ).toBe('invalid_input');
  });

  it('is for people only, and only for their own conversations', async () => {
    const { assistant, registry } = setup();
    const agent: RecordContext = {
      ...person,
      actor: {
        type: 'agent',
        agentName: 'Claude',
        onBehalfOf: (person.actor as { userId: string }).userId,
      },
    };
    expect((await refused(registry.execute(agent, 'assistant.ask', { message: 'Hi' }))).code).toBe(
      'forbidden',
    );
    const mine = await ask(registry, assistant, 'Mine');
    expect(
      (await refused(registry.execute(other, 'assistant.get_conversation', { id: mine.id }))).code,
    ).toBe('not_found');
    expect(
      (
        await refused(
          registry.execute(other, 'assistant.ask', { message: 'Hi', conversationId: mine.id }),
        )
      ).code,
    ).toBe('not_found');
    const { conversations } = (await output(
      registry.execute(other, 'assistant.list_conversations', {}),
    )) as {
      conversations: unknown[];
    };
    expect(conversations).toEqual([]);
    // An agent working for the same person can read the person's conversations.
    const listed = (await output(registry.execute(agent, 'assistant.list_conversations', {}))) as {
      conversations: { id: string }[];
    };
    expect(listed.conversations.map((c) => c.id)).toEqual([mine.id]);
  });

  it('says what to set up when there is no model', async () => {
    const { registry } = setup(null);
    const error = await refused(registry.execute(person, 'assistant.ask', { message: 'Hi' }));
    expect(error.code).toBe('invalid_state');
    expect(error.message).toContain('AGENT_PROVIDER is not set in .env');
    expect(await output(registry.execute(person, 'assistant.status', {}))).toEqual({
      configured: false,
      reason: 'AGENT_PROVIDER is not set in .env',
    });
  });
});

describe('tools and history', () => {
  it('keeps receipts limited to completed record writes and bounds crowded receipts', async () => {
    const conversation = await createConversation(db, person, {
      title: 'Receipt replay',
      agentName: 'Test assistant',
      provider: 'fake',
      model: 'fake-1',
    });
    const record = (version: number, label = 'x'.repeat(40_000)) => ({
      id: 'wdg_123',
      kind: 'widget',
      name: 'W-001',
      label,
      version,
      status: 'draft',
    });
    const cases = [
      {
        operationId: 'records.get',
        outcome: 'done' as const,
        result: { status: 'done', output: record(6) },
      },
      {
        operationId: 'records.update',
        outcome: 'proposed' as const,
        result: { status: 'proposed', output: record(7) },
      },
      {
        operationId: 'records.update',
        outcome: 'failed' as const,
        result: { status: 'done', output: record(7) },
      },
      {
        operationId: 'records.update',
        outcome: 'preview' as const,
        result: { status: 'preview', output: record(7) },
      },
      {
        operationId: 'changes.apply',
        outcome: 'done' as const,
        result: {
          status: 'done',
          output: {
            results: [
              { operation: 'records.get', output: record(6) },
              ...Array.from({ length: 49 }, (_, index) => ({
                operation: 'records.update',
                output: record(index + 7, `${index}-${'L'.repeat(40_000)}`),
              })),
            ],
          },
        },
      },
    ];
    for (const [index, item] of cases.entries())
      await appendMessage(db, conversation.id, {
        role: 'tool',
        toolCallId: `case-${index}`,
        ...item,
      });
    const rows = await messageRows(db, conversation.id);
    const replay = toModelMessages(rows, new FakeModel([])).filter(
      (message) => message.role === 'tool',
    );
    for (const item of replay.slice(0, 4)) {
      expect(item.content.length).toBeLessThanOrEqual(30_000);
      expect(item.content).not.toContain('Historical completed record writes');
    }
    const crowded = replay[4];
    if (crowded?.role !== 'tool') throw new Error('Missing batch replay');
    expect(crowded.content.length).toBeLessThanOrEqual(30_000);
    expect(crowded.content).toContain('"operation":"records.update","step":2');
    expect(crowded.content).not.toContain('"operation":"records.get","step":1');
    const metadata = crowded.content.match(
      /^\[Historical completed record writes.*?: (\{.*\})\]\n/,
    )?.[1];
    if (!metadata) throw new Error('Missing bounded receipt metadata');
    const receipt = JSON.parse(metadata) as {
      writes: unknown[];
      omittedWrites: number;
      shortenedFields: number;
    };
    expect(receipt.writes.length).toBeGreaterThan(0);
    expect(receipt.omittedWrites).toBeGreaterThan(0);
    expect(receipt.writes.length + receipt.omittedWrites).toBe(49);
    expect(receipt.shortenedFields).toBe(49);
    const saved = rows[4]?.body;
    if (saved?.role !== 'tool') throw new Error('Missing stored batch');
    expect(
      (saved.result as { output: { results: { output: { label: string } }[] } }).output.results[49]
        ?.output.label.length,
    ).toBeGreaterThan(40_000);
  });

  it('identifies the existing campaigns skill in run-list and run-record model context', async () => {
    const skill = findSkill('campaigns');
    if (!skill) throw new Error('Expected the owning campaigns skill');
    expect(findSkill('runs')).toBeUndefined();
    for (const path of ['/runs', `/records/${newId('run')}`]) {
      const model = new FakeModel([
        async () => {
          const input = model.requests[0]?.system.match(/skills_get with (\{[^}]+\})/)?.[1];
          if (!input) throw new Error('Expected exact owning-skill arguments in model context');
          return {
            text: '',
            toolCalls: [{ id: 'read-skill', name: 'skills_get', input: JSON.parse(input) }],
            stop: 'tool_use',
          };
        },
      ]);
      const { assistant, registry } = setup(model);
      registry.deps.kinds.register(run);
      const conversation = await ask(
        registry,
        assistant,
        'Read the saved run instructions without changing records.',
        {
          page: { path },
        },
      );
      expect(model.requests[0]?.system).toContain(
        `Skills for this page: ${skill.module} (${skill.name}).`,
      );
      expect(model.requests[0]?.system).not.toContain('sops (ailab-sops)');
      expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain('runs_record_step');
      expect(conversation.messages.find((message) => message.role === 'tool')).toMatchObject({
        operationId: 'skills.get',
        outcome: 'done',
        result: { output: { module: skill.module, name: skill.name } },
      });
    }
    const model = new FakeModel([]);
    const { assistant, registry } = setup(model);
    await ask(registry, assistant, 'What is next?', { page: { path: '/today' } });
    expect(model.requests[0]?.system).not.toContain('Skills for this page:');
  });
  it('names a small core, the calculators and the page module, and runs the rest by ID', () => {
    const { registry } = setup();
    const names = toolsFor(registry).list.map((t) => t.name);
    expect(names).toContain('records_create');
    expect(names).toContain('records_kinds');
    expect(names).toContain('skills_get');
    expect(names).toContain('operations_describe');
    expect(names).toContain('sops_evaluate');
    expect(names).toContain('run_operation');
    expect(names).toContain('proposals_list');
    expect(names).toContain('changes_apply');
    expect(names).not.toContain('sops_draft');
    expect(names).not.toContain('proposals_approve');
    expect(names.some((n) => n.startsWith('assistant_'))).toBe(false);
    const onSops = toolsFor(registry, ['sops']).list.map((t) => t.name);
    expect(onSops).toContain('sops_draft');
    expect(names.length).toBeLessThan(onSops.length);
  });

  it('runs other operations through run_operation, recorded under their own ID', async () => {
    const model = new FakeModel([
      {
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'run_operation',
            input: { operation: 'proposals.list', input: { status: 'pending' } },
          },
          {
            id: 't2',
            name: 'run_operation',
            input: { operation: 'proposals.approve', input: { id: 'prp_x' } },
          },
        ],
        stop: 'tool_use',
      },
      { text: 'Nothing pending.', toolCalls: [], stop: 'end' },
    ]);
    const { assistant, registry } = setup(model);
    const conversation = await ask(registry, assistant, 'Anything proposed?', {
      page: { path: '/sops' },
    });
    const steps = conversation.messages.filter((m) => m.role === 'tool');
    expect(steps.map((m) => [m.operationId, m.outcome])).toEqual([
      ['proposals.list', 'done'],
      ['proposals.approve', 'failed'],
    ]);
    // The page's module is named; the calls replay as run_operation, since proposals isn't.
    const second = model.requests[1];
    expect(second?.tools.map((t) => t.name)).toContain('sops_draft');
    expect(second?.tools.map((t) => t.name)).toContain('proposals_list');
  });

  it('replays a reply in its original form only to the same model, and answers cut-off calls', async () => {
    const { assistant, registry } = setup(
      new FakeModel([
        {
          text: 'Looking.',
          toolCalls: [{ id: 't1', name: 'records_list', input: {} }],
          stop: 'tool_use',
          raw: [{ type: 'thinking', thinking: '', signature: 'sig' }],
        },
        { text: 'None yet.', toolCalls: [], stop: 'end' },
      ]),
    );
    const conversation = await ask(registry, assistant, 'Any widgets?');
    const rows = await messageRows(db, conversation.id);
    const same = toModelMessages(rows, {
      provider: 'fake',
      model: 'fake-1',
      complete: async () => ({ text: '', toolCalls: [], stop: 'end' }),
    });
    expect(same[1]).toMatchObject({ role: 'assistant', raw: [{ type: 'thinking' }] });
    const different = toModelMessages(rows, {
      provider: 'fake',
      model: 'fake-2',
      complete: async () => ({ text: '', toolCalls: [], stop: 'end' }),
    });
    expect(different[1]).not.toHaveProperty('raw');

    // Drop the tool result, as if the API stopped mid-run: the call still gets an answer.
    const cut = rows.filter((r) => r.role !== 'tool');
    const replayed = toModelMessages(cut, {
      provider: 'x',
      model: 'y',
      complete: async () => ({ text: '', toolCalls: [], stop: 'end' }),
    });
    expect(replayed[2]).toMatchObject({ role: 'tool', toolCallId: 't1', isError: true });
  });
});

import { newId } from '@ailab/domain';
import type {
  Actor,
  Conversation,
  ConversationSummary,
  OperationResult,
  RecordEnvelope,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createTestDb } from '../db/testing.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { widget } from '../records/test-kinds.ts';
import {
  Assistant,
  describeAttachment,
  MAX_STEPS,
  toModelMessages,
  toolsFor,
} from './assistant.ts';
import { type ChatModel, ModelError, type ModelRequest, type ModelTurn } from './model.ts';
import { ScriptedModel } from './scripted.ts';
import { messageRows } from './store.ts';

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
    new KindRegistry().register(widget),
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

  it(`stops after ${MAX_STEPS} steps`, async () => {
    const loop = (): Promise<ModelTurn> =>
      Promise.resolve({
        text: '',
        toolCalls: [{ id: newId('call'), name: 'records_list', input: {} }],
        stop: 'tool_use',
      });
    const model = new FakeModel(Array.from({ length: MAX_STEPS + 2 }, () => loop));
    const { assistant, registry } = setup(model);
    const conversation = await ask(registry, assistant, 'List forever');
    expect(conversation.status).toBe('failed');
    expect(model.requests).toHaveLength(MAX_STEPS);
  });

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
  it('offers every operation an agent may call, and nothing else', () => {
    const { registry } = setup();
    const names = toolsFor(registry).list.map((t) => t.name);
    expect(names).toContain('records_create');
    expect(names).toContain('records_kinds');
    expect(names).toContain('proposals_list');
    expect(names).not.toContain('proposals_approve');
    expect(names.some((n) => n.startsWith('assistant_'))).toBe(false);
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

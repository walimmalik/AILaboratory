import { describe, expect, it } from 'vitest';
import { AnthropicModel } from './anthropic.ts';
import { modelFromEnv } from './config.ts';
import { ModelError, type ModelRequest } from './model.ts';
import { OpenAiCompatibleModel } from './openai-compatible.ts';

const request: ModelRequest = {
  system: 'You are the lab assistant.',
  tools: [
    {
      name: 'records_get',
      description: 'Read a record by ID. Read only.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
  messages: [
    { role: 'user', text: 'What is WDG-0001?' },
    {
      role: 'assistant',
      text: 'Looking it up.',
      toolCalls: [{ id: 'call_1', name: 'records_get', input: { id: 'wdg_1' } }],
    },
    {
      role: 'tool',
      toolCallId: 'call_1',
      name: 'records_get',
      content: '{"status":"done"}',
      isError: false,
    },
  ],
};

/** A fetch that records what was sent and answers with `reply`. */
function fakeFetch(reply: unknown, status = 200) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

describe('OpenAI-compatible (OpenRouter)', () => {
  const make = (fetch: typeof globalThis.fetch) =>
    new OpenAiCompatibleModel({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      model: 'deepseek/deepseek-chat',
      headers: { 'X-Title': 'AILaboratory' },
      fetch,
    });

  it('sends the chat-completions format and reads tool calls back', async () => {
    const { fetch, sent } = fakeFetch({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'records_get', arguments: '{"id":"wdg_2"}' },
              },
              {
                id: 'call_3',
                type: 'function',
                function: { name: 'records_get', arguments: '{bad' },
              },
            ],
          },
        },
      ],
    });
    const turn = await make(fetch).complete(request);

    const [call] = sent;
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.headers.get('authorization')).toBe('Bearer sk-test');
    expect(call?.headers.get('x-title')).toBe('AILaboratory');
    expect(call?.body.model).toBe('deepseek/deepseek-chat');
    expect(call?.body.messages).toEqual([
      { role: 'system', content: 'You are the lab assistant.' },
      { role: 'user', content: 'What is WDG-0001?' },
      {
        role: 'assistant',
        content: 'Looking it up.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'records_get', arguments: '{"id":"wdg_1"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"status":"done"}' },
    ]);
    expect(call?.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'records_get',
          description: 'Read a record by ID. Read only.',
          parameters: request.tools[0]?.inputSchema,
        },
      },
    ]);

    expect(turn.stop).toBe('tool_use');
    expect(turn.toolCalls).toEqual([
      { id: 'call_2', name: 'records_get', input: { id: 'wdg_2' } },
      { id: 'call_3', name: 'records_get', input: undefined, rawInput: '{bad' },
    ]);
  });

  it('reads a plain answer', async () => {
    const { fetch } = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'A teal widget.' } }],
    });
    expect(await make(fetch).complete(request)).toEqual({
      text: 'A teal widget.',
      toolCalls: [],
      stop: 'end',
    });
  });

  it.each([
    { finish_reason: 'length', refusal: undefined, stop: 'max_tokens' },
    { finish_reason: 'content_filter', refusal: undefined, stop: 'refusal' },
    { finish_reason: 'tool_calls', refusal: 'Cannot do that.', stop: 'refusal' },
  ])(
    'terminal $stop takes precedence over returned tool calls',
    async ({ finish_reason, refusal, stop }) => {
      const { fetch } = fakeFetch({
        choices: [
          {
            finish_reason,
            message: {
              content: null,
              refusal,
              tool_calls: [{ id: 'call_1', function: { name: 'records_get', arguments: '{}' } }],
            },
          },
        ],
      });
      const turn = await make(fetch).complete(request);
      expect(turn.stop).toBe(stop);
      expect(turn.toolCalls).toHaveLength(1);
    },
  );

  it("turns the provider's refusal into a message without the key", async () => {
    const { fetch } = fakeFetch({ error: { message: 'Insufficient credits' } }, 402);
    const error = await make(fetch)
      .complete(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as Error).message).toBe('openrouter refused the request: Insufficient credits');
    expect((error as Error).message).not.toContain('sk-test');
  });
});

describe('Anthropic', () => {
  const reply = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_2', name: 'records_get', input: { id: 'wdg_2' } },
    ],
  };

  it('sends tools, tool results and thinking back as Claude expects', async () => {
    const { fetch, sent } = fakeFetch(reply);
    const model = new AnthropicModel({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5', fetch });
    const withRaw: ModelRequest = {
      ...request,
      messages: request.messages.map((m) =>
        m.role === 'assistant'
          ? {
              ...m,
              raw: [
                { type: 'thinking', thinking: '', signature: 'old' },
                { type: 'text', text: 'Looking it up.' },
                { type: 'tool_use', id: 'call_1', name: 'records_get', input: { id: 'wdg_1' } },
              ],
            }
          : m,
      ),
    };
    const turn = await model.complete(withRaw);

    const [call] = sent;
    expect(call?.url).toContain('/v1/messages');
    expect(call?.headers.get('x-api-key')).toBe('sk-ant-test');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call?.body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'You are the lab assistant.',
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      tools: [{ name: 'records_get', input_schema: request.tools[0]?.inputSchema }],
    });
    expect(call?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What is WDG-0001?' }] },
      {
        role: 'assistant',
        content: withRaw.messages[1]?.role === 'assistant' ? withRaw.messages[1].raw : [],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"status":"done"}' }],
      },
    ]);

    expect(turn).toEqual({
      text: 'Checking.',
      toolCalls: [{ id: 'toolu_2', name: 'records_get', input: { id: 'wdg_2' } }],
      stop: 'tool_use',
      raw: reply.content,
    });
  });

  it("builds Claude turns from another model's replies, and skips fallbacks where unsupported", async () => {
    const { fetch, sent } = fakeFetch({ ...reply, stop_reason: 'refusal', content: [] });
    const model = new AnthropicModel({ apiKey: 'k', model: 'claude-haiku-4-5', fetch });
    const turn = await model.complete(request);
    expect(sent[0]?.body).not.toHaveProperty('fallbacks');
    const messages = sent[0]?.body.messages as unknown[] | undefined;
    expect(messages?.[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking it up.' },
        { type: 'tool_use', id: 'call_1', name: 'records_get', input: { id: 'wdg_1' } },
      ],
    });
    expect(turn.stop).toBe('refusal');
  });

  it('reports API errors plainly', async () => {
    const { fetch } = fakeFetch(
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      401,
    );
    const model = new AnthropicModel({ apiKey: 'k', model: 'claude-opus-5-5', fetch });
    const error = await model.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as Error).message).toContain('Anthropic refused the request (401)');
  });
});

describe('modelFromEnv', () => {
  it('sets up OpenRouter with a default model and a short agent name', () => {
    const setup = modelFromEnv({ AGENT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or' });
    expect('model' in setup && [setup.model.provider, setup.model.model, setup.agentName]).toEqual([
      'openrouter',
      'deepseek/deepseek-chat',
      'deepseek-chat',
    ]);
  });

  it('asks OpenRouter for providers in the order given, falling back to others', async () => {
    const { fetch, sent } = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
    });
    const setup = modelFromEnv({
      AGENT_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or',
      AGENT_MODEL: 'z-ai/glm-5.3-flash',
      AGENT_PROVIDER_ORDER: 'fireworks, atlas-cloud/fp8,together',
    });
    if (!('model' in setup)) throw new Error(setup.reason);
    const original = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      await setup.model.complete(request);
    } finally {
      globalThis.fetch = original;
    }
    expect(sent[0]?.body.provider).toEqual({
      order: ['fireworks', 'atlas-cloud/fp8', 'together'],
      allow_fallbacks: true,
    });
  });

  it('says what is missing', () => {
    expect(modelFromEnv({})).toEqual({ reason: 'AGENT_PROVIDER is not set in .env' });
    expect(modelFromEnv({ AGENT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: ' ' })).toEqual({
      reason: 'OPENROUTER_API_KEY is empty in .env',
    });
    expect(modelFromEnv({ AGENT_PROVIDER: 'scripted' })).toMatchObject({
      reason: expect.stringContaining('tests only'),
    });
    expect(modelFromEnv({ AGENT_PROVIDER: 'gpt' })).toMatchObject({
      reason: expect.stringContaining('not supported'),
    });
  });

  it('uses Claude by name, and AGENT_NAME when given', () => {
    const claude = modelFromEnv({ AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    expect('model' in claude && [claude.model.model, claude.agentName]).toEqual([
      'claude-opus-5-5',
      'Claude',
    ]);
    const named = modelFromEnv({
      AGENT_PROVIDER: 'openai-compatible',
      AGENT_BASE_URL: 'http://localhost:11434/v1',
      AGENT_MODEL: 'qwen3',
      AGENT_NAME: 'Bench helper',
    });
    expect('model' in named && named.agentName).toBe('Bench helper');
  });
});

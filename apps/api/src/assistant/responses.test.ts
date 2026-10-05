import { describe, expect, it } from 'vitest';
import { ModelError, type ModelRequest } from './model.ts';
import { OpenAiResponsesModel } from './responses.ts';

const request: ModelRequest = {
  system: 'You are the lab assistant.',
  messages: [{ role: 'user', text: 'Read the widget.' }],
  tools: [
    {
      name: 'records_get',
      description: 'Read a record.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, detail: { type: 'boolean' } },
        required: ['id'],
      },
    },
  ],
};

const call = {
  type: 'function_call',
  id: 'fc_1',
  call_id: 'call_1',
  name: 'records_get',
  arguments: '{"id":"wdg_1"}',
  status: 'completed',
};
const message = (text: string, phase?: string) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  ...(phase ? { phase } : {}),
  content: [{ type: 'output_text', text, annotations: [] }],
});
const reply = (output: unknown[], fields: Record<string, unknown> = {}) => ({
  status: 'completed',
  output,
  ...fields,
});

function fakeFetch(responses: unknown[], status = 200) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown>; signal: unknown }[] =
    [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
      signal: init?.signal,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

function make(fetch: typeof globalThis.fetch, options: Record<string, unknown> = {}) {
  return new OpenAiResponsesModel({
    provider: 'openai-compatible',
    baseUrl: 'https://example.org/v1/',
    model: 'gpt-6.1-sol',
    apiKey: 'sk-test-secret',
    fetch,
    ...options,
  });
}

describe('OpenAI Responses', () => {
  it('sends the stateless function calling format without making optional parameters required', async () => {
    const { fetch, sent } = fakeFetch([reply([call])]);
    const signal = new AbortController().signal;
    const turn = await make(fetch, {
      maxTokens: 1200,
      headers: { 'X-Title': 'AILaboratory' },
      extraBody: { reasoning: { effort: 'medium' }, model: 'wrong', store: true },
    }).complete({ ...request, signal });
    expect(sent[0]?.url).toBe('https://example.org/v1/responses');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer sk-test-secret');
    expect(sent[0]?.headers.get('x-title')).toBe('AILaboratory');
    expect(sent[0]?.signal).toBe(signal);
    expect(sent[0]?.body).toEqual({
      model: 'gpt-6.1-sol',
      max_output_tokens: 1200,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'medium' },
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: 'Read the widget.' },
      ],
      tools: [
        {
          type: 'function',
          name: 'records_get',
          description: 'Read a record.',
          parameters: request.tools[0]?.inputSchema,
          strict: false,
        },
      ],
    });
    expect(turn.toolCalls).toEqual([{ id: 'call_1', name: 'records_get', input: { id: 'wdg_1' } }]);
    expect(turn.stop).toBe('tool_use');
  });

  it('replays exact ordered output including reasoning and phase once across changed tool sets', async () => {
    const output = [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ciphertext' },
      message('Looking it up.', 'commentary'),
      call,
    ];
    const { fetch, sent } = fakeFetch([
      reply(output),
      reply([message('A widget.', 'final_answer')]),
    ]);
    const first = await make(fetch).complete(request);
    const second = await make(fetch, { baseUrl: 'https://EXAMPLE.org:443/v1///' }).complete({
      ...request,
      tools: [],
      messages: [
        ...request.messages,
        { role: 'assistant', ...first, raw: JSON.parse(JSON.stringify(first.raw)) },
        {
          role: 'tool',
          toolCallId: 'call_1',
          name: 'records_get',
          content: 'A widget.',
          isError: false,
        },
      ],
    });
    expect(sent[1]?.body.input).toEqual([
      { role: 'system', content: request.system },
      { role: 'user', content: 'Read the widget.' },
      ...output,
      { type: 'function_call_output', call_id: 'call_1', output: 'A widget.' },
    ]);
    expect(sent[1]?.body).not.toHaveProperty('tools');
    expect(second.stop).toBe('end');
    expect(second.text).toBe('A widget.');
  });

  it.each(['endpoint', 'model', 'protocol', 'absent'])(
    'reconstructs normalized history on %s mismatch',
    async (mismatch) => {
      const { fetch, sent } = fakeFetch([reply([call]), reply([message('Done.')])]);
      const first = await make(fetch).complete(request);
      const raw = { ...(first.raw as Record<string, unknown>) };
      if (mismatch === 'endpoint') raw.endpoint = 'https://other.org/v1/responses';
      if (mismatch === 'model') raw.model = 'other-model';
      if (mismatch === 'protocol') raw.protocol = 'chat-completions';
      await make(fetch).complete({
        ...request,
        messages: [
          {
            role: 'assistant',
            text: 'Looking it up.',
            toolCalls: first.toolCalls,
            ...(mismatch !== 'absent' ? { raw } : {}),
          },
          {
            role: 'tool',
            toolCallId: 'call_1',
            name: 'records_get',
            content: 'found',
            isError: false,
          },
        ],
      });
      expect(sent[1]?.body.input).toEqual([
        { role: 'system', content: request.system },
        { role: 'assistant', content: 'Looking it up.' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'records_get',
          arguments: '{"id":"wdg_1"}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'found' },
      ]);
    },
  );

  it('keeps malformed JSON arguments visible to the operation validation contract', async () => {
    const { fetch, sent } = fakeFetch([
      reply([{ ...call, arguments: '{bad' }]),
      reply([message('Done.')]),
    ]);
    const first = await make(fetch).complete(request);
    expect(first.toolCalls).toEqual([
      { id: 'call_1', name: 'records_get', input: undefined, rawInput: '{bad' },
    ]);
    await make(fetch, { model: 'other-model' }).complete({
      ...request,
      messages: [{ role: 'assistant', ...first }],
    });
    expect(sent[1]?.body.input).toEqual([
      { role: 'system', content: request.system },
      { type: 'function_call', call_id: 'call_1', name: 'records_get', arguments: '{bad' },
    ]);
  });

  it.each([
    { ...call, call_id: undefined },
    { ...call, call_id: '' },
    { ...call, name: undefined },
    { ...call, name: ' ' },
    { ...call, arguments: {} },
  ])('rejects malformed function call identity or argument format', async (invalid) => {
    const { fetch } = fakeFetch([reply([invalid])]);
    await expect(make(fetch).complete(request)).rejects.toThrow(ModelError);
  });

  it.each(['in_progress', 'incomplete', 'failed', 'unknown'])(
    'never executes a %s function call in a completed response',
    async (status) => {
      const { fetch } = fakeFetch([reply([{ ...call, status }])]);
      await expect(make(fetch).complete(request)).rejects.toThrow('output is unfinished');
    },
  );

  it('accepts the optional function call status when omitted', async () => {
    const { status: _status, ...withoutStatus } = call;
    const { fetch } = fakeFetch([reply([withoutStatus])]);
    expect((await make(fetch).complete(request)).stop).toBe('tool_use');
  });

  it.each([
    {
      output: [
        call,
        { ...message(''), content: [{ type: 'refusal', refusal: 'Cannot do that.' }] },
      ],
      fields: {},
      stop: 'refusal',
    },
    {
      output: [call],
      fields: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      stop: 'max_tokens',
    },
    {
      output: [{ ...call, status: 'incomplete' }],
      fields: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
      stop: 'refusal',
    },
  ])('terminal $stop takes precedence over recorded calls', async ({ output, fields, stop }) => {
    const { fetch } = fakeFetch([reply(output, fields)]);
    const turn = await make(fetch).complete(request);
    expect(turn.stop).toBe(stop);
    expect(turn.toolCalls).toHaveLength(1);
  });

  it.each(['max_output_tokens', 'content_filter'])(
    'reports %s even with an empty output',
    async (reason) => {
      const { fetch } = fakeFetch([
        reply([], { status: 'incomplete', incomplete_details: { reason } }),
      ]);
      expect((await make(fetch).complete(request)).stop).toBe(
        reason === 'content_filter' ? 'refusal' : 'max_tokens',
      );
    },
  );

  it('continues only explicitly phased standalone commentary and replays it into the next turn', async () => {
    const commentary = message('Checking the registry.', 'commentary');
    const { fetch, sent } = fakeFetch([reply([commentary]), reply([call])]);
    const model = make(fetch);
    const first = await model.complete(request);
    expect(first.stop).toBe('continue');
    expect(first.toolCalls).toEqual([]);
    const second = await model.complete({
      ...request,
      messages: [...request.messages, { role: 'assistant', ...first }],
    });
    expect(second.stop).toBe('tool_use');
    expect(sent[1]?.body.input).toEqual([
      { role: 'system', content: request.system },
      { role: 'user', content: 'Read the widget.' },
      commentary,
    ]);
  });

  it.each([
    [message('Done.', 'final_answer')],
    [message('Done.')],
    [message('Working.', 'commentary'), message('Done.', 'final_answer')],
  ])('ends on a final or unphased visible answer', async (...output) => {
    const { fetch } = fakeFetch([reply(output)]);
    expect((await make(fetch).complete(request)).stop).toBe('end');
  });

  it.each([
    reply([]),
    reply([{ type: 'reasoning', summary: [] }]),
    reply([message(' ')]),
    reply([{ type: 'unknown' }]),
    reply([message('Done.', 'unknown')]),
    reply([message('Done.')], { status: 'failed' }),
    reply([message('Done.')], { status: 'queued' }),
    reply([call], { status: 'incomplete', incomplete_details: { reason: 'unknown' } }),
    { status: 'completed', output: null },
    {},
  ])('rejects empty, unknown, failed or unfinished replies instead of ending', async (invalid) => {
    const { fetch } = fakeFetch([invalid]);
    await expect(make(fetch).complete(request)).rejects.toThrow(ModelError);
  });

  it('rejects duplicate function call identities', async () => {
    const { fetch } = fakeFetch([reply([call, call])]);
    await expect(make(fetch).complete(request)).rejects.toThrow('duplicate function call ID');
  });

  it('does not expose echoed secrets from transport or provider failures', async () => {
    const { fetch } = fakeFetch([{ error: { message: 'echo sk-test-secret' } }], 401);
    await expect(make(fetch).complete(request)).rejects.toThrow('HTTP 401');
    const transport = (async () => {
      throw new Error('echo sk-test-secret');
    }) as typeof globalThis.fetch;
    const error = await make(transport)
      .complete(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as Error).message).not.toContain('sk-test-secret');
  });
});

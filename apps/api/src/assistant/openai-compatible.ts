import {
  type ChatModel,
  ModelError,
  type ModelMessage,
  type ModelRequest,
  type ModelTurn,
  parseArguments,
  type StopReason,
} from './model.ts';

export interface OpenAiCompatibleOptions {
  provider: string;
  /** e.g. "https://openrouter.ai/api/v1". */
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  headers?: Record<string, string>;
  /** Extra fields for every request, e.g. OpenRouter's `provider` routing. */
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
}

interface ChatCompletion {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments?: string } }[];
    };
  }[];
  error?: { message?: string };
}

const stopReasons: Record<string, StopReason> = {
  stop: 'end',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

/**
 * Any endpoint that speaks the OpenAI chat-completions format: OpenRouter (DeepSeek, Qwen, Llama…),
 * a local server such as Ollama or LM Studio, or OpenAI itself.
 */
export class OpenAiCompatibleModel implements ChatModel {
  readonly provider: string;
  readonly model: string;
  readonly #options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.#options = options;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const { baseUrl, apiKey, headers, maxTokens, extraBody } = this.#options;
    const request_ = this.#options.fetch ?? globalThis.fetch.bind(globalThis);
    const body = {
      ...extraBody,
      model: this.model,
      max_tokens: maxTokens ?? 8192,
      messages: [{ role: 'system', content: request.system }, ...request.messages.map(toWire)],
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
    };
    let response: Response;
    try {
      response = await request_(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...headers,
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      throw new ModelError(`Could not reach ${this.provider}: ${(error as Error).message}`);
    }
    const json = (await response.json().catch(() => undefined)) as ChatCompletion | undefined;
    if (!response.ok || json?.error) {
      const detail = json?.error?.message ?? `HTTP ${response.status}`;
      throw new ModelError(`${this.provider} refused the request: ${detail}`);
    }
    const choice = json?.choices?.[0];
    if (!choice?.message) throw new ModelError(`${this.provider} sent an empty reply`);
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => {
      const input = parseArguments(call.function.arguments);
      return {
        id: call.id,
        name: call.function.name,
        input,
        ...(input === undefined ? { rawInput: call.function.arguments ?? '' } : {}),
      };
    });
    const stop =
      toolCalls.length > 0 ? 'tool_use' : (stopReasons[choice.finish_reason ?? 'stop'] ?? 'end');
    return {
      text: choice.message.content ?? choice.message.refusal ?? '',
      toolCalls,
      stop,
    };
  }
}

function toWire(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: call.rawInput ?? JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

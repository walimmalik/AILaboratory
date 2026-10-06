import {
  type ChatModel,
  ModelError,
  type ModelMessage,
  type ModelRequest,
  type ModelToolCall,
  type ModelTurn,
  parseArguments,
  type StopReason,
} from './model.ts';
import type { OpenAiCompatibleOptions } from './openai-compatible.ts';

interface ResponsesReplay {
  protocol: 'openai-responses';
  endpoint: string;
  model: string;
  output: Record<string, unknown>[];
}

/** Stateless Responses conversations: replay full output items, including phases and reasoning. */
export class OpenAiResponsesModel implements ChatModel {
  readonly provider: string;
  readonly model: string;
  readonly #options: OpenAiCompatibleOptions;
  readonly #endpoint: string;

  constructor(options: OpenAiCompatibleOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.#options = options;
    this.#endpoint = new URL(`${options.baseUrl.replace(/\/+$/, '')}/responses`).href;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const { apiKey, headers, maxTokens, extraBody } = this.#options;
    const request_ = this.#options.fetch ?? globalThis.fetch.bind(globalThis);
    const body = {
      ...extraBody,
      model: this.model,
      max_output_tokens: maxTokens ?? 8192,
      store: false,
      include: ['reasoning.encrypted_content'],
      input: [
        { role: 'system', content: request.system },
        ...request.messages.flatMap((message) => this.#toWire(message)),
      ],
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              strict: false,
            })),
          }
        : {}),
    };
    let response: Response;
    try {
      response = await request_(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...headers,
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch {
      // Transport and provider diagnostics may echo credentials or request content.
      throwIfTimedOut(request.signal);
      throw new ModelError(`Could not reach ${this.provider} (Responses request)`);
    }
    const json: unknown = await response.json().catch(() => {
      throwIfTimedOut(request.signal);
      return undefined;
    });
    if (!response.ok || (isRecord(json) && json.error)) {
      throw new ModelError(
        `${this.provider} refused the Responses request (HTTP ${response.status})`,
      );
    }
    if (!isRecord(json)) throw this.#invalid('no response object');
    if (json.status !== 'completed' && json.status !== 'incomplete') {
      throw this.#invalid('response was not completed or incomplete');
    }
    if (!Array.isArray(json.output) || !json.output.every(isRecord)) {
      throw this.#invalid('no valid output array');
    }
    const output = json.output;
    const toolCalls: ModelToolCall[] = [];
    const texts: string[] = [];
    const messages: Record<string, unknown>[] = [];
    let refusal = false;
    let unfinished = false;
    for (const item of output) {
      switch (item.type) {
        case 'reasoning':
          break;
        case 'function_call': {
          if (
            typeof item.call_id !== 'string' ||
            !item.call_id.trim() ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            typeof item.arguments !== 'string'
          ) {
            throw this.#invalid('function call is missing its call ID, name or arguments');
          }
          if (toolCalls.some((call) => call.id === item.call_id)) {
            throw this.#invalid('duplicate function call ID');
          }
          if (item.status != null && item.status !== 'completed') unfinished = true;
          const input = item.arguments.trim() ? parseArguments(item.arguments) : undefined;
          toolCalls.push({
            id: item.call_id,
            name: item.name,
            input,
            ...(input === undefined ? { rawInput: item.arguments } : {}),
          });
          break;
        }
        case 'message':
          if (
            item.role !== 'assistant' ||
            !Array.isArray(item.content) ||
            (item.phase != null && item.phase !== 'commentary' && item.phase !== 'final_answer')
          ) {
            throw this.#invalid('invalid assistant message');
          }
          if (item.status != null && item.status !== 'completed') unfinished = true;
          messages.push(item);
          for (const part of item.content) {
            if (!isRecord(part)) throw this.#invalid('invalid message content');
            if (part.type === 'output_text' && typeof part.text === 'string') {
              texts.push(part.text);
            } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
              refusal = true;
              texts.push(part.refusal);
            } else {
              throw this.#invalid('unsupported message content');
            }
          }
          break;
        default:
          throw this.#invalid('unsupported output item');
      }
    }
    const incompleteReason = isRecord(json.incomplete_details)
      ? json.incomplete_details.reason
      : undefined;
    let stop: StopReason;
    if (refusal || (json.status === 'incomplete' && incompleteReason === 'content_filter')) {
      stop = 'refusal';
    } else if (json.status === 'incomplete' && incompleteReason === 'max_output_tokens') {
      stop = 'max_tokens';
    } else if (json.status === 'incomplete' || unfinished) {
      throw this.#invalid('output is unfinished');
    } else if (toolCalls.length) {
      stop = 'tool_use';
    } else if (!texts.some((text) => text.trim())) {
      throw this.#invalid('empty reply');
    } else {
      stop = messages.every((message) => message.phase === 'commentary') ? 'continue' : 'end';
    }
    const raw: ResponsesReplay = {
      protocol: 'openai-responses',
      endpoint: this.#endpoint,
      model: this.model,
      output,
    };
    return { text: texts.join('\n'), toolCalls, stop, raw };
  }

  #invalid(detail: string): ModelError {
    return new ModelError(`${this.provider} sent an invalid Responses reply: ${detail}`);
  }

  #toWire(message: ModelMessage): Record<string, unknown>[] {
    switch (message.role) {
      case 'user':
        return [{ role: 'user', content: message.text }];
      case 'tool':
        return [
          { type: 'function_call_output', call_id: message.toolCallId, output: message.content },
        ];
      case 'assistant': {
        const raw = message.raw;
        if (
          isRecord(raw) &&
          raw.protocol === 'openai-responses' &&
          raw.endpoint === this.#endpoint &&
          raw.model === this.model
        ) {
          if (!Array.isArray(raw.output) || !raw.output.every(isRecord)) {
            throw this.#invalid('invalid saved output');
          }
          // Raw items already contain messages and function calls; never append reconstructed copies.
          return raw.output;
        }
        return [
          ...(message.text ? [{ role: 'assistant', content: message.text }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.rawInput ?? JSON.stringify(call.input ?? {}),
          })),
        ];
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function throwIfTimedOut(signal?: AbortSignal): void {
  if (signal?.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError') {
    // Never propagate a transport diagnostic or even the signal's reason text.
    throw new DOMException('The Responses request timed out.', 'TimeoutError');
  }
}

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type ChatModel,
  ModelError,
  type ModelMessage,
  type ModelRequest,
  type ModelTurn,
  type StopReason,
} from './model.ts';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetch?: typeof fetch;
}

/** Models that accept server-side refusal fallbacks (fallbacks: "default"). */
const fallbackModels = /^claude-(opus-5|fable-5|sonnet-5-5)/;

const stopReasons: Record<string, StopReason> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

/** Claude through the Anthropic API. */
export class AnthropicModel implements ChatModel {
  readonly provider = 'anthropic';
  readonly model: string;
  readonly #client: Anthropic;
  readonly #maxTokens: number;

  constructor(options: AnthropicOptions) {
    this.model = options.model;
    this.#maxTokens = options.maxTokens ?? 16000;
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const tools: BetaTool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as BetaTool['input_schema'],
    }));
    const fallback = fallbackModels.test(this.model);
    let response: Awaited<ReturnType<Anthropic['beta']['messages']['create']>>;
    try {
      response = await this.#client.beta.messages.create(
        {
          model: this.model,
          max_tokens: this.#maxTokens,
          system: request.system,
          tools,
          messages: toWire(request.messages),
          // Caches the system prompt, tools and conversation so far; each turn only pays for what is new.
          cache_control: { type: 'ephemeral' },
          ...(fallback
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
          stream: false,
        },
        request.signal ? { signal: request.signal } : {},
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionError) {
        throw new ModelError(`Could not reach Anthropic: ${error.message}`);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ModelError(`Anthropic refused the request (${error.status}): ${error.message}`);
      }
      throw error;
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n');
    const toolCalls = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        input:
          block.input && typeof block.input === 'object' && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : undefined,
      }));
    const stop = stopReasons[response.stop_reason ?? 'end_turn'] ?? 'end';
    return {
      text,
      toolCalls,
      stop: stop === 'end' && toolCalls.length ? 'tool_use' : stop,
      raw: response.content,
    };
  }
}

/** Neutral messages to Anthropic's format: tool results ride in the next user turn, turns alternate. */
function toWire(messages: ModelMessage[]): BetaMessageParam[] {
  const wire: BetaMessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: BetaContentBlockParam[]) => {
    const last = wire.at(-1);
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else wire.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'user') {
      push('user', [{ type: 'text', text: message.text }]);
    } else if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        },
      ]);
    } else if (message.raw) {
      push('assistant', message.raw as BetaContentBlock[] as BetaContentBlockParam[]);
    } else {
      const blocks: BetaContentBlockParam[] = [
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
        ...message.toolCalls.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        })),
      ];
      // An empty reply (e.g. from another model) has nothing to send; Anthropic rejects empty turns.
      if (blocks.length) push('assistant', blocks);
    }
  }
  return wire;
}

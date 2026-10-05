/**
 * The one interface every model provider implements (ADR 0020). The agent loop speaks only this,
 * so a DeepSeek model on OpenRouter and Claude get the same tools, prompt and conversation.
 */

export interface ModelTool {
  /** A provider-safe name, e.g. "records_create". */
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** Parsed arguments, or undefined when the model sent something that is not a JSON object. */
  input: Record<string, unknown> | undefined;
  /** The arguments as sent, when they could not be parsed. */
  rawInput?: string;
}

export type ModelMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ModelToolCall[];
      /** The provider's own reply, sent back unchanged when the same provider and model continue. */
      raw?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean };

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: ModelTool[];
  signal?: AbortSignal;
}

/** `continue` is an explicitly nonterminal commentary turn, with no tool calls to execute. */
export type StopReason = 'end' | 'tool_use' | 'continue' | 'max_tokens' | 'refusal';

export interface ModelTurn {
  text: string;
  toolCalls: ModelToolCall[];
  stop: StopReason;
  raw?: unknown;
}

export interface ChatModel {
  /** "openrouter", "anthropic", "openai-compatible" or "scripted". */
  readonly provider: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}

/** A model call that failed. The message is safe to show: it never contains the API key. */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/** Parses tool-call arguments; anything but a JSON object comes back as undefined. */
export function parseArguments(text: string | undefined): Record<string, unknown> | undefined {
  if (!text?.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

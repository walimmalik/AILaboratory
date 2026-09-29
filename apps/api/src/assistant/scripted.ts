import type { ChatModel, ModelRequest, ModelTurn } from './model.ts';

/**
 * A model for tests and end-to-end runs, with no network. A message containing
 * `/op <operation.id> <json input>` (on one line) makes it run that operation; `$attached` in the input
 * stands for the first attached file's ID. After a result it reports back.
 * Anything else is echoed.
 */
export class ScriptedModel implements ChatModel {
  readonly provider = 'scripted';
  readonly model = 'scripted';
  #calls = 0;

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const last = request.messages.at(-1);
    if (last?.role === 'tool') {
      const status = last.isError ? 'That failed' : 'Done';
      return { text: `${status}: ${last.content.slice(0, 200)}`, toolCalls: [], stop: 'end' };
    }
    const text = last?.role === 'user' ? last.text : '';
    const match = /\/op\s+([a-z_.]+)\s*(\{[^\n]*\})?/.exec(text);
    if (match?.[1]) {
      const name = match[1].replaceAll('.', '_');
      // "$attached" stands for the first file attached to the message.
      const file = /\[Attached file (file_[a-z0-9]+)/.exec(text)?.[1];
      const json = file ? match[2]?.replaceAll('$attached', file) : match[2];
      const input = json ? (JSON.parse(json) as Record<string, unknown>) : {};
      this.#calls += 1;
      return {
        text: `Running ${match[1]}.`,
        toolCalls: [{ id: `call_${this.#calls}`, name, input }],
        stop: 'tool_use',
      };
    }
    return { text: `You said: ${text}`, toolCalls: [], stop: 'end' };
  }
}

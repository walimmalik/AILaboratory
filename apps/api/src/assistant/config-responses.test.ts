import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelFromEnv } from './config.ts';

afterEach(() => vi.unstubAllGlobals());

describe('explicit OpenAI-compatible protocol configuration', () => {
  const env = {
    AGENT_PROVIDER: 'openai-compatible',
    AGENT_BASE_URL: 'https://configured.example/v1',
    AGENT_API_KEY: 'test-only-key',
    AGENT_MODEL: 'gpt-6.1-sol',
  };

  it.each([undefined, 'chat-completions', 'responses'])(
    'uses %s without changing the configured endpoint, model or key',
    async (format) => {
      const requests: {
        url: string;
        body: Record<string, unknown>;
        authorization: string | null;
      }[] = [];
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          authorization: new Headers(init.headers).get('authorization'),
        });
        return Response.json(
          format === 'responses'
            ? {
                status: 'completed',
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    phase: 'final_answer',
                    content: [{ type: 'output_text', text: 'Ready.' }],
                  },
                ],
              }
            : { choices: [{ finish_reason: 'stop', message: { content: 'Ready.' } }] },
        );
      });
      const setup = modelFromEnv({ ...env, AGENT_API_FORMAT: format });
      if ('reason' in setup) throw new Error(setup.reason);
      expect(setup.model.model).toBe(env.AGENT_MODEL);
      const turn = await setup.model.complete({
        system: 'Lab assistant',
        messages: [{ role: 'user', text: 'Hello' }],
        tools: [],
      });
      expect(turn.text).toBe('Ready.');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(
        `${env.AGENT_BASE_URL}/${format === 'responses' ? 'responses' : 'chat/completions'}`,
      );
      expect(requests[0]?.body.model).toBe(env.AGENT_MODEL);
      expect(requests[0]?.authorization).toBe('Bearer test-only-key');
    },
  );

  it('reports unsupported protocols rather than silently falling back', () => {
    expect(modelFromEnv({ ...env, AGENT_API_FORMAT: 'automatic' })).toEqual({
      reason: 'AGENT_API_FORMAT must be chat-completions or responses',
    });
  });

  it.each(['not-a-url', 'ftp://configured.example/v1'])(
    'reports an invalid Responses base URL without crashing setup: %s',
    (baseUrl) => {
      expect(
        modelFromEnv({ ...env, AGENT_API_FORMAT: 'responses', AGENT_BASE_URL: baseUrl }),
      ).toEqual({
        reason: 'AGENT_BASE_URL must be an absolute HTTP(S) URL for Responses',
      });
    },
  );
});

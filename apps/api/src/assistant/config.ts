import { AnthropicModel } from './anthropic.ts';
import type { ChatModel } from './model.ts';
import { OpenAiCompatibleModel } from './openai-compatible.ts';
import { ScriptedModel } from './scripted.ts';

export type ModelSetup = { model: ChatModel; agentName: string } | { reason: string };

type Env = Record<string, string | undefined>;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'deepseek/deepseek-chat',
  anthropic: 'claude-opus-5-5',
};

/**
 * Reads the assistant's model from the environment (.env): AGENT_PROVIDER, its key, AGENT_MODEL,
 * and optionally AGENT_NAME. Returns why it is not set up instead of throwing, so the app runs without one.
 */
export function modelFromEnv(env: Env): ModelSetup {
  const provider = env.AGENT_PROVIDER?.trim();
  if (!provider) return { reason: 'AGENT_PROVIDER is not set in .env' };
  const model = env.AGENT_MODEL?.trim() || DEFAULT_MODELS[provider];
  const named = (chat: ChatModel, fallback: string) => ({
    model: chat,
    agentName: env.AGENT_NAME?.trim() || fallback,
  });

  switch (provider) {
    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) return { reason: 'OPENROUTER_API_KEY is empty in .env' };
      const chat = new OpenAiCompatibleModel({
        provider,
        baseUrl: OPENROUTER_URL,
        apiKey,
        model: model as string,
        // OpenRouter's optional app attribution.
        headers: { 'X-Title': 'AILaboratory' },
        ...(providerOrder(env.AGENT_PROVIDER_ORDER)
          ? {
              extraBody: {
                provider: { order: providerOrder(env.AGENT_PROVIDER_ORDER), allow_fallbacks: true },
              },
            }
          : {}),
      });
      return named(chat, shortName(chat.model));
    }
    case 'openai-compatible': {
      const baseUrl = env.AGENT_BASE_URL?.trim();
      if (!baseUrl) return { reason: 'AGENT_BASE_URL is empty in .env' };
      if (!model) return { reason: 'AGENT_MODEL is empty in .env' };
      const chat = new OpenAiCompatibleModel({
        provider,
        baseUrl,
        apiKey: env.AGENT_API_KEY?.trim() ?? '',
        model,
      });
      return named(chat, shortName(model));
    }
    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) return { reason: 'ANTHROPIC_API_KEY is empty in .env' };
      return named(new AnthropicModel({ apiKey, model: model as string }), 'Claude');
    }
    case 'scripted':
      if (env.AILAB_TEST_KINDS !== '1') {
        return { reason: 'The scripted model is for tests only (needs AILAB_TEST_KINDS=1)' };
      }
      return named(new ScriptedModel(), 'Test assistant');
    default:
      return {
        reason: `AGENT_PROVIDER "${provider}" is not supported. Use openrouter, anthropic or openai-compatible.`,
      };
  }
}

/** "fireworks, together" → ["fireworks", "together"]: OpenRouter providers to try first, in order. */
function providerOrder(value: string | undefined): string[] | undefined {
  const order = value
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return order?.length ? order : undefined;
}

/** "deepseek/deepseek-chat" → "deepseek-chat". */
function shortName(model: string): string {
  return model.split('/').at(-1) || model;
}

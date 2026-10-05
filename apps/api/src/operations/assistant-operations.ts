import { randomUUID } from 'node:crypto';
import {
  assistantAsk,
  assistantGetConversation,
  assistantListConversations,
  assistantStatus,
} from '@ailab/schema';
import { replyOrigin } from '../assistant/context.ts';
import {
  appendMessage,
  createConversation,
  findConversation,
  getConversation,
  listConversations,
  toSummary,
  updateConversation,
} from '../assistant/store.ts';
import { OperationError } from './errors.ts';
import { implement } from './registry.ts';

/** First line of the first message, shortened: the conversation's title until people can rename it. */
/**
 * A conversation's name from its first ask: the first sentence without the polite lead-in ("can
 * you", "please"), capitalized and cut at a word to about 60 characters.
 */
export function titleFrom(message: string): string {
  const line = message.trim().split('\n')[0] ?? '';
  const sentence = line.match(/^.+?[.?!](?=\s|$)/)?.[0] ?? line;
  const ask = sentence
    .replace(/^(hi|hey|hello)[,!.]?\s+/i, '')
    .replace(/^(can|could|would|will) you( please)?\s+/i, '')
    .replace(/^please\s+/i, '')
    .replace(/[.?!]+$/, '')
    .trim();
  const named = ask.charAt(0).toUpperCase() + ask.slice(1);
  if (named.length <= 60) return named;
  const cut = named.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

export const assistantOperations = [
  implement(assistantStatus, {
    run: async (_ctx, _input, deps) => deps.assistant.describe(),
  }),
  implement(assistantAsk, {
    actors: 'people',
    agentPolicy: 'direct',
    touches: () => [],
    run: async (ctx, input, deps) => {
      const { assistant, db } = deps;
      const model = assistant.model;
      const setup = assistant.describe();
      if (!model || !setup.configured) {
        throw new OperationError(
          'invalid_state',
          `The assistant has no model set up (${setup.configured ? '' : setup.reason}). Set AGENT_PROVIDER and its key in .env, then restart the API.`,
        );
      }
      const current = {
        agentName: assistant.agentName,
        provider: model.provider,
        model: model.model,
      };
      const origin = await replyOrigin(deps, ctx, input.replyTo, input.page);
      let conversation = input.conversationId
        ? await findConversation(db, ctx, input.conversationId, { forUpdate: true })
        : await createConversation(db, ctx, {
            title: titleFrom(
              input.message || (input.attachments?.map((a) => a.name).join(', ') ?? ''),
            ),
            ...current,
          });
      if (conversation.status === 'running' || assistant.isRunning(conversation.id)) {
        throw new OperationError(
          'invalid_state',
          'The assistant is still answering your last message in this conversation. Wait for it to finish.',
        );
      }
      await appendMessage(db, conversation.id, {
        role: 'user',
        text: input.message,
        ...(origin ? { origin } : {}),
        ...(input.page ? { page: input.page } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((file) => ({
                ...file,
                id: `file_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
              })),
            }
          : {}),
      });
      // A conversation continues on whichever model is set up now.
      conversation = await updateConversation(db, conversation.id, {
        status: 'running',
        error: null,
        ...current,
      });
      return toSummary(conversation);
    },
    after: (ctx, _input, output, deps) => deps.assistant.start(deps, ctx, output.id),
  }),
  implement(assistantListConversations, {
    run: async (ctx, input, deps) => ({
      conversations: await listConversations(deps.db, ctx, input.limit),
    }),
  }),
  implement(assistantGetConversation, {
    run: (ctx, input, deps) => getConversation(deps.db, ctx, input.id),
  }),
];

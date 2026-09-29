import { randomUUID } from 'node:crypto';
import {
  assistantAsk,
  assistantGetConversation,
  assistantListConversations,
  assistantStatus,
} from '@ailab/schema';
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
function titleFrom(message: string): string {
  const line = message.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
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

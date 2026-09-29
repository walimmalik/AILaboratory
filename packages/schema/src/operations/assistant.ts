import { z } from 'zod';
import {
  AssistantSetup,
  Conversation,
  ConversationId,
  ConversationSummary,
  PageContext,
} from '../assistant.ts';
import { defineContract } from '../operation.ts';

export const assistantStatus = defineContract({
  id: 'assistant.status',
  summary: 'Which model the in-app assistant runs on, or why it is not set up',
  effect: 'read',
  input: z.object({}),
  output: AssistantSetup,
});

export const assistantAsk = defineContract({
  id: 'assistant.ask',
  summary:
    'Send the in-app assistant a message, starting a conversation or continuing one (people only). It answers in the background.',
  effect: 'write',
  input: z.object({
    conversationId: ConversationId.optional(),
    message: z.string().trim().min(1).max(8000),
    page: PageContext.optional(),
  }),
  output: ConversationSummary,
});

export const assistantListConversations = defineContract({
  id: 'assistant.list_conversations',
  summary: 'Your conversations with the in-app assistant, most recent first',
  effect: 'read',
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  output: z.object({ conversations: z.array(ConversationSummary) }),
});

export const assistantGetConversation = defineContract({
  id: 'assistant.get_conversation',
  summary:
    'One of your conversations with the in-app assistant, with every message and operation it ran',
  effect: 'read',
  input: z.object({ id: ConversationId }),
  output: Conversation,
});

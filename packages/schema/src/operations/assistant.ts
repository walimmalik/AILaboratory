import { z } from 'zod';
import {
  AssistantSetup,
  AttachmentInput,
  Conversation,
  ConversationId,
  ConversationSummary,
  PageContext,
} from '../assistant.ts';
import { defineContract } from '../operation.ts';

export const assistantStatus = defineContract({
  id: 'assistant.status',
  verbs: { done: "checked the assistant's setup", intent: "check the assistant's setup" },
  summary: 'Which model the in-app assistant runs on, or why it is not set up',
  effect: 'read',
  input: z.object({}),
  output: AssistantSetup,
});

export const assistantAsk = defineContract({
  id: 'assistant.ask',
  verbs: { done: 'asked the assistant', intent: 'ask the assistant' },
  summary:
    'Send the in-app assistant a message, starting a conversation or continuing one (people only). It answers in the background.',
  effect: 'write',
  input: z
    .object({
      conversationId: ConversationId.optional(),
      message: z.string().trim().max(8000),
      page: PageContext.optional(),
      attachments: z
        .array(AttachmentInput)
        .max(5, 'Attach at most 5 files to one message')
        .optional()
        .describe('Text files sent with the message (JSON, CSV, text)'),
    })
    .refine((input) => input.message !== '' || (input.attachments?.length ?? 0) > 0, {
      message: 'Write a message or attach a file',
      path: ['message'],
    }),
  output: ConversationSummary,
});

export const assistantListConversations = defineContract({
  id: 'assistant.list_conversations',
  verbs: {
    done: 'listed conversations with the assistant',
    intent: 'list conversations with the assistant',
  },
  summary: 'Your conversations with the in-app assistant, most recent first',
  effect: 'read',
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  output: z.object({ conversations: z.array(ConversationSummary) }),
});

export const assistantGetConversation = defineContract({
  id: 'assistant.get_conversation',
  verbs: {
    done: 'opened a conversation with the assistant',
    intent: 'open a conversation with the assistant',
  },
  summary:
    'One of your conversations with the in-app assistant, with every message and operation it ran',
  effect: 'read',
  input: z.object({ id: ConversationId }),
  output: Conversation,
});

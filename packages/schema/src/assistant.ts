import { z } from 'zod';
import { OperationErrorBody } from './operation.ts';

export const ConversationId = z.string().regex(/^cnv_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a cnv_ ID');

/** Where the person was when they asked, so the assistant knows what "this" means. */
export const PageContext = z.object({
  /** The app path, e.g. "/records/wdg_…". */
  path: z.string().max(500),
  title: z.string().max(200).optional(),
  /** The record the page shows, at the version the person is looking at (ADR 0055). */
  record: z
    .object({
      id: z.string().max(40),
      name: z.string().max(40),
      version: z.number().int().positive(),
    })
    .optional(),
});
export type PageContext = z.infer<typeof PageContext>;

/** idle: waiting for the person. running: the model is working. failed: the last run stopped with an error. */
export const ConversationStatus = z.enum(['idle', 'running', 'failed']);

/** One conversation with the in-app assistant, without its messages. */
export const ConversationSummary = z.object({
  id: ConversationId,
  title: z.string(),
  status: ConversationStatus,
  /** The name the assistant acts under in the ledger, e.g. "deepseek-chat" or "Claude". */
  agentName: z.string(),
  provider: z.string(),
  model: z.string(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ToolCall = z.object({
  id: z.string(),
  operationId: z.string(),
  input: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCall>;

const base = { id: z.string(), at: z.iso.datetime() };

/** A lab memory the assistant had in front of it when it answered. */
export const UsedMemory = z.object({
  id: z.string(),
  name: z.string(),
  statement: z.string(),
  strength: z.string(),
});
export type UsedMemory = z.infer<typeof UsedMemory>;

/** Largest file a person may attach to a message, in characters of text. */
export const MAX_ATTACHMENT_CHARS = 2_000_000;

/** A text file a person sends with a message (JSON, CSV, text). */
export const AttachmentInput = z.object({
  name: z.string().trim().min(1).max(200),
  mediaType: z.string().max(100),
  text: z
    .string()
    .max(
      MAX_ATTACHMENT_CHARS,
      `A file can be at most ${MAX_ATTACHMENT_CHARS / 1e6} million characters`,
    ),
});
export type AttachmentInput = z.infer<typeof AttachmentInput>;

/**
 * An attached file as the conversation keeps it. The assistant sees its name and a preview, and passes
 * the whole file to a tool as `{"$file": "<id>"}` instead of retyping it.
 */
export const Attachment = AttachmentInput.extend({ id: z.string().regex(/^file_[a-z0-9]+$/) });
export type Attachment = z.infer<typeof Attachment>;

/** A message in a conversation. Tool messages are the results of the operations the assistant ran. */
export const AssistantMessage = z.discriminatedUnion('role', [
  z.object({
    ...base,
    role: z.literal('user'),
    text: z.string(),
    page: PageContext.optional(),
    attachments: z.array(Attachment).optional(),
  }),
  z.object({
    ...base,
    role: z.literal('assistant'),
    text: z.string(),
    toolCalls: z.array(ToolCall),
    model: z.string(),
    /** The confirmed lab memories the assistant was given for this turn (plan 005d), on its final reply. */
    memory: z.array(UsedMemory).optional(),
  }),
  z.object({
    ...base,
    role: z.literal('tool'),
    toolCallId: z.string(),
    operationId: z.string(),
    /** done, preview, proposed (waits for a person), or failed. */
    outcome: z.enum(['done', 'preview', 'proposed', 'failed']),
    /** The operation's result, or its error. */
    result: z.unknown(),
    error: OperationErrorBody.optional(),
  }),
]);
export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const Conversation = ConversationSummary.extend({ messages: z.array(AssistantMessage) });
export type Conversation = z.infer<typeof Conversation>;

/** What the assistant runs on, as configured on the server. */
export const AssistantSetup = z.discriminatedUnion('configured', [
  z.object({
    configured: z.literal(true),
    provider: z.string(),
    model: z.string(),
    agentName: z.string(),
  }),
  z.object({ configured: z.literal(false), reason: z.string() }),
]);
export type AssistantSetup = z.infer<typeof AssistantSetup>;

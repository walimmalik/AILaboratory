import { EventEmitter } from 'node:events';
import type {
  Actor,
  AssistantMessage,
  AssistantSetup,
  Attachment,
  ConversationSummary,
  OperationErrorBody,
  PageContext,
} from '@ailab/schema';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { labs, users } from '../db/schema.ts';
import { toErrorBody } from '../operations/errors.ts';
import type { OperationDeps, OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { findSkill } from '../skills/skills.ts';
import type { ModelSetup } from './config.ts';
import { type ChatModel, ModelError, type ModelMessage } from './model.ts';
import {
  appendMessage,
  type MessageRow,
  messageRows,
  personOf,
  toSummary,
  updateConversation,
} from './store.ts';
import { callable, pageNamespaces, RUN_OPERATION, toolName, toolsFor } from './toolset.ts';

/** How many model turns one message may take before the assistant stops and says so. */
export const MAX_STEPS = 16;
/** Longest tool result sent back to the model, in characters. */
const MAX_RESULT_CHARS = 30_000;
const MODEL_TIMEOUT_MS = 180_000;

export type AssistantEvent =
  | { type: 'message'; message: AssistantMessage }
  | { type: 'status'; conversation: ConversationSummary };

/** In-process fan-out of conversation events, for the panel's live stream. */
export class AssistantBus {
  readonly #emitter = new EventEmitter().setMaxListeners(0);

  publish(conversationId: string, event: AssistantEvent): void {
    this.#emitter.emit(conversationId, event);
  }

  subscribe(conversationId: string, listener: (event: AssistantEvent) => void): () => void {
    this.#emitter.on(conversationId, listener);
    return () => this.#emitter.off(conversationId, listener);
  }
}

/**
 * The in-app assistant (plan 004b, ADR 0020): one small tool loop over the operation registry.
 * Each operation is a tool; the assistant calls them as an agent on behalf of the person, so its
 * changes follow the same agent policies and proposals as any outside agent's, and land in the ledger
 * with the conversation as their session.
 */
export class Assistant {
  readonly bus = new AssistantBus();
  readonly #setup: ModelSetup;
  readonly #runs = new Map<string, Promise<void>>();

  constructor(setup: ModelSetup) {
    this.#setup = setup;
  }

  get model(): ChatModel | undefined {
    return 'model' in this.#setup ? this.#setup.model : undefined;
  }

  get agentName(): string {
    return 'agentName' in this.#setup ? this.#setup.agentName : '';
  }

  describe(): AssistantSetup {
    return 'model' in this.#setup
      ? {
          configured: true,
          provider: this.#setup.model.provider,
          model: this.#setup.model.model,
          agentName: this.#setup.agentName,
        }
      : { configured: false, reason: this.#setup.reason };
  }

  isRunning(conversationId: string): boolean {
    return this.#runs.has(conversationId);
  }

  /** Resolves when the conversation's current run ends (for tests and shutdown). */
  async wait(conversationId: string): Promise<void> {
    await this.#runs.get(conversationId);
  }

  /** Starts answering the conversation's latest message in the background. */
  start(deps: OperationDeps, ctx: RecordContext, conversationId: string): void {
    const run = this.#run(deps, ctx, conversationId)
      .catch((error: unknown) => console.error('assistant run failed', error))
      .finally(() => this.#runs.delete(conversationId));
    this.#runs.set(conversationId, run);
  }

  publish(conversationId: string, event: AssistantEvent): void {
    this.bus.publish(conversationId, event);
  }

  async #run(deps: OperationDeps, ctx: RecordContext, conversationId: string): Promise<void> {
    const model = this.model;
    if (!model) throw new Error('The assistant has no model');
    const { db, registry } = deps;
    const agent: Actor = {
      type: 'agent',
      agentName: this.agentName,
      onBehalfOf: personOf(ctx),
      sessionRef: conversationId,
    };
    const agentCtx: RecordContext = { ...ctx, actor: agent };
    const system = await systemPrompt(db, ctx);
    const finish = async (status: 'idle' | 'failed', error?: string) => {
      const row = await updateConversation(db, conversationId, { status, error: error ?? null });
      this.publish(conversationId, { type: 'status', conversation: toSummary(row) });
    };

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const rows = await messageRows(db, conversationId);
        const tools = toolsFor(registry, namespacesOf(rows, deps));
        const history = toModelMessages(rows, model, new Set(tools.operationOf.keys()));
        const turn = await model.complete({
          system,
          messages: history,
          tools: tools.list,
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });
        const text =
          turn.text ||
          (turn.stop === 'refusal'
            ? 'The model declined to answer this.'
            : turn.stop === 'max_tokens' && !turn.toolCalls.length
              ? 'The reply was cut off because it ran too long.'
              : '');
        const message = await appendMessage(
          db,
          conversationId,
          {
            role: 'assistant',
            text,
            toolCalls: turn.toolCalls.map((call) => {
              const { operationId, input } = resolveCall(tools.operationOf, call);
              return { id: call.id, operationId, input: input ?? call.rawInput ?? '' };
            }),
            model: model.model,
          },
          { provider: model.provider, model: model.model, raw: turn.raw },
        );
        this.publish(conversationId, { type: 'message', message });
        if (!turn.toolCalls.length) return await finish('idle');

        const files = attachmentsOf(await messageRows(db, conversationId));
        for (const call of turn.toolCalls) {
          const { operationId, input, known } = resolveCall(tools.operationOf, call);
          const outcome = await runTool(registry, agentCtx, operationId, input, files, {
            known: known && callable(registry, operationId),
          });
          const result = await appendMessage(db, conversationId, {
            role: 'tool',
            toolCallId: call.id,
            operationId,
            ...outcome,
          });
          this.publish(conversationId, { type: 'message', message: result });
        }
      }
      await finish(
        'failed',
        `The assistant stopped after ${MAX_STEPS} steps without finishing. Tell it how to continue.`,
      );
    } catch (error) {
      if (!(error instanceof ModelError)) console.error('assistant run failed', error);
      await finish(
        'failed',
        error instanceof ModelError
          ? error.message
          : error instanceof Error && error.name === 'TimeoutError'
            ? `The model did not answer within ${MODEL_TIMEOUT_MS / 1000} seconds.`
            : 'The assistant stopped because of a server error.',
      );
    }
  }
}

type ToolOutcome = Pick<
  Extract<AssistantMessage, { role: 'tool' }>,
  'outcome' | 'result' | 'error'
>;

async function runTool(
  registry: OperationRegistry,
  ctx: RecordContext,
  operationId: string,
  input: Record<string, unknown> | undefined,
  files: Map<string, Attachment>,
  { known }: { known: boolean },
): Promise<ToolOutcome> {
  const refuse = (error: OperationErrorBody): ToolOutcome => ({
    outcome: 'failed',
    result: error,
    error,
  });
  if (!known) {
    return refuse({ code: 'unknown_operation', message: `There is no tool "${operationId}".` });
  }
  if (input === undefined) {
    return refuse({
      code: 'invalid_input',
      message: 'The tool arguments were not a JSON object. Send them again as one.',
    });
  }
  try {
    const result = await registry.execute(ctx, operationId, withFiles(input, files));
    return { outcome: result.status, result };
  } catch (error) {
    return refuse(toErrorBody(error));
  }
}

/** Longest part of an attached file the model sees; the whole file goes to tools by reference. */
const ATTACHMENT_PREVIEW_CHARS = 4_000;

/** How the model sees an attached file: its reference, size and the start of its text. */
export function describeAttachment(file: Attachment): string {
  const preview =
    file.text.length > ATTACHMENT_PREVIEW_CHARS
      ? `${file.text.slice(0, ATTACHMENT_PREVIEW_CHARS)}\n… [${file.text.length - ATTACHMENT_PREVIEW_CHARS} more characters]`
      : file.text;
  return `[Attached file ${file.id}: ${file.name} (${file.mediaType || 'text'}, ${file.text.length} characters). Pass it to a tool as {"$file": "${file.id}"}.]\n${preview}`;
}

/** Every file attached so far in the conversation, by ID. */
function attachmentsOf(rows: MessageRow[]): Map<string, Attachment> {
  return new Map(
    rows.flatMap((row) =>
      row.body.role === 'user' ? (row.body.attachments ?? []).map((f) => [f.id, f] as const) : [],
    ),
  );
}

/**
 * Replaces each `{"$file": id}` in a tool's input with that file: parsed JSON for a JSON file, the
 * text otherwise. An unknown ID is left in place, so the operation refuses it with its own message.
 */
export function withFiles(input: unknown, files: Map<string, Attachment>): Record<string, unknown> {
  const swap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(swap);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value);
    const ref = entries.length === 1 && entries[0]?.[0] === '$file' ? entries[0][1] : undefined;
    const file = typeof ref === 'string' ? files.get(ref) : undefined;
    if (file) {
      if (/json/i.test(file.mediaType) || file.name.toLowerCase().endsWith('.json')) {
        try {
          return JSON.parse(file.text);
        } catch {
          return file.text;
        }
      }
      return file.text;
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, swap(v)]));
  };
  return swap(input) as Record<string, unknown>;
}

/**
 * The stored conversation as model messages. Replies from the same provider and model go back in
 * their original form (Claude requires its thinking blocks unchanged); calls that never got a result
 * (the run was cut off) get one saying so, because every provider requires it.
 */
export function toModelMessages(
  rows: MessageRow[],
  model: ChatModel,
  named?: ReadonlySet<string>,
): ModelMessage[] {
  // A call to an operation that isn't a named tool this turn replays as run_operation (ADR 0055).
  const asTool = (operationId: string, input: unknown) =>
    !named || named.has(toolName(operationId))
      ? { name: toolName(operationId), input }
      : { name: RUN_OPERATION, input: { operation: operationId, input } };
  const messages: ModelMessage[] = [];
  const answered = new Set(
    rows.flatMap((row) => (row.body.role === 'tool' ? [row.body.toolCallId] : [])),
  );
  for (const { body, provider, model: rowModel, providerRaw } of rows) {
    if (body.role === 'user') {
      const files = (body.attachments ?? []).map(describeAttachment);
      messages.push({
        role: 'user',
        text: withPage([body.text, ...files].filter(Boolean).join('\n\n'), body.page),
      });
    } else if (body.role === 'assistant') {
      const same = provider === model.provider && rowModel === model.model && providerRaw;
      messages.push({
        role: 'assistant',
        text: body.text,
        toolCalls: body.toolCalls.map((call) => {
          if (typeof call.input === 'string') {
            return {
              id: call.id,
              name: toolName(call.operationId),
              input: undefined,
              rawInput: call.input,
            };
          }
          const tool = asTool(call.operationId, call.input);
          return { id: call.id, name: tool.name, input: tool.input as Record<string, unknown> };
        }),
        ...(same ? { raw: providerRaw } : {}),
      });
      for (const call of body.toolCalls) {
        if (answered.has(call.id)) continue;
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: asTool(call.operationId, undefined).name,
          content: JSON.stringify({ code: 'internal', message: 'This call was not run.' }),
          isError: true,
        });
      }
    } else {
      let content = JSON.stringify(body.result);
      if (content.length > MAX_RESULT_CHARS) {
        content = `${content.slice(0, MAX_RESULT_CHARS)}… [cut off at ${MAX_RESULT_CHARS} characters; ask for less, e.g. with a limit]`;
      }
      messages.push({
        role: 'tool',
        toolCallId: body.toolCallId,
        name: asTool(body.operationId, undefined).name,
        content,
        isError: body.outcome === 'failed',
      });
    }
  }
  return messages;
}

/** A model's tool call as the operation it runs: a named tool, or run_operation's operation. */
function resolveCall(
  operationOf: ReadonlyMap<string, string>,
  call: { name: string; input?: Record<string, unknown> | undefined },
): { operationId: string; input: Record<string, unknown> | undefined; known: boolean } {
  if (call.name === RUN_OPERATION) {
    const operation = call.input?.operation;
    const inner = call.input?.input;
    return typeof operation === 'string'
      ? {
          operationId: operation,
          input: inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : {},
          known: true,
        }
      : { operationId: RUN_OPERATION, input: undefined, known: false };
  }
  const operationId = operationOf.get(call.name);
  return { operationId: operationId ?? call.name, input: call.input, known: Boolean(operationId) };
}

/**
 * The modules whose tools this turn names: the page the latest message came from, and every module
 * the conversation already used, so earlier calls replay under their own names.
 */
function namespacesOf(rows: MessageRow[], deps: OperationDeps): string[] {
  const used = rows.flatMap((row) =>
    row.body.role === 'assistant'
      ? row.body.toolCalls.map((c) => c.operationId.split('.')[0] ?? '')
      : [],
  );
  const lastAsk = rows.findLast((row) => row.body.role === 'user')?.body;
  const page = lastAsk?.role === 'user' ? pageNamespaces(lastAsk.page, deps.kinds) : [];
  return [...new Set([...page, ...used])];
}

function withPage(text: string, page: PageContext | undefined): string {
  if (!page) return text;
  const where = page.title ? `${page.title} (${page.path})` : page.path;
  const record = page.record
    ? `; it shows ${page.record.name} (${page.record.id}) at version ${page.record.version}`
    : '';
  return `${text}\n\n[Sent from the page: ${where}${record}]`;
}

async function systemPrompt(db: Db, ctx: RecordContext): Promise<string> {
  const [user] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, personOf(ctx)));
  const [lab] = await db.select({ name: labs.name }).from(labs).where(eq(labs.id, ctx.labId));
  return `You are the lab assistant in AILaboratory, a lab management system. You work for ${user?.name ?? 'a lab member'} in ${lab?.name ?? 'their lab'}.

You act only through the lab's operations, which are your tools. Everything you change is recorded in the lab's activity ledger under your name, on behalf of that person.

- Look things up before you change them. Read tools change nothing. Before creating a record, read records_kinds (summary: true lists the kinds; kinds: ["sop"] gives one kind's attributes).
- Your named tools cover records, review, skills, the calculators and the module of the page you are on. For anything else, find the operation with operations_describe (by namespace, e.g. "sops") and call it with run_operation.
- Some changes are proposed rather than made: the result then has status "proposed" and waits for a person to confirm it on the Review page. Say that plainly; never say a proposed change is done.
- You draft; people confirm. Create records as drafts. Values you set are marked "assumed" until a person confirms them. Say where each value came from in "evidence": "stated" for values the person told you (e.g. {"color": {"source": "stated"}}), "datasheet", "imported" or "measured" with a reference when you used one; "calculated" with the "calculation" handle a calculator returned (and "output", a pointer into its output, when the value is one part of it); "record" or "template" with "from": {id, version} when you copied the value from a confirmed record. For a list the kind keys by item (an SOP's steps by id, variables by name), evidence can name one item as "/steps/<id>". Values you estimated get no evidence and show as assumed. Never name a source you did not use.
- A person confirms each section of a draft on its page; confirming the last one makes it active. Use records_readiness to see what is confirmed, what changed, what was assumed and which checks fail.
- The app adds a linked "Waiting for you" line under your reply listing the drafts and proposed changes you left, so don't write one yourself; just say briefly what you did and anything you assumed.
- To edit a record, read it first (records_get) for its current version and attributes, then send records_update the complete attributes with your change, and that version as expectedVersion.
- The person may attach files; each shows as [Attached file file_…] with the start of its text. To give a whole file to a tool, put {"$file": "file_…"} where the value goes (e.g. labware_import_opentrons with {"definition": {"$file": "file_…"}}); never retype a file's contents.
- Some tools return a file (an Opentrons definition, a worklist; their description says so). The app shows it under your reply with Download and Copy buttons, so don't copy its contents into your reply: say what it is and answer questions about it briefly.
- Every quantity has a unit, e.g. {"value": "50", "unit": "uL"}.
- If a tool refuses, read its message, fix the input and try again, or tell the person what you need.
- Never invent records, results or instrument behaviour. If you don't know, say so.
- Answer briefly, in plain lab language. Call records by their name (e.g. WDG-0001), not their internal ID, unless asked.
- The person's messages may end with the page they sent it from; "this" usually means what is on that page.
- Each module has a skill that explains its operations (skills_list lists them). Read a module's skill with skills_get before you first work in it.

The calculators skill, which you always follow:

${findSkill('calculators')?.text ?? ''}`;
}

export { toolName, toolsFor } from './toolset.ts';

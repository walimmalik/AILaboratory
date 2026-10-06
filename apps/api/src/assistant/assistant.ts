import { EventEmitter } from 'node:events';
import type {
  Actor,
  AssistantMessage,
  AssistantSetup,
  Attachment,
  ConversationSummary,
  OperationErrorBody,
  PageContext,
  UsedMemory,
} from '@ailab/schema';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activity, labs, proposals, users } from '../db/schema.ts';
import { activeMemories, bundle, lookup, nearby } from '../memory/match.ts';
import { toErrorBody } from '../operations/errors.ts';
import type { OperationDeps, OperationRegistry } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { findSkill } from '../skills/skills.ts';
import type { ModelSetup } from './config.ts';
import { pageNote, pendingNote } from './context.ts';
import { type ChatModel, ModelError, type ModelMessage } from './model.ts';
import { SCIENTIFIC_INTAKE_PROMPT } from './scientific-intake.ts';
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
/** Lab memory lines the assistant gets for a page (M7). */
const MEMORY_LINES = 15;
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
    const { db, registry } = deps;
    const finish = async (status: 'idle' | 'failed', error?: string) => {
      const row = await updateConversation(db, conversationId, { status, error: error ?? null });
      this.publish(conversationId, { type: 'status', conversation: toSummary(row) });
    };

    try {
      const model = this.model;
      if (!model) throw new Error('The assistant has no model');
      const ask = (await messageRows(db, conversationId)).findLast(
        (row) => row.body.role === 'user',
      )?.body;
      const agent: Actor = {
        type: 'agent',
        agentName: this.agentName,
        onBehalfOf: personOf(ctx),
        sessionRef: conversationId,
      };
      const agentCtx: RecordContext = {
        ...ctx,
        actor: agent,
        origin: ask?.role === 'user' ? (ask.origin ?? { type: 'unknown' }) : { type: 'unknown' },
      };
      const memory = await memoryNote(deps, ctx, ask);
      const system = `${await systemPrompt(db, ctx, conversationId)}${await personEdits(deps, ctx, conversationId)}${memory.text}${await pageNote(deps, ctx, ask?.role === 'user' ? ask.page : undefined)}${await pendingNote(deps, ctx, conversationId)}`;
      const terminal = async (text: string, raw?: unknown) => {
        const message = await appendMessage(
          db,
          conversationId,
          { role: 'assistant', text, toolCalls: [], model: model.model },
          raw === undefined ? undefined : { provider: model.provider, model: model.model, raw },
        );
        this.publish(conversationId, { type: 'message', message });
      };
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
            : turn.stop === 'max_tokens'
              ? 'The reply was cut off because it ran too long.'
              : !turn.toolCalls.length && turn.stop !== 'continue'
                ? 'The assistant returned no usable reply. Send a new request with the next step you need.'
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
            ...(!turn.toolCalls.length && memory.used.length ? { memory: memory.used } : {}),
          },
          { provider: model.provider, model: model.model, raw: turn.raw },
        );
        this.publish(conversationId, { type: 'message', message });
        if (turn.stop === 'refusal' || turn.stop === 'max_tokens') {
          const problem =
            turn.stop === 'refusal'
              ? 'The model declined to answer this. Its tool calls were not executed.'
              : 'The reply was cut off because it ran too long. Its tool calls were not executed; send a new request to continue.';
          for (const call of turn.toolCalls) {
            const { operationId } = resolveCall(tools.operationOf, call);
            const result = await appendMessage(db, conversationId, {
              role: 'tool',
              toolCallId: call.id,
              operationId,
              ...notExecuted(problem),
            });
            this.publish(conversationId, { type: 'message', message: result });
          }
          // Preserve the provider's text, but never let it obscure an interruption or refusal.
          if (turn.text || turn.toolCalls.length) await terminal(problem);
          return await finish(
            turn.stop === 'max_tokens' ? 'failed' : 'idle',
            turn.stop === 'max_tokens' ? problem : undefined,
          );
        }
        if (!turn.toolCalls.length) {
          if (turn.stop === 'continue') continue;
          return await finish('idle');
        }

        const files = attachmentsOf(await messageRows(db, conversationId));
        let pending = false;
        for (const call of turn.toolCalls) {
          const { operationId, input, known } = resolveCall(tools.operationOf, call);
          const outcome: ToolOutcome = pending
            ? notExecuted(
                'This call was not executed because a proposed change is waiting for your decision.',
              )
            : await runTool(registry, agentCtx, operationId, input, files, {
                known: known && callable(registry, operationId),
              });
          const result = await appendMessage(db, conversationId, {
            role: 'tool',
            toolCallId: call.id,
            operationId,
            ...outcome,
          });
          this.publish(conversationId, { type: 'message', message: result });
          pending ||= outcome.outcome === 'proposed';
        }
        if (pending) {
          await terminal(
            'A proposed change is ready for your review. Review and explicitly approve or reject it before I continue this change; a chat reply does not apply it.',
          );
          return await finish('idle');
        }
      }
      // Re-read committed outcomes, including the last action turn's results. This request has
      // no tools, and its response has no execution path even if the provider returns calls.
      const rows = await messageRows(db, conversationId);
      const names = toolsFor(registry, namespacesOf(rows, deps)).operationOf.keys();
      let summary = `I reached the action limit of ${MAX_STEPS} turns. Completed changes remain saved. Review the saved work and unresolved questions before sending a new request.`;
      let raw: unknown;
      try {
        const turn = await model.complete({
          system: `${system}\n\nThe action limit has been reached. This request is ONLY a final read-only summary of the persisted history. No tools are available and no more actions will run. Distinguish actual saved work from failed or not-executed calls, unresolved scientific questions, and remaining work. Do not claim the task is complete or promise continuation or future actions.`,
          messages: toModelMessages(rows, model, new Set(names)),
          tools: [],
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });
        if (turn.stop === 'end' && turn.text.trim() && !turn.toolCalls.length) {
          summary = turn.text;
          raw = turn.raw;
        }
      } catch {
        // A failed summary must not obscure the action limit or echo provider diagnostics.
      }
      await terminal(summary, raw);
      await finish(
        'failed',
        'The assistant action limit was reached; completed changes remain saved.',
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

function notExecuted(message: string): ToolOutcome {
  const error: OperationErrorBody = { code: 'invalid_state', message };
  return { outcome: 'failed', result: error, error };
}

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
  if (page.selectedSource) {
    const { source, passage, section } = page.selectedSource;
    const read = {
      source: {
        document: source.document,
        version: source.version,
        file: source.file,
        sha256: source.sha256,
        parse:
          source.parse.status === 'parsed'
            ? { status: 'parsed', snapshot: source.parse.snapshot }
            : { status: 'unavailable', reason: 'No checked text selected' },
        title: 'Selected instructions',
      },
      ...(passage === undefined ? {} : { passages: [passage] }),
      ...(section === undefined ? {} : { section }),
    };
    return `${text}\n\n[Historical instructions reference for this message (library.read input): ${JSON.stringify(read)}. This identifies the selection attached to this message, not the current selection, source contents or approval. Read this exact reference through library.read before claiming its contents or authoritative edition metadata; handle lost access explicitly without substituting current text. An unavailable parse remains unchecked.]`;
  }
  const where = page.title ? `${page.title} (${page.path})` : page.path;
  const record = page.record
    ? `; it shows ${page.record.name} (${page.record.id}) at version ${page.record.version}`
    : '';
  return `${text}\n\n[Sent from the page: ${where}${record}]`;
}

/**
 * What people decided about the changes this conversation proposed, so the assistant knows which
 * were rejected and why before it answers again (review 2026-10-01 I13).
 */
async function decidedProposals(
  db: Db,
  ctx: RecordContext,
  conversationId: string,
): Promise<string> {
  const rows = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.labId, ctx.labId),
        sql`${proposals.proposedBy}->>'sessionRef' = ${conversationId}`,
        ne(proposals.status, 'pending'),
      ),
    )
    .orderBy(asc(proposals.proposedAt));
  if (rows.length === 0) return '';
  const lines = rows.map((row) => {
    const why = row.decisionReason ? `: "${row.decisionReason}"` : '';
    const what = row.reason ? ` (${row.reason})` : '';
    const outcome =
      row.status === 'approved'
        ? 'confirmed and applied'
        : row.status === 'rejected'
          ? `rejected${why}`
          : `confirmed, but it failed when applied${row.error ? `: ${row.error.message}` : ''}`;
    return `- ${row.id}, ${row.operationId}${what}: ${outcome}`;
  });
  return `\n\nWhat people decided about the changes you proposed in this conversation. Don't propose a rejected change again unless the person asks; if the reason says what to change, do that. A reason that says how the lab always does something is a possible lab memory: ask once whether to remember it for the lab, then memory.propose.\n${lines.join('\n')}`;
}

/**
 * Values this conversation filled that a person has since changed (plan 005c-1b, M15): each one
 * may be how the lab does things, so the agent is told and asks once whether to remember it.
 */
async function personEdits(
  deps: OperationDeps,
  ctx: RecordContext,
  conversationId: string,
): Promise<string> {
  const rows = await deps.db
    .select({ recordIds: activity.recordIds })
    .from(activity)
    .where(
      and(
        eq(activity.labId, ctx.labId),
        eq(activity.outcome, 'succeeded'),
        sql`${activity.actor}->>'sessionRef' = ${conversationId}`,
      ),
    )
    .orderBy(desc(activity.at))
    .limit(50);
  const ids = [...new Set(rows.flatMap((r) => r.recordIds))].slice(0, 20);
  const records = new RecordService(deps.db, deps.kinds);
  const lines: string[] = [];
  for (const id of ids) {
    const record = await records.get(ctx, id).catch(() => undefined);
    if (!record) continue;
    const history = await records.history(ctx, id);
    for (const [field, now] of Object.entries(record.evidence ?? {})) {
      if (now.source !== 'person' || field.startsWith('/')) continue;
      const mine = history.find((v) => {
        const by = v.snapshot.evidence?.[field]?.by;
        return by?.type === 'agent' && by.sessionRef === conversationId;
      });
      if (!mine) continue;
      const was = JSON.stringify((mine.snapshot.attributes as Record<string, unknown>)[field]);
      const is = JSON.stringify((record.attributes as Record<string, unknown>)[field]);
      if (was === is) continue;
      lines.push(`- ${record.name} ${field}: you filled ${was}; a person changed it to ${is}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\nValues you filled in this conversation that a person has since changed. When a change looks like how the lab always does it (not a one-off), it is a possible lab memory: ask once whether to remember it for the lab, then memory.propose.\n${lines.slice(0, 10).join('\n')}`;
}

/**
 * The lab memory the assistant gets without asking (plan 005b, M7): memories about the record on
 * the page and the records it links to, plus the lab-wide rules, one line each, capped.
 */
async function memoryNote(
  deps: OperationDeps,
  ctx: RecordContext,
  ask: MessageRow['body'] | undefined,
): Promise<{ text: string; used: UsedMemory[] }> {
  const page = ask?.role === 'user' ? ask.page?.record?.id : undefined;
  const records = page ? [page, ...(await nearby(deps, ctx, [page]))] : [];
  const { matches } = lookup(await activeMemories(deps, ctx), ctx, { records });
  const { lines, memories } = bundle(matches, MEMORY_LINES);
  if (lines.length === 0) return { text: '', used: [] };
  const used = memories.map(({ id, name, statement, strength }) => ({
    id,
    name,
    statement,
    strength,
  }));
  const text = `\n\nLab memory${page ? ' for this page' : ''}, confirmed by people. Follow a rule, or say why you didn't; use a default unless the person or a confirmed record says otherwise; a note only informs. Name the memory (e.g. MEM-0004) when it shaped what you did. memory.for gives the memories for a particular piece of work.\n${lines.map((l) => `- ${l}`).join('\n')}`;
  return { text, used };
}

async function systemPrompt(db: Db, ctx: RecordContext, conversationId: string): Promise<string> {
  const [user] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, personOf(ctx)));
  const [lab] = await db.select({ name: labs.name }).from(labs).where(eq(labs.id, ctx.labId));
  return `For a request to create or edit a draft, carry the request through to saved work in this turn. After reading the relevant source and checking for an existing target, perform the smallest supported draft operation before optional catalogue exploration. Missing scientific details belong in open questions; keep unsupported settings out of the procedure and let readiness block use. The request already authorizes draft creation, but never confirmation or invented physical inventory. Do not end with a promise to draft or investigate. End with actual saved or proposed work and its next scientific decision, or state specifically why no draft could be saved.

You are the lab assistant in AILaboratory, a lab management system. You work for ${user?.name ?? 'a lab member'} in ${lab?.name ?? 'their lab'}.

You act only through the lab's operations, which are your tools. Everything you change is recorded in the lab's activity ledger under your name, on behalf of that person.

- Look things up before you change them. Read tools change nothing. For kinds, sections and keyed-list discovery, use records_kinds with summary: true. Before generic records_create, including supporting registry records, read only the named kind's attribute schema with kinds: ["product"] if it is not already available. A module draft operation such as sops_draft uses its offered input schema; it does not require the full SOP kind schema merely to save a draft.
- Your named tools cover records, review, skills, the calculators and the module of the page you are on. Use their offered input schemas directly. When a relevant skill names the operation you need, request its missing schema with operations_describe by ids and call it with run_operation; do not list its namespace first. When you need to discover which operation is relevant, use operations_describe (schema: false and namespace, e.g. "sops"), then request schemas only for the needed ids. Do not redescribe operation schemas already available in your tools or this conversation.
- Some changes are proposed rather than made: the result then has status "proposed" and waits for a person to confirm it on the Review page. Say that plainly; never say a proposed change is done.
- You draft; people confirm. Create records as drafts. Values you set are marked "assumed" until a person confirms them. Say where each value came from in "evidence": "stated" for values the person told you (e.g. {"color": {"source": "stated"}}), "datasheet", "imported" or "measured" with a reference when you used one; "calculated" with the "calculation" handle a calculator returned (and "output", a pointer into its output, when the value is one part of it); "record" or "template" with "from": {id, version} when you copied the value from a confirmed record. For a list the kind keys by item (an SOP's steps by id, variables by name), evidence can name one item as "/steps/<id>". Values you estimated get no evidence and show as assumed. Never name a source you did not use.
- A person confirms a draft with one Confirm on its page or on Review, which makes it active; you can't confirm. Use records_readiness to see what is confirmed, what changed, what was assumed and which checks fail.
- Changes that belong together (a record and the records it links to, several edits for one ask) go in one changes_apply call with a reason: they run in order, all or nothing, and when any step needs a person the whole set is one proposal they confirm or reject at once. Don't propose them one by one.
- The app adds a linked "Waiting for you" line under your reply listing the drafts and proposed changes you left, so don't write one yourself; just say briefly what you did and anything you assumed.
- To edit a record, read it first (records_get with brief: true, which leaves out the confirmations) for its current version and attributes, then send records_update the complete attributes with your change, and that version as expectedVersion.
- Long results are cut at ${MAX_RESULT_CHARS / 1000}k characters. Ask for less: review_list puts its counts first and takes a limit; operations_describe with schema: false lists a namespace's operations without their schemas when discovery is needed. For known operations, request only missing schemas by ids directly.
- The person may attach files; each shows as [Attached file file_…] with the start of its text. To give a whole file to a tool, put {"$file": "file_…"} where the value goes (e.g. labware_import_opentrons with {"definition": {"$file": "file_…"}}); never retype a file's contents.
- Some tools return a file (an Opentrons definition, a worklist; their description says so). The app shows it under your reply with Download and Copy buttons, so don't copy its contents into your reply: say what it is and answer questions about it briefly.
- Every quantity has a unit, e.g. {"value": "50", "unit": "uL"}.
- If a tool refuses, read its message, fix the input and try again, or tell the person what you need.
- Never invent records, results or instrument behaviour. If you don't know, say so.
- Answer briefly, in plain lab language. Call records by their name (e.g. WDG-0001), not their internal ID, unless asked.
- The person's messages may end with the page they sent it from; "this" usually means what is on that page.
- Each module has a skill that explains its operations (skills_list lists them). Read a module's skill with skills_get before you first work in it.

The calculators skill, which you always follow:

${findSkill('calculators')?.text ?? ''}${SCIENTIFIC_INTAKE_PROMPT}${await decidedProposals(db, ctx, conversationId)}`;
}

export { toolName, toolsFor } from './toolset.ts';

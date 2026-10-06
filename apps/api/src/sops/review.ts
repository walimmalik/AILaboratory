import { newId } from '@ailab/domain';
import {
  type Actor,
  Citation,
  type EvidenceInput,
  type Readiness,
  type RecordEnvelope,
  type ReviewFinding,
  type ScientificQuestion,
  SopAttributes,
  SopName,
  type SopReviewRound,
} from '@ailab/schema';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ChatModel, ModelMessage, ModelTool, ModelToolCall } from '../assistant/model.ts';
import { sopReviews } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { checkCitations, type Passage } from './citations.ts';
import {
  canonicalizeSopExactSource,
  readSopExactSource,
  SopExactSourceCache,
} from './exact-source.ts';
import { updateSourceCheckedSop } from './exact-source-write.ts';
import { sop as sopKind } from './kinds.ts';
import { operationalSop } from './questions.ts';

/**
 * The AI review cycle for draft SOPs (plan 012 G11, ADR 0038). A reviewer model reads the draft,
 * its cited passages, the source text and the deterministic checks, then fixes what the source
 * settles and asks where it doesn't, through three tools. Each accepted change is a finding with its
 * reason and passage; a round's changes land as one record update, and the round is kept.
 */

const MAX_STEPS = 8;
const MODEL_TIMEOUT_MS = 180_000;
/** Enough source text for a long SOP without flooding a small model. */
const MAX_SOURCE_CHARS = 60_000;

const FixInput = z.strictObject({
  path: z
    .string()
    .min(2)
    .describe('A JSON pointer into the SOP, e.g. /steps/2/parameters/0/quantity'),
  value: z.unknown().optional().describe('The new value; leave out with remove'),
  remove: z
    .literal(true)
    .optional()
    .describe('Remove what is at path (e.g. a step the source lacks)'),
  reason: z.string().min(1).describe('One line, e.g. "step 3 of the source says 300 uL"'),
  cite: Citation.optional().describe('The passage the fix relies on'),
});

const AskInput = z.strictObject({
  question: z.string().min(1),
  suggestion: z.string().min(1).optional(),
  about: z
    .strictObject({
      step: z.string().min(1).optional(),
      variable: SopName.optional(),
      material: SopName.optional(),
    })
    .optional(),
  passages: z.array(Citation).optional(),
});

const FinishInput = z.strictObject({ summary: z.string().min(1) });

const TOOLS: ModelTool[] = [
  {
    name: 'sop_fix',
    description:
      'Fix one value the source settles: the draft contradicts its cited passage, a unit or arithmetic error, or a step the source states but the draft missed (append with /steps/-). Give the reason and the passage.',
    inputSchema: z.toJSONSchema(FixInput) as Record<string, unknown>,
  },
  {
    name: 'sop_ask',
    description:
      'Ask an open question where the source is unclear: it contradicts itself, hedges ("about 1 uL"), leaves a value out, or the fix is a judgment call. Give your suggested answer and the passages involved.',
    inputSchema: z.toJSONSchema(AskInput) as Record<string, unknown>,
  },
  {
    name: 'sop_finish',
    description: 'End the round with a one-line summary of what you checked and changed.',
    inputSchema: z.toJSONSchema(FinishInput) as Record<string, unknown>,
  },
];

const SYSTEM = `You review a draft digital SOP against its source before a person sees it.
Check every step, material, variable, timing window and layout need against the cited passages and the source text.
Fix only what the source settles, one change per sop_fix call, each with a one-line reason and the passage.
Where the source is ambiguous, ask with sop_ask instead of fixing. Never invent values the source doesn't give.
Quotes must be the source's own words. Keep step text in plain lab language.
When you have nothing more to change, call sop_finish.`;

type Tokens = (string | number)[];

function tokensOf(path: string): Tokens {
  if (!path.startsWith('/')) throw new Error('A path starts with /');
  return path
    .slice(1)
    .split('/')
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function at(root: unknown, tokens: Tokens): unknown {
  let node = root;
  for (const t of tokens) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[String(t)];
  }
  return node;
}

/** Sets or removes the value at a path in a copy; a missing parent or an index past the end is refused. */
function changed(root: unknown, tokens: Tokens, value: unknown, remove: boolean): unknown {
  const copy = structuredClone(root);
  const parent = at(copy, tokens.slice(0, -1));
  const last = String(tokens.at(-1));
  if (parent === null || typeof parent !== 'object') throw new Error('Nothing is at that path');
  if (Array.isArray(parent)) {
    const index = last === '-' ? parent.length : Number(last);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`No item ${last} in a list of ${parent.length}`);
    }
    if (remove) {
      if (index >= parent.length) throw new Error(`No item ${last} to remove`);
      parent.splice(index, 1);
    } else if (index === parent.length) parent.push(value);
    else parent[index] = value;
  } else if (remove) {
    if (!(last in parent)) throw new Error(`Nothing at ${last} to remove`);
    delete (parent as Record<string, unknown>)[last];
  } else (parent as Record<string, unknown>)[last] = value;
  return copy;
}

const issues = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('/') || 'SOP'}: ${i.message}`)
    .join('; ');

function brief(
  record: RecordEnvelope,
  a: SopAttributes,
  failing: string[],
  citations: Awaited<ReturnType<typeof checkCitations>>['citations'],
  source: Passage[] | undefined,
): string {
  const problems = citations.filter((c) => c.result !== 'matches');
  let text = source?.map((p) => `[${p.id}${p.page ? `, p. ${p.page}` : ''}] ${p.text}`).join('\n');
  if (text && text.length > MAX_SOURCE_CHARS) text = `${text.slice(0, MAX_SOURCE_CHARS)}\n[…cut]`;
  return [
    `SOP ${record.name} "${record.label}" (paths below are into this JSON):`,
    JSON.stringify(a, null, 1),
    failing.length
      ? `Readiness checks failing:\n- ${failing.join('\n- ')}`
      : 'All readiness checks pass.',
    problems.length
      ? `Citations whose text could not be checked:\n- ${problems.map((c) => `${c.where}: "${c.quote}"; ${c.uncheckedReason === 'edition_not_established' ? 'Edition not established' : 'Text could not be checked'}`).join('\n- ')}`
      : 'Every cited quote is in its passage.',
    text
      ? `Source document ${a.source?.document}, passage ids in brackets:\n${text}`
      : 'Instructions could not be checked. No exact checked text is available; do not use current text or treat stored quotations as verified evidence.',
  ].join('\n\n');
}

export interface ReviewOutcome {
  sop: RecordEnvelope;
  rounds: SopReviewRound[];
  stopped: 'clean' | 'rounds' | 'failed';
  problem?: string;
}

/** Runs up to `rounds` review rounds on a draft SOP with the given model. */
export async function reviewSop(
  deps: OperationDeps,
  ctx: RecordContext,
  input: {
    sop: string;
    expectedVersion: number;
    rounds?: number | undefined;
    reason?: string | undefined;
  },
  model: ChatModel,
  reviewerName: string,
): Promise<ReviewOutcome> {
  const service = new RecordService(deps.db, deps.kinds);
  let record = await service.get(ctx, input.sop);
  if (record.kind !== 'sop')
    throw new OperationError('invalid_input', `${record.name} is not an SOP`);
  await service.assertSopEditable(ctx, record.id);
  operationalSop(record.attributes);
  if (record.status !== 'draft') {
    throw new OperationError(
      'invalid_state',
      `${record.name} is ${record.status}; only drafts are reviewed`,
    );
  }
  if (record.version !== input.expectedVersion) {
    throw new OperationError(
      'version_conflict',
      `${record.name} is at version ${record.version}, not ${input.expectedVersion}`,
    );
  }
  const reviewer: Actor = {
    type: 'agent',
    agentName: reviewerName,
    onBehalfOf: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf,
  };
  const { approvedBy: _approval, ...unconfirmed } = ctx;
  const reviewerCtx: RecordContext = { ...unconfirmed, actor: reviewer, via: 'sops.review' };
  const cache = new SopExactSourceCache();
  const earlier = await roundsOf(deps, ctx, record.id);
  const rounds: SopReviewRound[] = [];
  const limit = input.rounds ?? 2;
  const get = (id: string) => service.get(ctx, id).catch(() => undefined);
  const list = (kind: string) => service.list(ctx, { kind, limit: 1000 });

  for (let n = 1; n <= limit; n++) {
    const a = record.attributes as SopAttributes;
    const readiness = await deps.registry.execute(
      ctx,
      'records.readiness',
      { id: record.id },
      {},
      deps.db,
    );
    const failing =
      readiness.status === 'done'
        ? (readiness.output as Readiness).checks
            .filter((c) => !c.passed)
            .map((c) => `${c.label} (${c.severity}): ${c.message ?? ''}`)
        : [];
    const { citations, source: checkedSource } = await checkCitations(deps, ctx, a, cache);
    const source = checkedSource.status === 'checked' ? checkedSource.passages : undefined;

    let working: SopAttributes = a;
    const findings: ReviewFinding[] = [];
    const refused: SopReviewRound['refused'] = [];
    let summary: string | undefined;
    let asked = 0;
    const messages: ModelMessage[] = [
      { role: 'user', text: brief(record, a, failing, citations, source) },
    ];
    if (checkedSource.status !== 'unbound' && checkedSource.warnings.length)
      messages.push({
        role: 'user',
        text: `Conversion limitations for these selected instructions: ${checkedSource.warnings.join('; ')}. Text occurrence does not establish scientific validity or human confirmation.`,
      });

    const handle = async (call: ModelToolCall): Promise<string> => {
      if (call.name === 'sop_finish') {
        const parsed = FinishInput.safeParse(call.input);
        summary = parsed.success ? parsed.data.summary : undefined;
        return 'Round ended.';
      }
      if (call.name === 'sop_ask') {
        const parsed = AskInput.safeParse(call.input);
        if (!parsed.success) throw new Error(issues(parsed.error));
        asked += 1;
        const question: ScientificQuestion = {
          id: `review-${earlier.length + n}-${asked}`,
          question: parsed.data.question,
          stage: { stage: 'method', reason: 'The source leaves the method unclear' },
          responses: [],
          disposition: { status: 'open' },
          ...(parsed.data.about ? { about: parsed.data.about } : {}),
          ...(parsed.data.suggestion ? { suggestion: parsed.data.suggestion } : {}),
          ...(parsed.data.passages ? { passages: parsed.data.passages } : {}),
        };
        const next = { ...working, questions: [...(working.questions ?? []), question] };
        await accept(next);
        const savedQuestion = working.questions?.at(-1) ?? question;
        findings.push({
          type: 'question',
          path: `/questions/${(next.questions?.length ?? 1) - 1}`,
          after: savedQuestion,
          reason: parsed.data.suggestion ? `Suggests: ${parsed.data.suggestion}` : 'Needs a person',
          ...(savedQuestion.passages?.[0] ? { cite: savedQuestion.passages[0] } : {}),
        });
        return `Asked as question ${question.id}.`;
      }
      if (call.name === 'sop_fix') {
        const parsed = FixInput.safeParse(call.input);
        if (!parsed.success) throw new Error(issues(parsed.error));
        const { path, value, remove, reason } = parsed.data;
        let cite = parsed.data.cite;
        if (cite) {
          const checked = await readSopExactSource(deps, ctx, working, cache, [
            { where: 'review fix', cite },
          ]);
          if (checked.status !== 'checked')
            throw new Error('No established checked edition supports this citation');
          cite = checked.citations.at(-1)?.cite;
        }
        if (!remove && value === undefined) throw new Error('Give a value, or remove: true');
        const tokens = tokensOf(path);
        if (tokens[0] === 'questions')
          throw new Error('Ask questions with sop_ask; people answer them');
        if (tokens[0] === 'source' || tokens[0] === 'derivedFrom') {
          throw new Error('The source and what it derives from are not the reviewer’s to change');
        }
        const before = at(working, tokens);
        await accept(changed(working, tokens, value, remove === true));
        findings.push({
          type: 'fix',
          path,
          ...(before === undefined ? {} : { before }),
          ...(remove ? {} : { after: value }),
          reason,
          ...(cite ? { cite } : {}),
        });
        return 'Fixed.';
      }
      throw new Error(`Unknown tool ${call.name}; use sop_fix, sop_ask or sop_finish`);
    };
    /** Takes a changed SOP when it is still a valid SOP whose references hold. */
    const accept = async (next: unknown) => {
      const parsed = SopAttributes.safeParse(next);
      if (!parsed.success)
        throw new Error(`That would make the SOP invalid: ${issues(parsed.error)}`);
      const related = await sopKind.related?.(parsed.data, {
        get,
        getVersion: async () => undefined,
        list,
        reservedPrefixes: [],
      });
      if (related?.invalid?.length) throw new Error(related.invalid.join('; '));
      if (stable(parsed.data.source) !== stable(a.source))
        throw new Error('Preserve the saved source; adoption is a separate decision');
      const canonical = await canonicalizeSopExactSource(deps, ctx, parsed.data);
      if (
        canonical.result.status !== 'checked' &&
        stable(canonical.result.citations) !== stable(checkedSource.citations)
      )
        throw new Error('Edition not established; new source claims cannot be checked');
      working = canonical.attributes;
    };

    let continuing = false;
    try {
      for (let step = 0; step < MAX_STEPS && summary === undefined; step++) {
        const turn = await model.complete({
          system: SYSTEM,
          messages,
          tools: TOOLS,
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });
        messages.push({
          role: 'assistant',
          text: turn.text,
          toolCalls: turn.toolCalls,
          ...(turn.raw === undefined ? {} : { raw: turn.raw }),
        });
        if (turn.stop === 'refusal' || turn.stop === 'max_tokens') {
          throw new Error(
            turn.stop === 'refusal'
              ? 'The model declined the review; its suggestions were not applied.'
              : 'The review reply was cut off; its suggestions were not applied.',
          );
        }
        continuing = turn.stop === 'continue';
        if (continuing && turn.toolCalls.length === 0) continue;
        if (turn.toolCalls.length === 0) break;
        for (const call of turn.toolCalls) {
          try {
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: await handle(call),
              isError: false,
            });
          } catch (error) {
            const problem = error instanceof Error ? error.message : String(error);
            refused.push({ tool: call.name, problem });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: problem,
              isError: true,
            });
          }
        }
      }
      if (continuing && summary === undefined)
        throw new Error(`The reviewer did not finish within ${MAX_STEPS} turns.`);
    } catch (error) {
      return {
        sop: record,
        rounds,
        stopped: 'failed',
        problem: `The reviewer model failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const fromVersion = record.version;
    if (findings.length > 0) {
      record = await updateSourceCheckedSop(deps, reviewerCtx, {
        sop: record.id,
        expectedVersion: record.version,
        attributes: working,
        evidence: evidenceOf(findings, working),
        reason:
          input.reason ??
          `Review round ${earlier.length + n}: ${count(findings, 'fix')} fixes, ${count(findings, 'question')} questions`,
      });
    }
    const row = {
      id: newId('rvw'),
      orgId: ctx.orgId,
      labId: ctx.labId,
      sopId: record.id,
      round: earlier.length + n,
      model: `${model.provider}/${model.model}`,
      fromVersion,
      toVersion: findings.length > 0 ? record.version : null,
      findings,
      refused,
      summary: summary ?? null,
      by: reviewer,
      at: new Date(),
    };
    await deps.db.insert(sopReviews).values(row);
    rounds.push(toRound(row));
    if (findings.length === 0) return { sop: record, rounds, stopped: 'clean' };
  }
  return { sop: record, rounds, stopped: 'rounds' };
}

const count = (findings: ReviewFinding[], type: ReviewFinding['type']) =>
  findings.filter((f) => f.type === type).length;

/** Only the changed stable item receives citation-backed attribution; other section values remain unchecked. */
function evidenceOf(
  findings: ReviewFinding[],
  after: SopAttributes,
): Record<string, EvidenceInput> {
  const out: Record<string, EvidenceInput> = {};
  for (const f of findings) {
    const tokens = tokensOf(f.path);
    const field = tokens[0] as string;
    if (field === 'questions') continue;
    const key = sopKind.items?.[field];
    const list = (after as unknown as Record<string, unknown>)[field];
    const index = tokens[1] === '-' && Array.isArray(list) ? list.length - 1 : Number(tokens[1]);
    const item =
      f.after === undefined && tokens.length === 2
        ? undefined
        : Array.isArray(list)
          ? list[index]
          : undefined;
    const id = key && item && typeof item === 'object' ? item[key] : undefined;
    const target = typeof id === 'string' ? `/${field}/${id}` : field;
    if (out[target]?.source === 'stated') continue;
    out[target] = {
      source: f.cite && f.type === 'fix' && (!key || typeof id === 'string') ? 'stated' : 'assumed',
      note: `Reviewer: ${f.reason}`.slice(0, 500),
      ...(f.cite ? { reference: f.cite.document } : {}),
    };
  }
  return out;
}

function toRound(row: typeof sopReviews.$inferSelect): SopReviewRound {
  return {
    id: row.id,
    sop: row.sopId,
    round: row.round,
    model: row.model,
    fromVersion: row.fromVersion,
    ...(row.toVersion === null ? {} : { toVersion: row.toVersion }),
    findings: row.findings,
    refused: row.refused,
    ...(row.summary === null ? {} : { summary: row.summary }),
    at: row.at.toISOString(),
  };
}

/** The review rounds kept with an SOP, oldest first. */
export async function roundsOf(
  deps: Pick<OperationDeps, 'db'>,
  ctx: RecordContext,
  sop: string,
): Promise<SopReviewRound[]> {
  const rows = await deps.db
    .select()
    .from(sopReviews)
    .where(and(eq(sopReviews.labId, ctx.labId), eq(sopReviews.sopId, sop)))
    .orderBy(asc(sopReviews.round));
  return rows.map(toRound);
}

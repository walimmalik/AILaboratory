import { evaluateVariables } from '@ailab/domain';
import { type SopAttributes, SopStep, SopVariable } from '@ailab/schema';
import { z } from 'zod';
import type { ChatModel, ModelMessage, ModelTool, ModelToolCall } from '../assistant/model.ts';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { type Passage, passagesOf } from './citations.ts';
import { sopVariableDefinitions } from './kinds.ts';

/**
 * The assistant's fill-in for the SOP editor (ADR 0046): one value, one step's settings, a new step
 * from a sentence, or every step from the source. The model answers through one tool; the answer is
 * checked like the record would check it (formulas with the calculator, steps against the SOP's
 * materials and values) and a refusal goes back to the model with the reason. Nothing is written:
 * the editor shows the suggestion as assumed until a person keeps or changes it.
 */

/** One answer and one retry with the reason it was refused: a person waits on this in the editor. */
const MAX_TURNS = 2;
/** How long one answer may take; drafting every step from a document gets longer. */
export const SUGGEST_TIMEOUT_MS = 45_000;
export const DRAFT_TIMEOUT_MS = 90_000;
const MAX_SOURCE_CHARS = 40_000;

export type SuggestInput = {
  sop: string;
  attributes?: Record<string, unknown> | undefined;
  value?: string | undefined;
  step?: string | undefined;
  newStep?: string | undefined;
  steps?: true | undefined;
};

export interface Suggestion {
  variable?: SopVariable;
  steps?: SopStep[];
  reason: string;
  model: string;
}

const ValueAnswer = z.strictObject({
  kind: z.enum(['input', 'default', 'record', 'computed']),
  value: SopVariable.shape.value,
  expression: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  readFrom: SopVariable.shape.readFrom,
  reason: z
    .string()
    .min(1)
    .describe('One line: what it rests on, e.g. "step 4 says 100 uL per well"'),
});

const StepsAnswer = z.strictObject({
  steps: z.array(z.unknown()).min(1),
  reason: z.string().min(1).describe('One line: what the steps rest on'),
});

const VALUE_TOOL: ModelTool = {
  name: 'sop_value',
  description:
    "Give the value: computed with an expression over the SOP's values by technical name (e.g. wells * well_volume * 1.1) and an optional unit for the result; default or input with a value (a decimal string, {value, unit}, or a list); or record with readFrom {role, field} and a typical value.",
  inputSchema: z.toJSONSchema(ValueAnswer) as Record<string, unknown>,
};

const STEPS_TOOL: ModelTool = {
  name: 'sop_steps',
  description:
    'Give the steps as SOP steps: id, action, title, text in lab words with values and materials as `technical_name` in backticks, uses (material roles), parameters (name with variable, quantity {value, unit}, number or text), repeat.',
  inputSchema: z.toJSONSchema(StepsAnswer) as Record<string, unknown>,
};

const SYSTEM = `You help a scientist fill in a digital SOP in its editor.
Answer with exactly one tool call. Use only the values and materials the SOP has, by technical name.
Formulas: + - * / ^, parentheses, numbers with units (50 uL, 1.1), and ceil, floor, round, roundup(x, step), rounddown(x, step), min, max, sum, count.
Step text stays close to the source's words, in plain lab language, with values and materials written as \`technical_name\`.
Never invent a number the source or the SOP doesn't give; if you must estimate, say so in the reason.`;

const issues = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('/') || 'answer'}: ${i.message}`)
    .join('; ');

/** The SOP as the editor has it: lists default to empty so a half-written SOP can be read. */
type Working = Pick<SopAttributes, 'materials' | 'variables' | 'steps'> & Partial<SopAttributes>;

function workingOf(attributes: Record<string, unknown>): Working {
  const list = (key: string) => (Array.isArray(attributes[key]) ? attributes[key] : []);
  return {
    ...(attributes as Partial<SopAttributes>),
    materials: list('materials') as Working['materials'],
    variables: list('variables') as Working['variables'],
    steps: list('steps') as Working['steps'],
  };
}

const roles = (a: Working) =>
  new Set([
    ...a.materials.map((m) => m.role),
    ...(a.solutions ?? []).map((s) => s.role),
    ...a.steps.flatMap((s) => (s.produces ?? []).map((p) => p.role)),
  ]);

/** Checks one suggested step against the SOP: its schema, the materials it uses, its values. */
function checkStep(raw: unknown, a: Working): SopStep {
  const parsed = SopStep.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a valid step: ${issues(parsed.error)}`);
  const step = parsed.data;
  const known = roles(a);
  const values = new Set(a.variables.map((v) => v.name));
  for (const role of step.uses ?? []) {
    if (!known.has(role)) throw new Error(`Step ${step.id} uses ${role}, which is not a material`);
  }
  for (const p of step.parameters ?? []) {
    if (p.variable && !values.has(p.variable))
      throw new Error(`Step ${step.id}'s ${p.name} is ${p.variable}, which is not a value`);
  }
  for (const [, name] of step.text.matchAll(/`([^`]+)`/g)) {
    if (name && !known.has(name) && !values.has(name))
      throw new Error(`Step ${step.id} names \`${name}\`, which is neither a value nor a material`);
  }
  return step;
}

function freshId(taken: Set<string>): string {
  let n = taken.size + 1;
  while (taken.has(`s${n}`)) n++;
  taken.add(`s${n}`);
  return `s${n}`;
}

function sourceText(passages: Passage[] | undefined): string | undefined {
  let text = passages
    ?.map((p) => `[${p.id}${p.page ? `, p. ${p.page}` : ''}] ${p.text}`)
    .join('\n');
  if (text && text.length > MAX_SOURCE_CHARS) text = `${text.slice(0, MAX_SOURCE_CHARS)}\n[…cut]`;
  return text;
}

export async function suggestSop(
  deps: OperationDeps,
  ctx: RecordContext,
  input: SuggestInput,
  model: ChatModel,
): Promise<Suggestion> {
  const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.sop);
  if (record.kind !== 'sop')
    throw new OperationError('invalid_input', `${record.name} is not an SOP`);
  const a = workingOf(input.attributes ?? record.attributes);

  const variable = input.value ? a.variables.find((v) => v.name === input.value) : undefined;
  if (input.value && !variable)
    throw new OperationError('invalid_input', `${record.name} has no value ${input.value}`);
  const step = input.step ? a.steps.find((s) => s.id === input.step) : undefined;
  if (input.step && !step)
    throw new OperationError('invalid_input', `${record.name} has no step ${input.step}`);
  const passages = a.source ? await passagesOf(deps, ctx, a.source.document) : undefined;
  if (input.steps && !passages?.length) {
    throw new OperationError(
      'invalid_state',
      `${record.name} has no source document with text to draft steps from`,
    );
  }

  const ask = variable
    ? `Fill in the value ${variable.name} ("${variable.label}"). Now: ${JSON.stringify(variable)}. Answer with sop_value.`
    : step
      ? `Fill in step ${step.id}'s uses and parameters from its words, keeping its id, action and text unless they are wrong. Now: ${JSON.stringify(step)}. Answer with sop_steps, one step.`
      : input.newStep
        ? `Write one new step from this sentence: "${input.newStep}". Answer with sop_steps, one step.`
        : 'Draft every step of the procedure from the source document, in order, with ids s1, s2… Answer with sop_steps.';
  const source = sourceText(passages);
  const messages: ModelMessage[] = [
    {
      role: 'user',
      text: [
        `SOP ${record.name} "${record.label}", as edited:`,
        JSON.stringify(
          {
            materials: a.materials,
            solutions: a.solutions ?? [],
            variables: a.variables,
            steps: input.steps ? [] : a.steps,
          },
          null,
          1,
        ),
        source ? `Source document, passage ids in brackets:\n${source}` : 'No source text.',
        ask,
      ].join('\n\n'),
    },
  ];
  const tool = variable ? VALUE_TOOL : STEPS_TOOL;
  const name = `${model.provider}/${model.model}`;

  const handle = (call: ModelToolCall): Suggestion => {
    if (call.name !== tool.name) throw new Error(`Use ${tool.name}`);
    if (variable) {
      const parsed = ValueAnswer.safeParse(call.input);
      if (!parsed.success) throw new Error(issues(parsed.error));
      const { reason, ...fields } = parsed.data;
      const next = SopVariable.safeParse({
        name: variable.name,
        label: variable.label,
        ...(variable.note ? { note: variable.note } : {}),
        ...(variable.cite ? { cite: variable.cite } : {}),
        ...fields,
      });
      if (!next.success) throw new Error(issues(next.error));
      const v = next.data;
      if (v.kind === 'computed' && !v.expression)
        throw new Error('A computed value needs its formula');
      if (v.kind === 'record') {
        if (!v.readFrom) throw new Error('A value read from a material needs readFrom');
        if (!roles(a).has(v.readFrom.role))
          throw new Error(`${v.readFrom.role} is not a material of this SOP`);
      } else if (v.kind !== 'computed' && v.value === undefined) {
        throw new Error('Give the value');
      }
      if (v.kind === 'computed') {
        const others = a.variables.filter((o) => o.name !== v.name);
        const outcome = evaluateVariables(
          sopVariableDefinitions({ ...(a as SopAttributes), variables: [...others, v] }),
        ).get(v.name);
        // A formula waiting on a value that has none yet is fine; a formula that can't work is not.
        if (outcome && !outcome.ok && !outcome.waitsOn?.length)
          throw new Error(`The formula doesn't work: ${outcome.error}`);
      }
      return { variable: v, reason, model: name };
    }
    const parsed = StepsAnswer.safeParse(call.input);
    if (!parsed.success) throw new Error(issues(parsed.error));
    if (!input.steps && parsed.data.steps.length !== 1) throw new Error('Give exactly one step');
    const taken = new Set(input.steps ? [] : a.steps.map((s) => s.id));
    const steps = parsed.data.steps.map((raw) => {
      const item = { ...(raw as Record<string, unknown>) };
      // The step being filled keeps its id; a new one gets the next free id.
      if (step) item.id = step.id;
      else if (typeof item.id !== 'string' || taken.has(item.id)) item.id = freshId(taken);
      else taken.add(item.id);
      return checkStep(item, a);
    });
    return { steps, reason: parsed.data.reason, model: name };
  };

  const limit = input.steps ? DRAFT_TIMEOUT_MS : SUGGEST_TIMEOUT_MS;
  let problem = 'The assistant gave no answer';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let answer: Awaited<ReturnType<ChatModel['complete']>>;
    // Adapters wrap an aborted request in their own error, so the signal says whether time ran out.
    const signal = AbortSignal.timeout(limit);
    try {
      answer = await model.complete({ system: SYSTEM, messages, tools: [tool], signal });
    } catch (error) {
      if (signal.aborted) {
        throw new OperationError(
          'invalid_state',
          `The assistant did not answer within ${limit / 1000} seconds; try again, or fill it in yourself`,
        );
      }
      throw new OperationError(
        'invalid_state',
        `The assistant's model failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    messages.push({
      role: 'assistant',
      text: answer.text,
      toolCalls: answer.toolCalls,
      ...(answer.raw === undefined ? {} : { raw: answer.raw }),
    });
    const call = answer.toolCalls[0];
    if (!call) {
      messages.push({ role: 'user', text: `Answer with ${tool.name}.` });
      continue;
    }
    try {
      return handle(call);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: problem,
        isError: true,
      });
      for (const extra of answer.toolCalls.slice(1)) {
        messages.push({
          role: 'tool',
          toolCallId: extra.id,
          name: extra.name,
          content: 'Ignored; one call at a time.',
          isError: true,
        });
      }
    }
  }
  throw new OperationError('invalid_state', `No usable suggestion: ${problem}`);
}

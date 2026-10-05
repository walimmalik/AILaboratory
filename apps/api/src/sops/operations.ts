import {
  evaluateVariables,
  isUnit,
  scoreSop,
  type VariableDefinition,
  type VariableOutcome,
} from '@ailab/domain';
import {
  type Quantity,
  type ScientificQuestion,
  type SopAttributes,
  sopsAnswerQuestion,
  sopsAskQuestion,
  sopsCalculate,
  sopsCheckCitations,
  sopsDraft,
  sopsEvaluate,
  sopsReview,
  sopsReviews,
  sopsScore,
  sopsSuggest,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { checkCitations } from './citations.ts';
import { type InputValue, inputProblem } from './inputs.ts';
import { sopVariableDefinitions } from './kinds.ts';
import { obligationOf, operationalSop, stageProblem } from './questions.ts';
import { bindRoles, type ReadValue, readField } from './resolve.ts';
import { reviewSop, roundsOf } from './review.ts';
import { suggestSop } from './suggest.ts';

/** Digital SOP operations (plan 012). */
export const sopOperations = [
  implement(sopsEvaluate, {
    run: async (_ctx, input) => {
      const names = new Set<string>();
      for (const v of input.variables) {
        if (names.has(v.name)) {
          throw new OperationError('invalid_input', `${v.name} is given twice`);
        }
        names.add(v.name);
        const given = v.value === undefined ? [] : Array.isArray(v.value) ? v.value : [v.value];
        for (const unit of [
          ...given.flatMap((g) => (typeof g === 'string' ? [] : [g.unit])),
          ...(v.unit ? [v.unit] : []),
        ]) {
          if (!isUnit(unit))
            throw new OperationError('invalid_input', `${v.name}: unknown unit "${unit}"`);
        }
      }
      const outcomes = evaluateVariables(
        input.variables.map(
          (v): VariableDefinition => ({
            name: v.name,
            ...(v.value === undefined ? {} : { value: v.value }),
            ...(v.expression === undefined ? {} : { expression: v.expression }),
            ...(v.unit === undefined ? {} : { unit: v.unit }),
          }),
        ),
      );
      return { variables: input.variables.map((v) => outcomeWords(v.name, outcomes.get(v.name))) };
    },
  }),
  implement(sopsDraft, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'sop',
        label,
        attributes,
        ...(attributes.questions
          ? {
              attributes: {
                ...attributes,
                questions: attributes.questions.map((q) => ({
                  ...q,
                  responses: [],
                  disposition: { status: 'open' },
                })),
              },
            }
          : {}),
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the SOP ${label}`,
      }),
  }),
  implement(sopsCalculate, {
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const current = await service.get(ctx, input.sop);
      if (current.kind !== 'sop') {
        throw new OperationError('invalid_input', `${current.name} is not an SOP`);
      }
      const atVersion = async (id: string, version: number) => {
        const found = (await service.history(ctx, id)).find((v) => v.version === version);
        if (!found) {
          const r = await service.get(ctx, id);
          throw new OperationError('invalid_input', `${r.name} has no version ${version}`);
        }
        return found.snapshot;
      };
      const record = input.version ? await atVersion(current.id, input.version) : current;
      const a = operationalSop(record.attributes);
      const given = new Map<string, InputValue>();
      for (const { name, value } of input.inputs ?? []) {
        if (given.has(name)) throw new OperationError('invalid_input', `${name} is given twice`);
        const v = a.variables.find((x) => x.name === name);
        if (!v) throw new OperationError('invalid_input', `${record.name} has no variable ${name}`);
        if (v.kind === 'computed') {
          throw new OperationError(
            'invalid_input',
            `${name} is worked out by a formula; give the values it uses`,
          );
        }
        const problem = inputProblem(v, value);
        if (problem) throw new OperationError('invalid_input', problem);
        given.set(name, value);
      }
      const pinned = new Map<string, number>();
      for (const b of input.bindings ?? []) if (b.version) pinned.set(b.record, b.version);
      const fetch = async (id: string) => {
        const version = pinned.get(id);
        if (version) return atVersion(id, version);
        return service.get(ctx, id).catch(() => undefined);
      };
      const roles = new Set(a.materials.map((m) => m.role));
      const bound = new Map<string, string>();
      for (const b of input.bindings ?? []) {
        if (!roles.has(b.role)) {
          throw new OperationError('invalid_input', `${record.name} has no material ${b.role}`);
        }
        bound.set(b.role, b.record);
      }
      const bindings = await bindRoles(a, bound, fetch);
      const byRole = new Map(bindings.map((b) => [b.role, b]));
      const read = new Map<string, ReadValue>();
      for (const v of a.variables) {
        if (v.kind !== 'record' || !v.readFrom || given.has(v.name)) continue;
        const binding = byRole.get(v.readFrom.role);
        if (!binding?.record || binding.problem) continue;
        read.set(v.name, await readField(binding.record, v.readFrom.field, fetch));
      }
      const outcomes = evaluateVariables(
        sopVariableDefinitions(a).map((d) => {
          if (given.has(d.name))
            return { ...d, value: given.get(d.name) as NonNullable<typeof d.value> };
          const r = read.get(d.name);
          return r?.value !== undefined ? { ...d, value: r.value } : d;
        }),
      );
      return {
        obligations: (a.questions ?? []).flatMap((q) => {
          const obligation = obligationOf(q);
          if (!obligation) return [];
          const binding = obligation.binding;
          const passed =
            !stageProblem(a, q) &&
            (binding.type === 'input'
              ? given.has(binding.variable)
              : binding.type === 'material_role'
                ? !!byRole.get(binding.role)?.record && !byRole.get(binding.role)?.problem
                : false);
          return [
            {
              question: q.id,
              stage: obligation.stage,
              passed,
              ...(passed
                ? {}
                : {
                    problem: `${q.question}: supply its declared ${binding.type === 'input' ? 'input' : 'material'}`,
                  }),
            },
          ];
        }),
        bindings: bindings.map((b) => ({
          role: b.role,
          ...(b.record ? { record: b.record.id, name: b.record.name, label: b.record.label } : {}),
          ...(b.by ? { by: b.by } : {}),
          ...(b.problem ? { problem: b.problem } : {}),
        })),
        variables: a.variables.map((v) => {
          const out = outcomeWords(v.name, outcomes.get(v.name));
          const r = read.get(v.name);
          const fromRecord = r?.value !== undefined;
          const from = given.has(v.name)
            ? 'input'
            : v.kind === 'computed'
              ? 'computed'
              : fromRecord
                ? r?.typical
                  ? 'typical'
                  : 'record'
                : v.value === undefined
                  ? 'missing'
                  : v.kind === 'record'
                    ? 'typical'
                    : 'default';
          return {
            ...out,
            from,
            ...(fromRecord && r?.from ? { source: r.from } : {}),
            ...(r?.problem ? { problem: r.problem } : {}),
          } as const;
        }),
      };
    },
  }),
  implement(sopsAnswerQuestion, {
    actors: 'people',
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await service.get(ctx, input.sop);
      if (record.kind !== 'sop') {
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      }
      await service.assertSopEditable(ctx, record.id);
      const a = operationalSop(record.attributes);
      const question = (a.questions ?? []).find((q) => q.id === input.question);
      if (!question) {
        throw new OperationError(
          'invalid_input',
          `${record.name} has no question ${input.question}`,
        );
      }
      const changed: ScientificQuestion =
        input.action.type === 'correct'
          ? { ...question, question: input.action.text }
          : {
              ...question,
              responses: [
                ...question.responses,
                {
                  text: input.action.text,
                  by: ctx.actor as Extract<typeof ctx.actor, { type: 'user' }>,
                  at: new Date().toISOString(),
                  version: record.version + 1,
                },
              ],
            };
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          questions: (a.questions ?? []).map((q) => (q.id === question.id ? changed : q)),
        },
        reason:
          input.reason ??
          (input.action.type === 'correct'
            ? input.action.reason
            : `Responded to "${question.question}"; the scientific issue remains open`),
      });
    },
  }),
  implement(sopsAskQuestion, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const record = await service.get(ctx, input.sop);
      if (record.kind !== 'sop')
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      await service.assertSopEditable(ctx, record.id);
      const a = operationalSop(record.attributes);
      return service.update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          questions: [
            ...(a.questions ?? []),
            { ...input.question, responses: [], disposition: { status: 'open' } },
          ],
        },
        reason: input.reason ?? `Asked "${input.question.question}"`,
      });
    },
  }),
  implement(sopsCheckCitations, {
    run: async (ctx, input, deps) => {
      const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.sop);
      if (record.kind !== 'sop') {
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      }
      const { citations } = await checkCitations(deps, ctx, record.attributes as SopAttributes);
      return {
        citations,
        matches: citations.filter((c) => c.result === 'matches').length,
        problems: citations.filter(
          (c) => c.result === 'not_found' || c.result === 'found_elsewhere',
        ).length,
      };
    },
  }),
  implement(sopsReview, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const model = deps.assistant.model;
      if (!model) {
        throw new OperationError(
          'invalid_state',
          'No model is set up for the reviewer; set AGENT_PROVIDER and its key in .env',
        );
      }
      return reviewSop(deps, ctx, input, model, `${deps.assistant.agentName} (reviewer)`);
    },
  }),
  implement(sopsSuggest, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const model = deps.assistant.model;
      if (!model) {
        throw new OperationError(
          'invalid_state',
          'No model is set up for the assistant; set AGENT_PROVIDER and its key in .env',
        );
      }
      return suggestSop(deps, ctx, input, model);
    },
  }),
  implement(sopsReviews, {
    run: async (ctx, input, deps) => {
      const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.sop);
      if (record.kind !== 'sop') {
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      }
      return { rounds: await roundsOf(deps, ctx, record.id) };
    },
  }),
  implement(sopsScore, {
    run: async (ctx, input, deps) => {
      const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.sop);
      if (record.kind !== 'sop') {
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      }
      return scoreSop(record.attributes as SopAttributes, input.expected);
    },
  }),
];

function outcomeWords(name: string, outcome: VariableOutcome | undefined) {
  if (!outcome) return { name, ok: false, error: 'Not evaluated' };
  if (!outcome.ok) {
    return {
      name,
      ok: false,
      error: outcome.error,
      ...(outcome.waitsOn ? { waitsOn: outcome.waitsOn } : {}),
    };
  }
  const r = outcome.result;
  if (r.type === 'number') return { name, ok: true, number: r.value };
  if (r.type === 'quantity') return { name, ok: true, quantity: r.quantity };
  return { name, ok: true, list: [...(r.items as (string | Quantity)[])] };
}

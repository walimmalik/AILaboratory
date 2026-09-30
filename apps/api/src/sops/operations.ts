import {
  evaluateVariables,
  isUnit,
  type VariableDefinition,
  type VariableOutcome,
} from '@ailab/domain';
import {
  type Quantity,
  type SopAttributes,
  sopsCalculate,
  sopsDraft,
  sopsEvaluate,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { sopVariableDefinitions } from './kinds.ts';

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
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the SOP ${label}`,
      }),
  }),
  implement(sopsCalculate, {
    run: async (ctx, input, deps) => {
      const record = await new RecordService(deps.db, deps.kinds).get(ctx, input.sop);
      if (record.kind !== 'sop') {
        throw new OperationError('invalid_input', `${record.name} is not an SOP`);
      }
      const a = record.attributes as SopAttributes;
      const given = new Map((input.inputs ?? []).map((i) => [i.name, i.value] as const));
      for (const name of given.keys()) {
        const v = a.variables.find((x) => x.name === name);
        if (!v) throw new OperationError('invalid_input', `${record.name} has no variable ${name}`);
        if (v.kind === 'computed') {
          throw new OperationError(
            'invalid_input',
            `${name} is worked out by a formula; give the values it uses`,
          );
        }
      }
      const outcomes = evaluateVariables(
        sopVariableDefinitions(a).map((d) =>
          given.has(d.name) ? { ...d, value: given.get(d.name) as NonNullable<typeof d.value> } : d,
        ),
      );
      return {
        variables: a.variables.map((v) => {
          const out = outcomeWords(v.name, outcomes.get(v.name));
          const from = given.has(v.name)
            ? 'input'
            : v.kind === 'computed'
              ? 'computed'
              : v.value === undefined
                ? 'missing'
                : v.kind === 'record'
                  ? 'typical'
                  : 'default';
          return { ...out, from } as const;
        }),
      };
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

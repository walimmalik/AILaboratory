import { evaluateVariables, isUnit, type VariableDefinition } from '@ailab/domain';
import { sopsEvaluate } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';

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
      return {
        variables: input.variables.map((v) => {
          const outcome = outcomes.get(v.name);
          if (!outcome) return { name: v.name, ok: false, error: 'Not evaluated' };
          if (!outcome.ok) {
            return {
              name: v.name,
              ok: false,
              error: outcome.error,
              ...(outcome.waitsOn ? { waitsOn: outcome.waitsOn } : {}),
            };
          }
          const r = outcome.result;
          if (r.type === 'number') return { name: v.name, ok: true, number: r.value };
          if (r.type === 'quantity') return { name: v.name, ok: true, quantity: r.quantity };
          return {
            name: v.name,
            ok: true,
            list: [...(r.items as (string | { value: string; unit: string })[])],
          };
        }),
      };
    },
  }),
];

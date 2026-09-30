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
import { bindRoles, type ReadValue, readField } from './resolve.ts';

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
      const service = new RecordService(deps.db, deps.kinds);
      const fetch = (id: string) => service.get(ctx, id).catch(() => undefined);
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

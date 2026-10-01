import {
  CALCULATOR_GROUPS,
  type CalculatorGroup,
  type OperationContract,
  operationContracts,
  operationsDescribe,
} from '@ailab/schema';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import type { JsonSchema } from '../lib/json-schema.ts';
import { kindsQuery } from '../queries.ts';
import { EditorScope, ValueEditor } from './FieldEditor.tsx';
import { renderValue } from './Value.tsx';

const groupOrder = Object.keys(CALCULATOR_GROUPS) as CalculatorGroup[];

/** Every lab calculator, grouped as the page lists them (bench dilutions first), then by title. */
const calculators: OperationContract[] = [...operationContracts.values()]
  .filter((c) => c.calculator)
  .sort(
    (a, b) =>
      groupOrder.indexOf(a.calculator?.group ?? 'protocols') -
        groupOrder.indexOf(b.calculator?.group ?? 'protocols') ||
      titleOf(a).localeCompare(titleOf(b)),
  );

function titleOf(c: OperationContract) {
  return c.calculator?.title ?? c.id;
}

/**
 * The lab calculators (plan 004e R11): the same operations agents call for volumes, dilutions and
 * amounts, one form each, drawn from the calculator's input schema. Nothing here is saved.
 */
export function CalculatorsPage() {
  const [id, setId] = useState(calculators[0]?.id ?? '');
  const contract = calculators.find((c) => c.id === id);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>calculators</b>
          </div>
          <h1>Calculators</h1>
          <p className="lede">
            The calculations agents use for volumes, dilutions and amounts. Nothing here is saved.
          </p>
        </div>
      </div>
      <section className="block">
        <header>
          <h2>Calculator</h2>
        </header>
        <div className="body">
          <select
            className="field"
            aria-label="Calculator"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {groupOrder.map((group) => (
              <optgroup key={group} label={CALCULATOR_GROUPS[group]}>
                {calculators
                  .filter((c) => c.calculator?.group === group)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {titleOf(c)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {contract && <p className="muted">{contract.summary}</p>}
        </div>
      </section>
      {contract && <CalculatorForm key={contract.id} contract={contract} />}
    </>
  );
}

function CalculatorForm({ contract }: { contract: OperationContract }) {
  // The input schema comes from the API, as agents see it (operations.describe).
  const described = useQuery({
    queryKey: ['operations', 'describe', contract.id],
    queryFn: () => api.run(operationsDescribe, { ids: [contract.id] }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const schema = described.data?.operations[0]?.input as JsonSchema | undefined;
  const kinds = useQuery(kindsQuery).data;
  const kindOfPrefix = Object.fromEntries(kinds?.map((k) => [k.idPrefix, k.kind]) ?? []);
  const [input, setInput] = useState<unknown>({});
  const calculate = useMutation({
    mutationFn: () => api.run(contract, (input ?? {}) as never),
  });
  return (
    <section className="block">
      <header>
        <h2>{titleOf(contract)}</h2>
      </header>
      <div className="body">
        {schema ? (
          <EditorScope root={schema} kindOfPrefix={kindOfPrefix} hidden={new Set()}>
            <ValueEditor
              schema={schema}
              value={input}
              onChange={setInput}
              label={titleOf(contract)}
              path=""
            />
          </EditorScope>
        ) : (
          <p className="empty">{described.error?.message ?? 'Loading…'}</p>
        )}
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={calculate.isPending}
            onClick={() => calculate.mutate()}
          >
            Calculate
          </button>
          {calculate.error && <span className="error-text">{calculate.error.message}</span>}
        </div>
        {calculate.data !== undefined && (
          <section className="calculator-result" aria-label="Result">
            {renderValue(calculate.data)}
            <details className="tech">
              <summary>technical details</summary>
              <pre className="json">{JSON.stringify(calculate.data, null, 2)}</pre>
            </details>
          </section>
        )}
      </div>
    </section>
  );
}

import { createHash } from 'node:crypto';
import {
  add,
  compare,
  evaluateVariables,
  getUnit,
  isUnit,
  LabDecimal,
  multiply,
} from '@ailab/domain';
import type { Quantity, SopAttributes, SopDilutionDecision } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { stable } from '../records/pins.ts';
import { whitespace } from './exact-source.ts';
import type { InputValue } from './inputs.ts';

function refuse(message: string): never {
  throw new OperationError('invalid_input', message);
}
const decimal = '(?:0|[1-9]\\d*)(?:\\.\\d+)?';
/** Deliberately recognizes only these two literal assertions; it is not scientific prose interpretation. */
export function dilutionQuoteFacts(quote: string) {
  const text = whitespace(quote);
  const ratios = [
    ...text.matchAll(
      new RegExp(`(?<![\\p{L}\\p{N}_.:+-])1:(${decimal})(?![\\p{L}\\p{N}_.:+-])\\s+ratio\\b`, 'gu'),
    ),
  ];
  const volumes = [
    ...text.matchAll(
      new RegExp(`final volume of (${decimal})\\s*(L|mL|uL|nL)(?=$|\\s|[.,;](?=\\s|$))`, 'gu'),
    ),
  ];
  if (
    ratios.length !== 1 ||
    volumes.length !== 1 ||
    [...text.matchAll(/\bratio\b/giu)].length !== 1 ||
    [...text.matchAll(/final volume of/giu)].length !== 1
  )
    refuse(
      'The quotation must contain one supported positive 1:N ratio and one final volume of Q unit assertion',
    );
  const factor = ratios[0]?.[1] as string;
  const value = { value: volumes[0]?.[1] as string, unit: volumes[0]?.[2] as string };
  if (!new LabDecimal(factor).greaterThan(1) || !new LabDecimal(value.value).greaterThan(0))
    refuse('The supported dilution needs a factor greater than one and a positive final volume');
  return { factor, value };
}

const expression = (s: string | undefined) => s?.replace(/\s+/gu, '');
const volumeUnit = (s: string | undefined) =>
  s !== undefined && isUnit(s) && getUnit(s).dimension === 'volume';
/** Parameter names have one supported meaning; all variable identities come from saved associations. */
export function dilutionAssociation(a: SopAttributes, question: string) {
  const q = a.questions?.find((q) => q.id === question);
  if (q?.stage.stage !== 'method' || !q.about?.variable || !q.about.step || q.about.material)
    refuse(
      'Choose one method question naming the existing dilution step and missing final-volume default',
    );
  const step = a.steps.find((s) => s.id === q.about?.step);
  if (step?.action !== 'serial_dilute')
    refuse('The selected step must be the declared serial dilution');
  if (step.repeat !== undefined || step.parameters?.length !== 4)
    refuse(
      'This bounded dilution requires only the four canonical variable parameters without repetition',
    );
  const ref = (name: string) => {
    const matches = step.parameters?.filter((p) => p.name === name) ?? [];
    if (matches.length !== 1 || !matches[0]?.variable)
      refuse(`The dilution needs one canonical ${name} variable parameter`);
    return matches[0]?.variable as string;
  };
  const names = {
    final: ref('final_volume'),
    factor: ref('dilution_factor'),
    sample: ref('sample_volume'),
    diluent: ref('diluent_volume'),
  };
  if (names.final !== q.about.variable || new Set(Object.values(names)).size !== 4)
    refuse('The question and four dilution parameter associations must agree and be distinct');
  const variable = (name: string) => {
    const matches = a.variables.filter((v) => v.name === name);
    if (matches.length !== 1) refuse('Every selected dilution variable must exist exactly once');
    return matches[0] as SopAttributes['variables'][number];
  };
  const final = variable(names.final),
    factor = variable(names.factor),
    sample = variable(names.sample),
    diluent = variable(names.diluent);
  if (
    final.kind !== 'default' ||
    !volumeUnit(final.unit) ||
    final.min !== undefined ||
    final.max !== undefined
  )
    refuse('The final volume must be an unbounded scalar volume default with a declared unit');
  if (
    factor.kind !== 'default' ||
    typeof factor.value !== 'string' ||
    factor.unit !== undefined ||
    factor.min !== undefined ||
    factor.max !== undefined ||
    !new LabDecimal(factor.value).greaterThan(1)
  )
    refuse('The dilution factor must be an explicit dimensionless default greater than one');
  if (
    sample.kind !== 'computed' ||
    diluent.kind !== 'computed' ||
    sample.value !== undefined ||
    diluent.value !== undefined ||
    !volumeUnit(sample.unit) ||
    !volumeUnit(diluent.unit) ||
    expression(sample.expression) !== `${names.final}/${names.factor}` ||
    expression(diluent.expression) !== `${names.final}-${names.sample}`
  )
    refuse(
      'The supported component formulas must be final volume / factor and final volume - sample volume',
    );
  return { question: q, step, final, factor, sample, diluent };
}

export function dilutionAssociationDigest(a: SopAttributes, question: string) {
  const { question: q, ...facts } = dilutionAssociation(a, question);
  const { responses: _responses, disposition: _disposition, ...meaning } = q;
  return createHash('sha256')
    .update(stable({ ...facts, question: meaning, source: a.source }))
    .digest('hex');
}

export function selectedDilution(a: SopAttributes, input: SopDilutionDecision) {
  const facts = dilutionAssociation(a, input.question);
  if (
    facts.question.disposition.status !== 'open' ||
    facts.final.value !== undefined ||
    facts.final.cite?.length
  )
    refuse('Choose an open question whose final-volume default is still missing and uncited');
  if (!volumeUnit(input.value.unit) || !new LabDecimal(input.value.value).greaterThan(0))
    refuse('Choose a positive supported volume');
  const questionCites = facts.question.passages?.filter((c) => c.passage === input.passage) ?? [];
  const stepCites = facts.step.cite?.filter((c) => c.passage === input.passage) ?? [];
  if (
    questionCites.length !== 1 ||
    stepCites.length !== 1 ||
    stable(questionCites[0]) !== stable(stepCites[0])
  )
    refuse(
      'Choose the identical persisted quotation and passage on this question and dilution step',
    );
  const cite = questionCites[0];
  if (!cite) refuse('The selected quotation is unavailable');
  const source = dilutionQuoteFacts(cite.quote);
  if (
    compare(input.value, source.value) !== 0 ||
    !new LabDecimal(facts.factor.value as string).equals(source.factor)
  )
    refuse('The proposed final volume or stored factor contradicts the retained quotation');
  return { ...facts, cite, source };
}

/** Numbers come from the current domain evaluator, including its missing-value dependencies. */
export function dilutionCalculation(
  a: SopAttributes,
  question: string,
  inputs = new Map<string, InputValue>(),
) {
  const facts = dilutionAssociation(a, question);
  const outcomes = evaluateVariables(
    a.variables.map((v) => ({
      name: v.name,
      ...(v.value === undefined ? {} : { value: v.value }),
      ...(v.expression ? { expression: v.expression } : {}),
      ...(v.unit ? { unit: v.unit } : {}),
      ...(inputs.has(v.name) ? { value: inputs.get(v.name) as InputValue } : {}),
    })),
  );
  const names = [facts.final.name, facts.sample.name, facts.diluent.name];
  const missing = names.flatMap((name) => {
    const o = outcomes.get(name);
    return o && !o.ok ? (o.waitsOn ?? [name]) : [];
  });
  if (missing.length) return { status: 'missing' as const, waitsOn: [...new Set(missing)].sort() };
  const quantity = (name: string): Quantity => {
    const o = outcomes.get(name);
    if (!o?.ok || o.result.type !== 'quantity')
      refuse('The supported dilution must calculate scalar volumes');
    return o.result.quantity;
  };
  const final = quantity(facts.final.name),
    sample = quantity(facts.sample.name),
    diluent = quantity(facts.diluent.name);
  const factor = outcomes.get(facts.factor.name);
  if (
    !factor?.ok ||
    factor.result.type !== 'number' ||
    !new LabDecimal(factor.result.value).greaterThan(1) ||
    !new LabDecimal(sample.value).greaterThan(0) ||
    !new LabDecimal(diluent.value).greaterThanOrEqualTo(0)
  )
    refuse('The calculated dilution factor and component volumes are invalid');
  const recomposed = add(sample, diluent);
  if (compare(multiply(sample, factor.result.value), final) !== 0)
    refuse('The calculated sample volume does not produce the declared dilution factor');
  if (compare(recomposed, final) !== 0)
    refuse('The calculated components do not recompose the final volume');
  return {
    status: 'calculated' as const,
    final,
    sample,
    diluent,
    recomposed,
    factor: factor.result.value,
  };
}

/** Persisted acceptance is a constraint, not permission to silently change its accepted relationship. */
export function assertDilutionCompletionFacts(a: SopAttributes) {
  for (const q of a.questions ?? []) {
    if (q.disposition.status !== 'resolved' || !q.disposition.action.completion) continue;
    const c = q.disposition.action.completion;
    if (c.associationDigest !== dilutionAssociationDigest(a, q.id))
      refuse('The accepted dilution relationship changed; reconsideration is not supported');
    const facts = dilutionAssociation(a, q.id);
    if (
      c.variable !== facts.final.name ||
      c.step !== facts.step.id ||
      c.factor.variable !== facts.factor.name ||
      c.factor.value !== facts.factor.value ||
      c.sample.variable !== facts.sample.name ||
      c.sample.expression !== facts.sample.expression ||
      c.diluent.variable !== facts.diluent.name ||
      c.diluent.expression !== facts.diluent.expression ||
      stable(a.source?.exact) !== stable(c.source) ||
      stable(facts.final.value) !== stable(c.value)
    )
      refuse('The accepted dilution facts no longer match this SOP');
    const calculation = dilutionCalculation(a, q.id);
    const quote = dilutionQuoteFacts(c.quote);
    if (
      calculation.status !== 'calculated' ||
      compare(calculation.final, quote.value) !== 0 ||
      !new LabDecimal(calculation.factor).equals(quote.factor)
    )
      refuse('The accepted dilution no longer calculates its source-backed values');
  }
}
export function assertDilutionInputs(a: SopAttributes, inputs: ReadonlyMap<string, InputValue>) {
  assertDilutionCompletionFacts(a);
  for (const q of a.questions ?? []) {
    if (q.disposition.status !== 'resolved' || !q.disposition.action.completion) continue;
    const expected = dilutionCalculation(a, q.id),
      actual = dilutionCalculation(a, q.id, new Map(inputs));
    if (
      expected.status !== 'calculated' ||
      actual.status !== 'calculated' ||
      compare(expected.final, actual.final) !== 0 ||
      compare(expected.sample, actual.sample) !== 0 ||
      compare(expected.diluent, actual.diluent) !== 0 ||
      !new LabDecimal(expected.factor).equals(actual.factor)
    )
      refuse('An override would invalidate the accepted dilution final-volume relationship');
  }
}

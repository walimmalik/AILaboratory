import { SopAttributes, type SopVariable } from '@ailab/schema';
import { amount, type OverviewBuilder, parts, words } from '../records/overview.ts';

/** Saved method values only: no variable evaluation, experiment binding or live substitution. */
function savedValue(value: NonNullable<SopVariable['value']>): string {
  if (Array.isArray(value))
    return value.map((v) => (typeof v === 'string' ? v : amount(v))).join(', ');
  return typeof value === 'string' ? value : amount(value);
}

const sop: OverviewBuilder = async (record) => {
  const parsed = SopAttributes.safeParse(record.attributes);
  if (!parsed.success)
    return {
      identity: parts('SOP'),
      facts: [
        {
          label: 'method details',
          value: 'This saved method uses unsupported data. Open the full record to reconcile it.',
          tone: 'warn',
        },
      ],
    };
  const a = parsed.data;
  const variables = new Map(a.variables.map((variable) => [variable.name, variable]));
  return {
    identity: parts('SOP', a.assays?.join(', ')),
    facts: [
      ...(a.purpose ? [{ label: 'purpose', value: a.purpose, field: 'purpose' }] : []),
      ...(a.scope ? [{ label: 'applies to', value: a.scope, field: 'scope' }] : []),
      ...a.variables.map((variable) => ({
        label: variable.label,
        value: variable.expression
          ? 'Needs a calculation'
          : variable.value === undefined
            ? 'Not specified'
            : savedValue(variable.value),
        detail:
          variable.kind === 'computed'
            ? `Saved formula: ${variable.expression}`
            : variable.kind === 'record'
              ? 'Typical method value; the bound physical record must be checked'
              : variable.kind === 'input'
                ? 'Saved input default; the experiment may choose another value'
                : 'Saved method default; experiment inputs may override it',
        field: `/variables/${variable.name}`,
        ...(variable.value === undefined && variable.kind !== 'computed'
          ? { tone: 'warn' as const }
          : {}),
      })),
      ...a.steps.flatMap((step, index) => [
        {
          label: `${index + 1}. ${step.title ?? words(step.action)}`,
          value: step.text,
          detail: [
            words(step.action),
            ...(step.repeat ? [`Repeat ${step.repeat} times`] : []),
          ].join(' · '),
          field: `/steps/${step.id}`,
        },
        ...(step.parameters ?? []).map((parameter) => ({
          label: `${step.title ?? words(step.action)}: ${words(parameter.name)}`,
          value: parameter.quantity
            ? amount(parameter.quantity)
            : (parameter.number ??
              parameter.text ??
              (parameter.variable
                ? (variables.get(parameter.variable)?.label ?? parameter.variable)
                : 'Not specified')),
          ...(parameter.variable
            ? {
                detail:
                  'Uses the named method variable; experiment inputs may override its saved default',
              }
            : {}),
          field: `/steps/${step.id}`,
        })),
      ]),
      ...(a.questions ?? [])
        .filter((question) => question.disposition.status === 'open')
        .map((question) => ({
          label: 'needs clarification',
          value: question.question,
          tone: 'warn' as const,
        })),
      ...(a.analysis ? [{ label: 'analysis', value: a.analysis, field: 'analysis' }] : []),
    ],
  };
};

export const sopOverviews: Record<string, OverviewBuilder> = { sop };

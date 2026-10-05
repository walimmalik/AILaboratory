import { type QuestionStage, type ScientificQuestion, SopAttributes } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';

/** One current contract: unsupported historical attributes are readable, never executable. */
export function operationalSop(attributes: unknown): SopAttributes {
  const parsed = SopAttributes.safeParse(attributes);
  if (!parsed.success)
    throw new OperationError(
      'invalid_input',
      'This SOP uses an unsupported question contract; reconcile its history before scientific use',
    );
  return parsed.data;
}

/** Later-stage questions may only ask about facts the existing protocol calculator checks. */
export function stageProblem(
  a: SopAttributes,
  q: Pick<ScientificQuestion, 'about' | 'stage' | 'id'>,
): string | undefined {
  if (q.stage.stage === 'method') return;
  if (q.stage.stage === 'run')
    return `Question ${q.id}: run-stage bindings are unsupported until a concrete run-preparation check exists; use the actual experiment input or a method question`;
  const fail = `Question ${q.id} cannot move a method instruction or unverified fact to ${q.stage.stage}; use a method question`;
  const binding = q.stage.binding;
  if (q.about?.step) return fail;
  if (binding.type === 'input') {
    const variable = a.variables.find((v) => v.name === binding.variable);
    if (variable?.kind !== 'input' || q.about?.variable !== variable.name || q.about.material)
      return fail;
  } else {
    const material = a.materials.find((m) => m.role === binding.role);
    if (!material || material.default || q.about?.material !== material.role || q.about.variable)
      return fail;
  }
}

/** The initial stage remains an obligation even before an accepted deferral is available. */
export function obligationOf(
  q: ScientificQuestion,
): Exclude<QuestionStage, { stage: 'method' }> | undefined {
  if (q.disposition.status === 'resolved' || q.stage.stage === 'method') return;
  return q.stage;
}

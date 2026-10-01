import { compare, formatQuantity, LabDecimal } from '@ailab/domain';
import type {
  Actor,
  ExperimentAttributes,
  Quantity,
  RecordEnvelope,
  RunAttributes,
  RunValue,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * The runs module's lab memory detector (plan 005c-1, M13, change 5): recurring deviations. When a
 * run finishes, each value recorded differently from the plan is reported to `memory.observe`
 * under its SOP version, step, field and direction, never its free-text reason, so the same change
 * seen in 3 runs on 2 days becomes one proposed lesson.
 */

export const DEVIATION_DETECTOR = 'runs.recurring_deviation';

const isQuantity = (v: unknown): v is Quantity =>
  !!v && typeof v === 'object' && 'value' in v && 'unit' in v;

const show = (v: RunValue) => (isQuantity(v) ? formatQuantity(v) : String(v));

/** Whether the actual is higher or lower than planned, or just different (text, other units). */
export function direction(planned: RunValue, actual: RunValue): 'higher' | 'lower' | 'different' {
  try {
    const order =
      isQuantity(planned) && isQuantity(actual)
        ? compare(actual, planned)
        : typeof planned === 'string' && typeof actual === 'string'
          ? new LabDecimal(actual).comparedTo(new LabDecimal(planned))
          : 0;
    return order > 0 ? 'higher' : order < 0 ? 'lower' : 'different';
  } catch {
    return 'different';
  }
}

/** Reports every planned value a finished run recorded differently; aborted runs report nothing. */
export async function observeDeviations(
  deps: OperationDeps,
  ctx: RecordContext,
  run: RecordEnvelope,
): Promise<void> {
  const a = run.attributes as RunAttributes;
  if (a.status === 'aborted') return;
  const records = new RecordService(deps.db, deps.kinds);
  const experiment = (await records.history(ctx, a.experiment.id)).find(
    (v) => v.version === a.experiment.version,
  );
  if (!experiment) return;
  const protocol = (experiment.snapshot.attributes as ExperimentAttributes).protocol;
  const detector: Actor = {
    type: 'agent',
    agentName: 'Lab memory detector',
    onBehalfOf: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf,
  };
  const sops = new Map<string, RecordEnvelope | undefined>();
  for (const step of a.steps ?? []) {
    const sop = protocol.find((p) => p.id === step.part)?.sop;
    if (!sop || !step.actuals?.length) continue;
    const key = `${sop.id}@${sop.version}`;
    if (!sops.has(key))
      sops.set(
        key,
        (await records.history(ctx, sop.id)).find((v) => v.version === sop.version)?.snapshot,
      );
    const label = sops.get(key);
    for (const actual of step.actuals) {
      const planned = step.planned.find((p) => p.name === actual.name)?.value;
      if (planned === undefined) continue;
      const way = direction(planned, actual.value);
      const how = way === 'different' ? `${show(actual.value)} instead of` : `${way} than`;
      await deps.registry
        .execute(
          { ...ctx, actor: detector },
          'memory.observe',
          {
            detector: DEVIATION_DETECTOR,
            key: [
              sop.id,
              sop.version,
              step.step,
              actual.name,
              way === 'different' ? show(actual.value) : way,
            ].join('|'),
            source: 'run',
            evidence: run.id,
            day: a.date,
            note: `${actual.name} ${show(actual.value)}, planned ${show(planned)}`,
            draft: {
              statement: `Runs of ${label?.label ?? sop.id} record ${actual.name} in "${step.title}" ${how} the planned ${show(planned)}`,
              kind: 'lesson',
              about: [sop.id],
              conditions: { sop: sop.id },
            },
          },
          {},
          deps.db,
        )
        .catch((error: unknown) => {
          // A detector never stops the run it reads; a refused observation is skipped.
          if (error instanceof OperationError) return undefined;
          throw error;
        });
    }
  }
}

import { formatQuantity } from '@ailab/domain';
import {
  type ExperimentAttributes,
  type Quantity,
  type RecordEnvelope,
  type RunAttributes,
  type RunStep,
  type RunValue,
  runsAttachData,
  runsDoneAsPlanned,
  runsFinish,
  runsRecordDeviation,
  runsRecordStep,
  runsStart,
  type SopAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { type AgentPolicy, implement, type OperationDeps } from '../operations/registry.ts';
import { stable } from '../records/pins.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { calculateExperiment, recordOf } from './operations.ts';

/**
 * Recording runs (plan 013c, E7): a run is a checklist of the pinned SOPs' steps with their planned
 * values. Ticking a step records it done as planned; a value typed in because it differed is an
 * actual and makes a deviation with why.
 */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

const isQuantity = (v: unknown): v is Quantity =>
  !!v && typeof v === 'object' && 'value' in v && 'unit' in v;

const show = (v: RunValue | undefined) =>
  v === undefined ? 'nothing' : isQuantity(v) ? formatQuantity(v) : String(v);

/**
 * Agents record into a run a person started directly (010 V7); otherwise their records are
 * proposals a person confirms.
 */
const personStarted: AgentPolicy<{ id: string }> = async (ctx, input, deps) => {
  const run = await service(deps).get(ctx, input.id);
  return (run.attributes as RunAttributes).startedBy?.type === 'user' ? 'direct' : 'propose';
};

async function runOf(deps: Pick<OperationDeps, 'db' | 'kinds'>, ctx: RecordContext, id: string) {
  const run = await recordOf(service(deps), ctx, id, 'run', 'run');
  const a = run.attributes as RunAttributes;
  if (a.status !== 'in_progress') {
    throw new OperationError(
      'invalid_state',
      `${run.name} is ${a.status.replace('_', ' ')}; only a run in progress is recorded into`,
    );
  }
  return { run, a };
}

function stepOf(run: RecordEnvelope, a: RunAttributes, part: string, step: string) {
  const i = (a.steps ?? []).findIndex((s) => s.part === part && s.step === step);
  if (i < 0)
    throw new OperationError('invalid_input', `${run.name} has no step ${step} in ${part}`);
  return i;
}

export const runOperations = [
  implement(runsStart, {
    agentPolicy: 'propose',
    touches: (input, output) => [input.experiment, ...(output ? [output.id] : [])],
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const experiment = await recordOf(records, ctx, input.experiment, 'experiment', 'experiment');
      const e = experiment.attributes as ExperimentAttributes;
      if (
        experiment.status !== 'active' ||
        !['planned', 'running', 'analysing'].includes(e.stage)
      ) {
        throw new OperationError(
          'invalid_state',
          `${experiment.name} is ${e.stage.replace('_', ' ')}; plan it before starting a run`,
        );
      }
      const calculated = await calculateExperiment(deps, ctx, experiment);
      if (!calculated.ready) {
        throw new OperationError(
          'not_ready',
          `${experiment.name}'s protocol doesn't work out: ${calculated.parts.flatMap((p) => p.problems).join('; ')}`,
        );
      }
      const steps: RunStep[] = [];
      for (const p of e.protocol) {
        const sop = (await records.history(ctx, p.sop.id)).find((v) => v.version === p.sop.version);
        if (!sop)
          throw new OperationError('invalid_state', `${p.sop.id} has no version ${p.sop.version}`);
        const values = new Map(
          (calculated.parts.find((c) => c.part === p.id)?.variables ?? []).map((v) => [v.name, v]),
        );
        for (const s of (sop.snapshot.attributes as SopAttributes).steps) {
          const planned: RunStep['planned'] = [];
          for (const param of s.parameters ?? []) {
            const v = param.variable ? values.get(param.variable) : undefined;
            const value = param.quantity ?? param.number ?? param.text ?? v?.quantity ?? v?.number;
            if (value !== undefined) planned.push({ name: param.name, value });
          }
          if (s.repeat) planned.push({ name: 'times', value: String(s.repeat) });
          steps.push({
            part: p.id,
            step: s.id,
            title: s.title ?? s.text,
            planned,
            status: 'pending',
          });
        }
      }
      const date = input.date ?? new Date().toISOString().slice(0, 10);
      const run = await records.create(ctx, {
        kind: 'run',
        label: input.label ?? `${experiment.label}, ${date}`,
        status: 'active',
        attributes: {
          experiment: { id: experiment.id, version: experiment.version },
          status: 'in_progress',
          date,
          ...(input.operator ? { operator: input.operator } : {}),
          startedAt: new Date().toISOString(),
          startedBy: ctx.actor,
          steps,
        } satisfies RunAttributes,
        reason: input.reason ?? `Started a run of ${experiment.name}`,
      });
      if (e.stage !== 'running') {
        await records.update(ctx, experiment.id, {
          expectedVersion: experiment.version,
          attributes: { ...e, stage: 'running' },
          reason: `${run.name} started`,
        });
      }
      return run;
    },
  }),
  implement(runsRecordStep, {
    agentPolicy: personStarted,
    run: async (ctx, input, deps) => {
      const { run, a } = await runOf(deps, ctx, input.id);
      const i = stepOf(run, a, input.part, input.step);
      const step = a.steps?.[i] as RunStep;
      const planned = new Map(step.planned.map((p) => [p.name, p.value]));
      const changed = (input.changed ?? []).filter(
        (c) => stable(c.value) !== stable(planned.get(c.name)),
      );
      const { actuals: _a, deviation: _d, ...rest } = step;
      const next: RunStep = {
        ...rest,
        status: input.skipped ? 'skipped' : 'done',
        at: new Date().toISOString(),
        by: ctx.actor,
        ...(changed.length ? { actuals: changed } : {}),
        ...(changed.length || input.skipped
          ? {
              deviation: {
                what: input.skipped
                  ? `Skipped ${step.title}`
                  : changed
                      .map(
                        (c) => `${c.name} ${show(c.value)} (planned ${show(planned.get(c.name))})`,
                      )
                      .join('; '),
                why: input.why as string,
                ...(input.impact ? { impact: input.impact } : {}),
              },
            }
          : {}),
      };
      const steps = [...(a.steps ?? [])];
      steps[i] = next;
      return service(deps).update(ctx, run.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, steps },
        reason:
          input.reason ??
          `${next.status === 'skipped' ? 'Skipped' : 'Did'} ${step.title}${changed.length ? ', with changes' : ''}`,
      });
    },
  }),
  implement(runsDoneAsPlanned, {
    agentPolicy: personStarted,
    run: async (ctx, input, deps) => {
      const { run, a } = await runOf(deps, ctx, input.id);
      const at = new Date().toISOString();
      const pending = (a.steps ?? []).filter((s) => s.status === 'pending').length;
      if (pending === 0) {
        throw new OperationError('invalid_input', `Every step of ${run.name} is already ticked`);
      }
      return service(deps).update(ctx, run.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          steps: (a.steps ?? []).map((s) =>
            s.status === 'pending' ? { ...s, status: 'done' as const, at, by: ctx.actor } : s,
          ),
        },
        reason: input.reason ?? `Did the remaining ${pending} steps as planned`,
      });
    },
  }),
  implement(runsRecordDeviation, {
    agentPolicy: personStarted,
    run: async (ctx, input, deps) => {
      const { run, a } = await runOf(deps, ctx, input.id);
      return service(deps).update(ctx, run.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          deviations: [
            ...(a.deviations ?? []),
            {
              what: input.what,
              why: input.why,
              ...(input.impact ? { impact: input.impact } : {}),
              at: new Date().toISOString(),
              by: ctx.actor,
            },
          ],
        },
        reason: input.reason ?? `Deviation: ${input.what}`,
      });
    },
  }),
  implement(runsAttachData, {
    agentPolicy: personStarted,
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const run = await recordOf(records, ctx, input.id, 'run', 'run');
      const a = run.attributes as RunAttributes;
      if (input.step !== undefined || input.part !== undefined) {
        if (input.step === undefined || input.part === undefined) {
          throw new OperationError('invalid_input', 'Give both the part and the step');
        }
        stepOf(run, a, input.part, input.step);
      }
      const { id: _id, expectedVersion, reason, ...data } = input;
      return records.update(ctx, run.id, {
        expectedVersion,
        attributes: { ...a, data: [...(a.data ?? []), data] },
        reason: reason ?? `Attached data to ${run.name}`,
      });
    },
  }),
  implement(runsFinish, {
    agentPolicy: personStarted,
    run: async (ctx, input, deps) => {
      const { run, a } = await runOf(deps, ctx, input.id);
      const pending = (a.steps ?? []).filter((s) => s.status === 'pending');
      if (input.status === 'done' && pending.length) {
        throw new OperationError(
          'invalid_state',
          `${pending.length} step${pending.length === 1 ? ' is' : 's are'} not ticked (${pending
            .map((s) => s.title)
            .join(', ')}); tick or skip them, or finish the run as failed or aborted`,
        );
      }
      return service(deps).update(ctx, run.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...a,
          status: input.status,
          finishedAt: new Date().toISOString(),
          ...(input.note ? { notes: a.notes ? `${a.notes}\n${input.note}` : input.note } : {}),
        },
        reason: input.reason ?? `Finished ${run.name}: ${input.status}`,
      });
    },
  }),
];

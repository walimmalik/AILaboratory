import type { ExperimentStage, RunAttributes, RunStep } from '@ailab/schema';
import { formatValue } from './format.ts';

/** Stages in lab words (plan 013, E4). */
export const stageWords: Record<ExperimentStage, string> = {
  designing: 'Designing',
  planned: 'Planned',
  running: 'Running',
  analysing: 'Analysing',
  concluded: 'Concluded',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

export const runStatusWords: Record<RunAttributes['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  done: 'Done',
  failed: 'Failed',
  aborted: 'Aborted',
};

/** How far a run is: steps ticked or skipped out of all, and how many went differently. */
export function runProgress(a: Pick<RunAttributes, 'steps' | 'deviations'>) {
  const steps = a.steps ?? [];
  const ticked = steps.filter((s) => s.status !== 'pending').length;
  const deviations =
    steps.filter((s) => s.deviation).length + (a.deviations ? a.deviations.length : 0);
  return { ticked, total: steps.length, deviations };
}

/** A step's planned values in one line: "volume 100 µL · times 3". */
export function plannedText(step: Pick<RunStep, 'planned'>): string {
  return step.planned.map((p) => `${p.name} ${formatValue(p.value)}`).join(' · ');
}

/**
 * What a person does next with an experiment at this stage, as operation-backed actions. Planning
 * needs a confirmed design; concluding needs finished runs, which the operation checks.
 */
export function nextActions(
  stage: ExperimentStage,
  status: 'draft' | 'active' | 'archived',
): ('plan' | 'start_run' | 'analyse' | 'conclude')[] {
  if (status !== 'active') return [];
  switch (stage) {
    case 'designing':
      return ['plan'];
    case 'planned':
      return ['start_run'];
    case 'running':
      return ['start_run', 'analyse', 'conclude'];
    case 'analysing':
      return ['start_run', 'conclude'];
    default:
      return [];
  }
}

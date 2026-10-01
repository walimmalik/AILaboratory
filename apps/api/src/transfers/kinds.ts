import {
  defineKind,
  type TransferPlanAttributes,
  TransferPlanAttributes as TransferPlanSchema,
  type TransferRunAttributes,
  TransferRunAttributes as TransferRunSchema,
} from '@ailab/schema';
import { checkPin, stable } from '../records/pins.ts';
import { planRules, toCheck } from './rules.ts';

/**
 * A transfer plan (plan 016, T1): plates and groups of transfers, each one method on one instrument
 * with why. Readiness checks every volume against the limits the group was worked out with; the
 * live checks (sources on the day, instruments now) are `transfers.check`.
 */
export const transferPlan = defineKind({
  kind: 'transfer_plan',
  idPrefix: 'tfp',
  namePrefix: 'TFP',
  nameWidth: 4,
  attributes: TransferPlanSchema,
  links: (a: TransferPlanAttributes) => [
    ...(a.experiment ? [{ toId: a.experiment, relation: 'part_of' }] : []),
    ...[...new Set(a.plates.map((p) => p.labwareType.id))].map((toId) => ({
      toId,
      relation: 'plate_type',
    })),
    ...[...new Set(a.plates.flatMap((p) => (p.container ? [p.container] : [])))].map((toId) => ({
      toId,
      relation: 'uses',
    })),
    ...[...new Set(a.plates.flatMap((p) => (p.plateMap ? [p.plateMap.map.id] : [])))].map(
      (toId) => ({ toId, relation: 'fills' }),
    ),
    ...[...new Set(a.groups.flatMap((g) => (g.instrument ? [g.instrument.instrument] : [])))].map(
      (toId) => ({ toId, relation: 'runs_on' }),
    ),
    ...(a.rerunOf ? [{ toId: a.rerunOf.run, relation: 'reruns' }] : []),
  ],
  sections: [
    {
      id: 'plates',
      title: 'Plates and sources',
      fields: ['experiment', 'purpose', 'rerunOf', 'plates'],
    },
    { id: 'transfers', title: 'Transfers', fields: ['groups', 'notes'] },
    { id: 'decks', title: 'Deck layouts', fields: ['decks'] },
  ],
  // Each group's layout is reviewed on its own: changing one sends only it back to review.
  items: { decks: 'group' },
  related: async (a, context) => {
    const { invalid, rules } = await planRules(a, context);
    if (a.rerunOf && (await context.get(a.rerunOf.run))?.kind !== 'transfer_run')
      invalid.push(`${a.rerunOf.run} is not an execution of a transfer plan in this lab`);
    if (invalid.length) return { invalid: [...new Set(invalid)] };
    return { checks: rules.map(toCheck) };
  },
});

/**
 * One execution of a transfer plan (016b-2b, ADR 0060): what the instrument's report says happened,
 * transfer by transfer, and the plan drafted to redo what didn't. Made only by
 * transfers.import_report, active from the start: it records an outcome, there is nothing to review.
 */
export const transferRun = defineKind({
  kind: 'transfer_run',
  idPrefix: 'trn',
  namePrefix: 'TRN',
  nameWidth: 4,
  attributes: TransferRunSchema,
  createdBy: 'transfers.import_report',
  links: (a: TransferRunAttributes) => [
    { toId: a.plan.id, relation: 'executes' },
    { toId: a.report, relation: 'report' },
    ...(a.rerun ? [{ toId: a.rerun, relation: 'rerun' }] : []),
  ],
  related: async (a, context) => {
    const pin = await checkPin(context, a.plan, 'transfer_plan', 'a transfer plan');
    if (pin.invalid) return { invalid: [pin.invalid] };
    const invalid: string[] = [];
    if ((await context.get(a.report))?.kind !== 'file')
      invalid.push(`${a.report} is not a file in this lab`);
    if (a.rerun && (await context.get(a.rerun))?.kind !== 'transfer_plan')
      invalid.push(`${a.rerun} is not a transfer plan in this lab`);
    // The outcome is fixed once read; only the rerun it led to is added.
    const before = context.current?.attributes as TransferRunAttributes | undefined;
    if (before) {
      const { rerun: _now, ...now } = a;
      const { rerun: _was, ...was } = before;
      if (stable(now) !== stable(was))
        invalid.push('An execution records what the report said; it is not edited');
    }
    return invalid.length ? { invalid } : {};
  },
});

export const transferKinds = [transferPlan, transferRun];

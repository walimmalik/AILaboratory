import {
  defineKind,
  type TransferPlanAttributes,
  TransferPlanAttributes as TransferPlanSchema,
} from '@ailab/schema';
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
  ],
  sections: [
    { id: 'plates', title: 'Plates and sources', fields: ['experiment', 'purpose', 'plates'] },
    { id: 'transfers', title: 'Transfers', fields: ['groups', 'notes'] },
    { id: 'decks', title: 'Deck layouts', fields: ['decks'] },
  ],
  // Each group's layout is reviewed on its own: changing one sends only it back to review.
  items: { decks: 'group' },
  related: async (a, context) => {
    const { invalid, rules } = await planRules(a, context);
    if (invalid.length) return { invalid: [...new Set(invalid)] };
    return { checks: rules.map(toCheck) };
  },
});

export const transferKinds = [transferPlan];

import { fitVolume, subtract, TransferError } from '@ailab/domain';
import type {
  LiquidVolume,
  PlannedTransfer,
  TransferException,
  TransferGroup,
  TransferPlanAttributes,
} from '@ailab/schema';
import { limitsOf } from './rules.ts';

/**
 * Reruns (016b-2b, ADR 0060): what an execution didn't do, redone as a new draft plan of the same
 * design. Failed and missing transfers are redone whole; a short one gets the rest, in whole steps
 * of its device. A transfer the device can't top up is logged as not rerun, with why.
 */

/** What a rerun moves for one transfer that didn't go as planned, or why nothing. */
export function rerunOf(
  outcome: TransferException['outcome'],
  t: PlannedTransfer,
  group: TransferGroup,
  actual?: LiquidVolume,
): { rerun?: LiquidVolume; note?: string } {
  if (outcome !== 'short' || !actual) return { rerun: t.volume };
  const rest = subtract(t.volume, { value: actual.value, unit: actual.unit }) as LiquidVolume;
  const limits = limitsOf(group);
  if (!limits) return { rerun: rest };
  try {
    const fit = fitVolume(rest, limits);
    if (!fit.fits)
      return { note: `The rest, ${rest.value} ${rest.unit}, can't be moved: ${fit.problem}` };
    return { rerun: fit.achieved as LiquidVolume };
  } catch (error) {
    if (error instanceof TransferError) return { note: error.message };
    throw error;
  }
}

/**
 * The rerun plan: the original's plates, experiment and groups (method, instrument, device, reason,
 * liquid class), with only the transfers to redo. Plates are the containers used on the day. An
 * intermediate the rerun only draws from was made in the execution, so here it is a source.
 */
export function rerunPlan(
  a: TransferPlanAttributes,
  exceptions: readonly TransferException[],
  containers: ReadonlyMap<string, string>,
  rerunOf: NonNullable<TransferPlanAttributes['rerunOf']>,
  runName: string,
): TransferPlanAttributes | undefined {
  const redo = exceptions.filter((e) => e.rerun);
  if (!redo.length) return undefined;
  const groups = a.groups.flatMap((g): TransferGroup[] => {
    const transfers = redo
      .filter((e) => e.group === g.id)
      .map((e) => ({ from: e.from, to: e.to, volume: e.rerun as LiquidVolume }));
    return transfers.length ? [{ ...g, transfers }] : [];
  });
  const used = new Set(
    groups.flatMap((g) => g.transfers.flatMap((t) => [t.from.plate, t.to.plate])),
  );
  const filled = new Set(groups.flatMap((g) => g.transfers.map((t) => t.to.plate)));
  const plates = a.plates
    .filter((p) => used.has(p.id))
    .map((p) => {
      const container = containers.get(p.id) ?? p.container;
      return {
        ...p,
        role: p.role === 'intermediate' && !filled.has(p.id) ? ('source' as const) : p.role,
        ...(container ? { container } : {}),
      };
    });
  const n = groups.reduce((sum, g) => sum + g.transfers.length, 0);
  return {
    ...(a.experiment ? { experiment: a.experiment } : {}),
    ...(a.purpose ? { purpose: a.purpose } : {}),
    rerunOf,
    plates,
    groups,
    notes: `Redoes ${n} transfer${n === 1 ? '' : 's'} that ${runName} did not complete`,
  };
}

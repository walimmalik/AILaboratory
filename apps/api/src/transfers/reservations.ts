import { add, convert } from '@ailab/domain';
import type { Quantity, RecordEnvelope, TransferPlanAttributes } from '@ailab/schema';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

const UL = 'uL';

/** What a plan draws from each real container well, in µL. */
export function drawsOf(a: TransferPlanAttributes): Map<string, Quantity> {
  const containers = new Map(
    a.plates.flatMap((p) => (p.container && p.role === 'source' ? [[p.id, p.container]] : [])),
  );
  const out = new Map<string, Quantity>();
  for (const g of a.groups)
    for (const t of g.transfers) {
      const container = containers.get(t.from.plate);
      if (!container) continue;
      const key = `${container}|${t.from.well}`;
      const v = convert(t.volume, UL);
      out.set(key, out.has(key) ? add(out.get(key) as Quantity, v) : v);
    }
  return out;
}

/**
 * Soft reservations (010 V8): what confirmed transfer plans draw from each container well. Plans
 * reserve while confirmed; archiving one ends its reservations.
 */
export async function reservations(
  deps: OperationDeps,
  ctx: RecordContext,
  except?: string,
): Promise<Map<string, { plan: RecordEnvelope; volume: Quantity }[]>> {
  const plans = await new RecordService(deps.db, deps.kinds).list(ctx, {
    kind: 'transfer_plan',
    status: 'active',
    limit: 500,
  });
  const out = new Map<string, { plan: RecordEnvelope; volume: Quantity }[]>();
  for (const plan of plans) {
    if (plan.id === except) continue;
    for (const [key, volume] of drawsOf(plan.attributes as TransferPlanAttributes))
      out.set(key, [...(out.get(key) ?? []), { plan, volume }]);
  }
  return out;
}

export const totalOf = (list: { volume: Quantity }[] | undefined): Quantity | undefined =>
  list?.length
    ? list.reduce<Quantity>((s, r) => add(s, r.volume), { value: '0', unit: UL })
    : undefined;

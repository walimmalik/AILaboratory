import { showsPattern } from '@ailab/domain';
import type {
  Actor,
  MemoryDraft,
  PlannedTransfer,
  TransferPlanAttributes,
  TransferRunAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';

/**
 * The transfer module's lab memory detectors (plan 005 M13 and change 5, plan 016): Echo transfers
 * that fail or come up short, and surveys that measure less than the inventory records. Both can
 * see absence, so a report where the pattern could have shown and didn't is reported as quiet, and
 * a memory that stops happening becomes due for a check (M17).
 */

export const TRANSFER_DETECTOR = 'transfers.echo_exceptions';
export const SURVEY_DETECTOR = 'transfers.survey_low';

/** Quiet reports in a row before a memory from these detectors is due for a check. */
const QUIET_LIMIT = 10;

const detectorOf = (ctx: RecordContext): Actor => ({
  type: 'agent',
  agentName: 'Lab memory detector',
  onBehalfOf: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf,
});

interface Observation {
  key: string;
  shows: boolean;
  evidence: string;
  day: string;
  note: string;
  draft: MemoryDraft;
}

/** Reports each pattern seen, and as quiet each one a detector already collects that wasn't. */
async function report(
  deps: OperationDeps,
  ctx: RecordContext,
  detector: string,
  observations: Observation[],
) {
  const as = { ...ctx, actor: detectorOf(ctx) };
  const known = new Set<string>();
  if (observations.some((o) => !o.shows)) {
    const listed = await deps.registry.execute(
      as,
      'memory.candidates',
      { detector, limit: 200 },
      {},
      deps.db,
    );
    if (listed.status === 'done')
      for (const c of (listed.output as { candidates: { key: string }[] }).candidates)
        known.add(c.key);
  }
  for (const o of observations) {
    if (!o.shows && !known.has(o.key)) continue;
    await deps.registry
      .execute(
        as,
        'memory.observe',
        {
          detector,
          key: o.key,
          finding: o.shows ? 'for' : 'quiet',
          source: 'run',
          evidence: o.evidence,
          day: o.day,
          note: o.note,
          draft: o.draft,
          quietLimit: QUIET_LIMIT,
        },
        {},
        deps.db,
      )
      .catch((error: unknown) => {
        // A detector never stops the import it reads; a refused observation is skipped.
        if (error instanceof OperationError) return undefined;
        throw error;
      });
  }
}

async function labels(deps: OperationDeps, ctx: RecordContext, ids: string[]) {
  const records = new RecordService(deps.db, deps.kinds);
  const out = new Map<string, string>();
  for (const id of new Set(ids)) {
    const r = await records.get(ctx, id).catch(() => undefined);
    out.set(id, r?.label ?? id);
  }
  return out;
}

/**
 * After an Echo transfer report is read: for each instrument, source labware type and liquid
 * class, whether its transfers failed or came up short often enough to count (2 or more, and 5% or
 * more of them), keyed by those three and the outcome.
 */
export async function observeTransferExceptions(
  deps: OperationDeps,
  ctx: RecordContext,
  plan: TransferPlanAttributes,
  planned: { group: string; t: PlannedTransfer }[],
  execution: { id: string; attributes: TransferRunAttributes },
): Promise<void> {
  const groups = new Map(plan.groups.map((g) => [g.id, g]));
  const lwtOf = new Map(plan.plates.map((p) => [p.id, p.labwareType.id]));
  const combos = new Map<
    string,
    { instrument: string; lwt: string; cls?: string; total: number; failed: number; short: number }
  >();
  const comboOf = (group: string, from: string) => {
    const g = groups.get(group);
    const instrument = g?.instrument?.instrument;
    const lwt = lwtOf.get(from);
    if (!instrument || !lwt) return undefined;
    const key = [instrument, lwt, g?.liquidClass ?? 'no_class'].join('|');
    if (!combos.has(key))
      combos.set(key, {
        instrument,
        lwt,
        ...(g?.liquidClass ? { cls: g.liquidClass } : {}),
        total: 0,
        failed: 0,
        short: 0,
      });
    return combos.get(key);
  };
  for (const p of planned) {
    const c = comboOf(p.group, p.t.from.plate);
    if (c) c.total++;
  }
  for (const e of execution.attributes.exceptions) {
    if (e.outcome === 'not_run') continue;
    const c = comboOf(e.group, e.from.plate);
    if (c) c[e.outcome]++;
  }
  const named = await labels(
    deps,
    ctx,
    [...combos.values()].flatMap((c) => [c.instrument, c.lwt, ...(c.cls ? [c.cls] : [])]),
  );
  const day = execution.attributes.at.slice(0, 10);
  const observations: Observation[] = [];
  for (const [base, c] of combos)
    for (const outcome of ['failed', 'short'] as const) {
      const hits = c[outcome];
      const verb = outcome === 'failed' ? 'fail' : 'come up short';
      observations.push({
        key: `${base}|${outcome}`,
        shows: showsPattern(hits, c.total),
        evidence: execution.id,
        day,
        note: `${hits} of ${c.total} transfers ${outcome === 'failed' ? 'failed' : 'short'}`,
        draft: {
          statement: `On ${named.get(c.instrument)}, Echo transfers from ${named.get(c.lwt)} plates${c.cls ? ` with ${named.get(c.cls)}` : ''} ${verb} in 5% or more of transfers`,
          kind: 'quirk',
          about: [c.instrument, c.lwt, ...(c.cls ? [c.cls] : [])],
          conditions: { instrument: c.instrument, labware: c.lwt },
        },
      });
    }
  await report(deps, ctx, TRANSFER_DETECTOR, observations);
}

/**
 * After an Echo survey is read: for each labware type, whether the survey measured less than the
 * inventory records in enough wells to count (2 or more, and 5% or more of the wells compared).
 */
export async function observeSurveyLow(
  deps: OperationDeps,
  ctx: RecordContext,
  file: string,
  wells: { lwt: string; low: boolean }[],
): Promise<void> {
  const byType = new Map<string, { total: number; low: number }>();
  for (const w of wells) {
    const t = byType.get(w.lwt) ?? { total: 0, low: 0 };
    t.total++;
    if (w.low) t.low++;
    byType.set(w.lwt, t);
  }
  const named = await labels(deps, ctx, [...byType.keys()]);
  const day = new Date().toISOString().slice(0, 10);
  await report(
    deps,
    ctx,
    SURVEY_DETECTOR,
    [...byType].map(([lwt, t]) => ({
      key: `${lwt}|lower`,
      shows: showsPattern(t.low, t.total),
      evidence: file,
      day,
      note: `${t.low} of ${t.total} wells measured less than the inventory records`,
      draft: {
        statement: `Echo surveys of ${named.get(lwt)} plates measure less than the inventory records in 5% or more of wells`,
        kind: 'lesson',
        about: [lwt],
        conditions: { labware: lwt },
      },
    })),
  );
}

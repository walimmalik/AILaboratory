import { compare, convert, formatQuantity, subtract } from '@ailab/domain';
import {
  type LiquidVolume,
  type PlannedTransfer,
  type Quantity,
  type RecordEnvelope,
  type TransferException,
  type TransferPlanAttributes,
  type TransferRunAttributes,
  transfersImportReport,
  type WellState,
} from '@ailab/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { records as recordsTable } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { run } from './calculators.ts';
import { observeSurveyLow, observeTransferExceptions } from './detectors.ts';
import { EchoReportError, type EchoReportPlate, readEchoReport } from './echo.ts';
import { instrumentKindOf } from './export.ts';
import { rerunOf, rerunPlan } from './reruns.ts';

/**
 * Instrument reports read back against confirmed transfer plans (plan 016b-2, T4). Echo transfer
 * reports record what really moved in the inventory ledger as from a run log (010 V7).
 */

type Output = z.infer<typeof transfersImportReport.output>;
type Problem = Output['problems'][number];

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);
const nL = (value: string): Quantity => ({ value, unit: 'nL' }) as Quantity;
const uL = (value: string): Quantity => ({ value, unit: 'uL' }) as Quantity;

/** A survey volume counts as off the inventory beyond this share of the recorded volume. */
const SURVEY_TOLERANCE = 0.1;

export const reportOperations = [
  implement(transfersImportReport, {
    agentPolicy: 'direct',
    touches: (input) => [input.id, input.file],
    run: async (ctx, input, deps) => {
      const records = service(deps);
      const plan = await records.get(ctx, input.id).catch(() => undefined);
      if (plan?.kind !== 'transfer_plan')
        throw new OperationError('not_found', `${input.id} is not a transfer plan in this lab`);
      if (plan.status !== 'active')
        throw new OperationError(
          'invalid_state',
          `${plan.name} is not confirmed; reports are read against confirmed plans only`,
        );
      const a = plan.attributes as TransferPlanAttributes;
      const file = await records.get(ctx, input.file).catch(() => undefined);
      if (file?.kind !== 'file')
        throw new OperationError('not_found', `${input.file} is not a file in this lab`);
      const { text } = await run<{ text?: string }>(deps, ctx, 'files.get', {
        id: file.id,
        as: 'text',
      });
      let report: ReturnType<typeof readEchoReport>;
      try {
        report = readEchoReport(text ?? '');
      } catch (error) {
        if (error instanceof EchoReportError)
          throw new OperationError('invalid_input', `${file.label}: ${error.message}`);
        throw error;
      }

      // The plan's plates by the names and barcodes the export wrote.
      const given = new Map((input.containers ?? []).map((c) => [c.plate, c.container]));
      for (const plate of given.keys())
        if (!a.plates.some((p) => p.id === plate))
          throw new OperationError('invalid_input', `${plan.name} has no plate ${plate}`);
      const containerOf = new Map<string, RecordEnvelope>();
      for (const p of a.plates) {
        const id = given.get(p.id) ?? p.container;
        if (!id) continue;
        const c = await records.get(ctx, id).catch(() => undefined);
        if (c?.kind !== 'container')
          throw new OperationError('invalid_input', `${id} is not a container in this lab`);
        containerOf.set(p.id, c);
      }
      const plateOf = (r: EchoReportPlate): string | undefined => {
        if (r.barcode) {
          const byCode = a.plates.find((p) => containerOf.get(p.id)?.name === r.barcode);
          if (byCode) return byCode.id;
        }
        return a.plates.find((p) => (p.label ?? p.id) === r.name)?.id;
      };
      const barcodeClash = (r: EchoReportPlate, plate: string) => {
        const c = containerOf.get(plate);
        return r.barcode && c && c.name !== r.barcode
          ? `${r.name} was ${r.barcode} on the Echo, but the plan has ${c.name} for ${plate}`
          : undefined;
      };

      const counts = {
        rows: report.rows.length,
        done: 0,
        short: 0,
        failed: 0,
        notInReport: 0,
        notInPlan: 0,
        flagged: 0,
      };
      const problems: Problem[] = [];
      const notes: string[] = [];
      const out = (o: Omit<Output, 'plan' | 'counts' | 'problems' | 'notes'>) => ({
        plan: { id: plan.id, name: plan.name, version: plan.version },
        counts,
        problems,
        notes,
        ...o,
      });

      if (report.report === 'echo_survey') {
        const held = new Map<string, Map<string, Quantity | 'unknown'>>();
        const compared: { lwt: string; low: boolean }[] = [];
        for (const row of report.rows) {
          const plate = plateOf(row.plate);
          const measured = uL(row.volume);
          const where = { plate: plate ?? row.plate.name, well: row.well };
          const container = plate ? containerOf.get(plate) : undefined;
          let recorded: Quantity | 'unknown' | undefined;
          if (container) {
            if (!held.has(container.id)) {
              const wells = await run<{ wells: { well: string; state: WellState }[] }>(
                deps,
                ctx,
                'inventory.wells',
                { container: container.id },
              );
              held.set(
                container.id,
                new Map(wells.wells.map((w) => [w.well, w.state.volume as Quantity | 'unknown'])),
              );
            }
            recorded = held.get(container.id)?.get(row.well) ?? uL('0');
          }
          const off =
            recorded && recorded !== 'unknown'
              ? Math.abs(Number(convert(subtract(measured, recorded), 'uL').value)) >
                SURVEY_TOLERANCE * Number(convert(recorded, 'uL').value)
              : false;
          const lwt = a.plates.find((p) => p.id === plate)?.labwareType.id;
          if (lwt && recorded && recorded !== 'unknown')
            compared.push({ lwt, low: off && compare(measured, recorded) < 0 });
          if (!row.status && !off) continue;
          counts.flagged++;
          const said = [
            row.status,
            off && recorded && recorded !== 'unknown'
              ? `measured ${formatQuantity(measured)}, the inventory has ${formatQuantity(recorded)}`
              : undefined,
          ].filter(Boolean);
          problems.push({
            kind: 'survey',
            source: where,
            actual: measured,
            message: `${where.plate} ${row.well}: ${said.join('; ')}`,
          });
        }
        if (report.rows.some((r) => !plateOf(r.plate)))
          notes.push('Some surveyed plates are not in the plan; they were checked by name only');
        notes.push(
          'A survey changes nothing in the inventory; correct volumes with inventory.correct if the survey is right',
        );
        await observeSurveyLow(deps, ctx, file.id, compared);
        return out({ report: 'echo_survey', recorded: 0 });
      }

      // A report is read once (ADR 0060): its execution is on record.
      const [already] = await deps.db
        .select({ name: recordsTable.name })
        .from(recordsTable)
        .where(
          and(
            eq(recordsTable.labId, ctx.labId),
            eq(recordsTable.kind, 'transfer_run'),
            sql`${recordsTable.attributes}->>'report' = ${file.id}`,
          ),
        );
      if (already)
        throw new OperationError(
          'invalid_state',
          `${file.name} was already read as ${already.name}; a report is read once`,
        );

      // Planned Echo transfers, matched to report rows in order.
      const planned: {
        group: string;
        index: number;
        t: PlannedTransfer;
        seen: boolean;
        outcome?: TransferException['outcome'] | 'done';
        actual?: LiquidVolume;
        status?: string;
      }[] = [];
      for (const g of a.groups) {
        if (!g.instrument) continue;
        const { kind } = await instrumentKindOf(deps, ctx, g.instrument.instrument);
        if (kind.category !== 'acoustic_dispenser') continue;
        g.transfers.forEach((t, index) => {
          planned.push({ group: g.id, index, t, seen: false });
        });
      }
      if (!planned.length)
        throw new OperationError('invalid_input', `${plan.name} has no Echo transfers`);
      const key = (fp: string, fw: string, tp: string, tw: string) => `${fp}|${fw}|${tp}|${tw}`;
      const queue = new Map<string, typeof planned>();
      for (const p of planned) {
        const k = key(p.t.from.plate, p.t.from.well, p.t.to.plate, p.t.to.well);
        queue.set(k, [...(queue.get(k) ?? []), p]);
      }
      const moved: {
        from: { plate: string; well: string };
        to: { plate: string; well: string };
        volume: Quantity;
      }[] = [];
      for (const row of report.rows) {
        const from = plateOf(row.source);
        const to = plateOf(row.destination);
        const source = { plate: from ?? row.source.name, well: row.sourceWell };
        const destination = { plate: to ?? row.destination.name, well: row.destinationWell };
        const clash =
          (from && barcodeClash(row.source, from)) || (to && barcodeClash(row.destination, to));
        if (clash) throw new OperationError('invalid_input', clash);
        const match =
          from && to
            ? queue.get(key(from, row.sourceWell, to, row.destinationWell))?.find((p) => !p.seen)
            : undefined;
        const requested = nL(row.requested);
        const actual = nL(row.actual);
        if (!match) {
          counts.notInPlan++;
          problems.push({
            kind: 'not_in_plan',
            source,
            destination,
            requested,
            actual,
            message: `${source.plate} ${source.well} to ${destination.plate} ${destination.well} is not a planned transfer`,
          });
          continue;
        }
        match.seen = true;
        match.actual = actual as LiquidVolume;
        if (row.status) match.status = row.status;
        if (Number(row.actual) > 0) moved.push({ from: source, to: destination, volume: actual });
        const target = compare(requested, match.t.volume) === 0 ? requested : match.t.volume;
        match.outcome =
          Number(row.actual) === 0 ? 'failed' : compare(actual, target) < 0 ? 'short' : 'done';
        if (Number(row.actual) === 0) {
          counts.failed++;
          problems.push({
            kind: 'failed',
            source,
            destination,
            requested: target,
            actual,
            message: `${destination.plate} ${destination.well} got nothing from ${source.plate} ${source.well}${row.status ? `: ${row.status}` : ''}`,
          });
        } else if (compare(actual, target) < 0) {
          counts.short++;
          problems.push({
            kind: 'short',
            source,
            destination,
            requested: target,
            actual,
            message: `${destination.plate} ${destination.well} got ${formatQuantity(actual)} of ${formatQuantity(target)}${row.status ? `: ${row.status}` : ''}`,
          });
        } else counts.done++;
      }
      for (const p of planned.filter((p) => !p.seen)) {
        p.outcome = 'not_run';
        counts.notInReport++;
        problems.push({
          kind: 'not_in_report',
          source: p.t.from,
          destination: p.t.to,
          requested: p.t.volume,
          message: `${p.t.to.plate} ${p.t.to.well} from ${p.t.from.plate} ${p.t.from.well} is not in the report`,
        });
      }

      const missing = [...new Set(moved.flatMap((m) => [m.from.plate, m.to.plate]))].filter(
        (p) => !containerOf.has(p),
      );
      if (missing.length) {
        notes.push(
          `Nothing was recorded in the inventory: ${missing.join(', ')} ha${missing.length === 1 ? 's' : 've'} no container; give them as containers and import again`,
        );
        return out({ report: 'echo_transfer', recorded: 0 });
      }
      const ref = (w: { plate: string; well: string }) => ({
        container: (containerOf.get(w.plate) as RecordEnvelope).id,
        well: w.well,
      });
      let event: string | undefined;
      if (moved.length) {
        const changed = await run<{ event: { id: string }; warnings: string[] }>(
          deps,
          ctx,
          'inventory.transfer',
          {
            transfers: moved.map((m) => ({ from: ref(m.from), to: ref(m.to), volume: m.volume })),
            runLog: file.id,
            reason:
              input.reason ??
              `From the Echo transfer report ${file.name} (${file.label}) for ${plan.name}`,
          },
        );
        notes.push(...changed.warnings);
        event = changed.event.id;
      }

      // The execution (ADR 0060): which transfers didn't go as planned, and what a rerun redoes.
      const groupOf = new Map(a.groups.map((g) => [g.id, g]));
      const exceptions = planned.flatMap((p): TransferException[] => {
        if (p.outcome === 'done' || !p.outcome) return [];
        const g = groupOf.get(p.group) as (typeof a.groups)[number];
        const redo = rerunOf(p.outcome, p.t, g, p.actual);
        const note = [p.status, redo.note].filter(Boolean).join('; ');
        return [
          {
            group: p.group,
            index: p.index,
            from: p.t.from,
            to: p.t.to,
            outcome: p.outcome,
            planned: p.t.volume,
            ...(p.actual ? { actual: p.actual } : {}),
            ...(redo.rerun ? { rerun: redo.rerun } : {}),
            ...(note ? { note } : {}),
          },
        ];
      });
      const containers = [...containerOf].map(([plate, c]) => ({ plate, container: c.id }));
      const attributes: TransferRunAttributes = {
        plan: { id: plan.id, version: plan.version },
        report: file.id,
        at: new Date().toISOString(),
        status: exceptions.length ? 'with_exceptions' : 'complete',
        containers,
        counts: {
          planned: planned.length,
          done: counts.done,
          short: counts.short,
          failed: counts.failed,
          notRun: counts.notInReport,
          unplanned: counts.notInPlan,
        },
        exceptions,
        unplanned: problems.flatMap((x) =>
          x.kind === 'not_in_plan' && x.source && x.destination && x.actual
            ? [{ from: x.source, to: x.destination, actual: x.actual as LiquidVolume }]
            : [],
        ),
      };
      let execution = await records.create(ctx, {
        kind: 'transfer_run',
        label: `${plan.label}, ${attributes.at.slice(0, 10)}`,
        status: 'active',
        attributes,
        reason: input.reason ?? `Read from the Echo transfer report ${file.name}`,
      });
      const redo = rerunPlan(
        a,
        exceptions,
        new Map(containers.map((c) => [c.plate, c.container])),
        { plan: { id: plan.id, version: plan.version }, run: execution.id },
        execution.name,
      );
      let rerun: RecordEnvelope | undefined;
      if (redo) {
        rerun = await records.create(ctx, {
          kind: 'transfer_plan',
          label: `Rerun of ${plan.label}`,
          attributes: redo,
          reason: `Redoes what ${execution.name} did not complete`,
        });
        execution = await records.update(ctx, execution.id, {
          expectedVersion: execution.version,
          attributes: { ...attributes, rerun: rerun.id },
          reason: `${rerun.name} redoes what it did not complete`,
        });
        const n = redo.groups.reduce((sum, g) => sum + g.transfers.length, 0);
        notes.push(`${rerun.name} redoes ${n} transfers; it is a draft for a person to confirm`);
      }
      await observeTransferExceptions(deps, ctx, a, planned, {
        id: execution.id,
        attributes,
      });
      const notRerun = exceptions.filter((e) => !e.rerun).length;
      if (notRerun) notes.push(`${notRerun} not rerun; ${execution.name} says why for each`);
      return out({
        report: 'echo_transfer',
        recorded: moved.length,
        ...(event ? { event } : {}),
        execution: { id: execution.id, name: execution.name },
        ...(rerun ? { rerun: { id: rerun.id, name: rerun.name } } : {}),
      });
    },
  }),
];

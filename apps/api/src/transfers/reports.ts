import { compare, convert, formatQuantity, subtract } from '@ailab/domain';
import {
  type PlannedTransfer,
  type Quantity,
  type RecordEnvelope,
  type TransferPlanAttributes,
  transfersImportReport,
  type WellState,
} from '@ailab/schema';
import type { z } from 'zod';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { run } from './calculators.ts';
import { EchoReportError, type EchoReportPlate, readEchoReport } from './echo.ts';
import { instrumentKindOf } from './export.ts';

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
        return out({ report: 'echo_survey', recorded: 0 });
      }

      // Planned Echo transfers, matched to report rows in order.
      const planned: { group: string; t: PlannedTransfer; seen: boolean }[] = [];
      for (const g of a.groups) {
        if (!g.instrument) continue;
        const { kind } = await instrumentKindOf(deps, ctx, g.instrument.instrument);
        if (kind.category !== 'acoustic_dispenser') continue;
        for (const t of g.transfers) planned.push({ group: g.id, t, seen: false });
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
        if (Number(row.actual) > 0) moved.push({ from: source, to: destination, volume: actual });
        const target = compare(requested, match.t.volume) === 0 ? requested : match.t.volume;
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
      if (!moved.length) return out({ report: 'echo_transfer', recorded: 0 });
      const ref = (w: { plate: string; well: string }) => ({
        container: (containerOf.get(w.plate) as RecordEnvelope).id,
        well: w.well,
      });
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
      return out({ report: 'echo_transfer', recorded: moved.length, event: changed.event.id });
    },
  }),
];
